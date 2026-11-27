import { afterEach, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { migrate } from '../src/lib/server/identity';
import { createEvent, listEvents } from '../src/lib/server/calendar';
import { getIdentityServices } from '../src/lib/server/runtime';
import { actions, load } from '../src/routes/calendar/import/+page.server';
import { importItemKey, MAX_ICS_BYTES, MAX_ICS_EVENTS, type ImportDecision } from '../src/lib/calendar/ics';

vi.mock('../src/lib/server/runtime', () => ({ getIdentityServices: vi.fn() }));
afterEach(() => vi.resetAllMocks());

const origin = 'http://localhost';

const SAMPLE_ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:act-1@example.test',
  'SUMMARY:School picture day',
  'DTSTART;VALUE=DATE:20991115',
  'DTEND;VALUE=DATE:20991116',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:act-2@example.test',
  'SUMMARY:Parent teacher conference',
  'DTSTART:20991116T160000',
  'DTEND:20991116T163000',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n');

async function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  await migrate(db);
  for (const id of ['parent', 'kid', 'disabled']) {
    db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, `${id}@example.test`);
  }
  db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'Synthetic Home');
  db.prepare('INSERT INTO household_settings (household_id, timezone) VALUES (?, ?)').run('home', 'America/Chicago');
  db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('parent', 'home', 'parent');
  db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('kid', 'home', 'kid');
  db.prepare('INSERT INTO membership (user_id, household_id, role, disabled_at, disabled_by) VALUES (?, ?, ?, ?, ?)').run('disabled', 'home', 'parent', Date.now(), 'parent');
  return db;
}

function useSession(db: Database.Database, userId: string | null) {
  vi.mocked(getIdentityServices).mockReturnValue({
    auth: { api: { getSession: async () => userId ? { user: { id: userId } } : null } },
    db,
    origin
  } as unknown as ReturnType<typeof getIdentityServices>);
}

type ActionFn = (event: { request: Request; url: URL }) => Promise<unknown>;
type LoadFn = (event: { request: Request; url: URL; setHeaders: (headers: Record<string, string>) => void }) => Promise<unknown>;

function makeRequest(action: 'review' | 'confirm', body: BodyInit, options: { origin?: string | null; contentType?: string; contentLength?: string; cookie?: string; query?: string } = {}) {
  const headers = new Headers();
  if (options.origin !== null) headers.set('origin', options.origin ?? origin);
  if (options.contentType) headers.set('content-type', options.contentType);
  if (options.contentLength) headers.set('content-length', options.contentLength);
  if (options.cookie) headers.set('cookie', options.cookie);
  const query = options.query ?? 'date=2099-11-10&view=week';
  const url = new URL(`${origin}/calendar/import?/${action}&${query}`);
  return { request: new Request(url, { method: 'POST', headers, body }), url };
}

function confirmBody(decisions: ImportDecision[], importKey: string): URLSearchParams {
  const body = new URLSearchParams();
  body.set('rowCount', String(decisions.length));
  body.set('importKey', importKey);
  decisions.forEach((decision, index) => {
    body.set(`key-${index}`, decision.key);
    body.set(`uid-${index}`, decision.sourceUid ?? '');
    body.set(`summary-${index}`, decision.originalSummary);
    body.set(`action-${index}`, decision.action);
    body.set(`title-${index}`, decision.title);
    body.set(`date-${index}`, decision.date);
    body.set(`endDate-${index}`, decision.endDate);
    if (decision.allDay) body.set(`allDay-${index}`, 'on');
    body.set(`startTime-${index}`, decision.startTime);
    body.set(`endTime-${index}`, decision.endTime);
    body.set(`location-${index}`, decision.location);
    body.set(`description-${index}`, decision.description);
    for (const day of decision.weekdays) body.append(`weekday-${index}`, String(day));
    for (const participant of decision.participants) body.append(`participant-${index}`, participant);
    for (const warning of decision.warnings ?? []) body.append(`warning-${index}`, warning);
  });
  return body;
}

function sampleDecision(index: number, overrides: Partial<ImportDecision> = {}): ImportDecision {
  return {
    key: importItemKey(index),
    sourceUid: `act-${index}@example.test`,
    originalSummary: 'School picture day',
    action: 'import',
    title: 'School picture day',
    date: '2099-11-15',
    endDate: '',
    allDay: true,
    startTime: '',
    endTime: '',
    weekdays: [],
    location: '',
    description: '',
    participants: [],
    ...overrides
  };
}

it('enforces parent-only access on load, review, and confirm and sets no-store', async () => {
  const db = await setup();
  try {
    const headersMap: Record<string, string> = {};
    const url = new URL(`${origin}/calendar/import?date=2099-11-10&view=week`);

    // Anonymous redirects to sign-in (even with display cookie)
    useSession(db, null);
    await expect((load as LoadFn)({
      request: new Request(url, { headers: { cookie: 'fleck_display=synthetic-token' } }),
      url,
      setHeaders: h => Object.assign(headersMap, h)
    })).rejects.toMatchObject({ status: 303, location: '/sign-in' });

    // Child gets 403 on load, review, confirm
    useSession(db, 'kid');
    await expect((load as LoadFn)({ request: new Request(url), url, setHeaders: () => {} })).rejects.toMatchObject({ status: 403 });
    const reviewReq = makeRequest('review', new URLSearchParams({ ics: SAMPLE_ICS }), { contentType: 'application/x-www-form-urlencoded' });
    await expect((actions.review as ActionFn)(reviewReq)).rejects.toMatchObject({ status: 403 });

    // Disabled parent gets 403
    useSession(db, 'disabled');
    await expect((load as LoadFn)({ request: new Request(url), url, setHeaders: () => {} })).rejects.toMatchObject({ status: 403 });

    // Parent loads with no-store and rejects cross-origin POST
    useSession(db, 'parent');
    const loaded = await (load as LoadFn)({
      request: new Request(url),
      url,
      setHeaders: h => Object.assign(headersMap, h)
    }) as Record<string, unknown>;
    expect(loaded).toMatchObject({ date: '2099-11-10', view: 'week', timezone: 'America/Chicago' });
    expect(headersMap['cache-control']).toContain('no-store');

    const badOrigin = makeRequest('review', new URLSearchParams({ ics: SAMPLE_ICS }), {
      origin: 'https://attacker.example.test',
      contentType: 'application/x-www-form-urlencoded'
    });
    expect(await (actions.review as ActionFn)(badOrigin)).toMatchObject({ status: 403 });
  } finally {
    db.close();
  }
});

it('reviews uploaded files and pasted text without writing, and rejects oversized or malformed input', async () => {
  const db = await setup();
  try {
    useSession(db, 'parent');

    // Multipart file upload
    const form = new FormData();
    form.set('file', new File([SAMPLE_ICS], 'school.ics', { type: 'text/calendar' }));
    const uploadReq = makeRequest('review', form);
    const uploaded = await (actions.review as ActionFn)(uploadReq) as { review: { items: unknown[]; toImport: number }; importKey: string };
    expect(uploaded.review.items).toHaveLength(2);
    expect(uploaded.review.toImport).toBe(2);
    expect(uploaded.importKey).toBeTruthy();
    expect(listEvents(db, 'parent', 'home', '2099-11-01', '2099-11-30')).toEqual([]);

    // Oversized header rejected with 413
    const tooBigHeader = makeRequest('review', new URLSearchParams({ ics: SAMPLE_ICS }), {
      contentType: 'application/x-www-form-urlencoded',
      contentLength: String(400 * 1024)
    });
    expect(await (actions.review as ActionFn)(tooBigHeader)).toMatchObject({ status: 413 });

    // Oversized file content rejected with 413
    const bigForm = new FormData();
    bigForm.set('file', new File(['x'.repeat(MAX_ICS_BYTES + 1)], 'huge.ics', { type: 'text/calendar' }));
    expect(await (actions.review as ActionFn)(makeRequest('review', bigForm))).toMatchObject({ status: 413 });

    // Malformed pasted text returns 400 and preserves pasted text
    const badText = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR';
    const malformed = makeRequest('review', new URLSearchParams({ ics: badText }), { contentType: 'application/x-www-form-urlencoded' });
    expect(await (actions.review as ActionFn)(malformed)).toMatchObject({ status: 400, data: { ics: badText } });
  } finally {
    db.close();
  }
});

it('confirms import with redirect carrying first date, view, added, and skipped counts, and preserves edits on 400/409', async () => {
  const db = await setup();
  try {
    useSession(db, 'parent');

    // Validation failure (400) retains submitted values and review
    const invalidKey = randomUUID();
    const invalid = await (actions.confirm as ActionFn)(makeRequest(
      'confirm',
      confirmBody([
        sampleDecision(0, { title: '   ', location: 'Main Gym' }),
        sampleDecision(1, { title: 'Second event', date: '2099-11-16' })
      ], invalidKey),
      { contentType: 'application/x-www-form-urlencoded' }
    )) as { status: number; data: { review: { items: Array<Record<string, unknown>> }; importKey: string } };
    expect(invalid.status).toBe(400);
    expect(invalid.data.review.items[0]).toMatchObject({ title: '   ', location: 'Main Gym' });
    expect(invalid.data.importKey).toBe(invalidKey);

    // Concurrent conflict (409) retains edits and lets parent resolve
    createEvent(db, 'parent', 'home', { title: 'School picture day', date: '2099-11-15', allDay: true });
    const conflictKey = randomUUID();
    const conflict = await (actions.confirm as ActionFn)(makeRequest(
      'confirm',
      confirmBody([
        sampleDecision(0, { title: 'School picture day', date: '2099-11-15', location: 'Gym A', action: 'import' }),
        sampleDecision(1, { title: 'Choir rehearsal', date: '2099-11-16', action: 'import' })
      ], conflictKey),
      { contentType: 'application/x-www-form-urlencoded' }
    )) as { status: number; data: { review: { items: Array<Record<string, unknown>> }; importKey: string } };
    expect(conflict.status).toBe(409);
    expect(conflict.data.review.items[0]).toMatchObject({ location: 'Gym A', existing: { kind: 'probable' } });

    // Resolving conflict by skipping row 0 succeeds and redirects with context
    const finalDecisions = [
      sampleDecision(0, { title: 'School picture day', date: '2099-11-15', action: 'skip' }),
      sampleDecision(1, { title: 'Choir rehearsal', date: '2099-11-16', action: 'import' })
    ];
    await expect((actions.confirm as ActionFn)(makeRequest(
      'confirm',
      confirmBody(finalDecisions, conflictKey),
      { contentType: 'application/x-www-form-urlencoded', query: 'date=2099-11-10&view=month' }
    ))).rejects.toMatchObject({
      status: 303,
      location: '/calendar?date=2099-11-16&view=month&added=1&skipped=1'
    });

    // Reusing same key with DIFFERENT payload returns 409 and issues a fresh importKey
    const keyConflict = await (actions.confirm as ActionFn)(makeRequest(
      'confirm',
      confirmBody([sampleDecision(0, { title: 'Different event', date: '2099-11-18', action: 'import' })], conflictKey),
      { contentType: 'application/x-www-form-urlencoded' }
    )) as { status: number; data: { importKey: string } };
    expect(keyConflict.status).toBe(409);
    expect(keyConflict.data.importKey).not.toBe(conflictKey);

    // Rejects rowCount out of bounds
    expect(await (actions.confirm as ActionFn)(makeRequest(
      'confirm',
      new URLSearchParams({ rowCount: String(MAX_ICS_EVENTS + 1), importKey: randomUUID() }),
      { contentType: 'application/x-www-form-urlencoded' }
    ))).toMatchObject({ status: 400 });
  } finally {
    db.close();
  }
});
