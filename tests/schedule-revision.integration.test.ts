import { afterEach, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../src/lib/server/identity';
import { createSeries, generateOccurrences, previewSeriesSchedule, reviseSeriesSchedule, SeriesChangeError, setSeriesState } from '../src/lib/server/recurring';
import { changeChore } from '../src/lib/server/chores';
import { listRecoveryGaps } from '../src/lib/server/recovery';

const opened: Database.Database[] = [];
afterEach(() => { vi.useRealTimers(); for (const db of opened.splice(0)) db.close(); });

async function fixture() {
  const db = new Database(':memory:');
  opened.push(db);
  db.pragma('foreign_keys = ON');
  await migrate(db);
  for (const [id, name] of [['parent', 'Parent'], ['parent-two', 'Parent Two'], ['kid', 'Kid'], ['sibling', 'Sibling'], ['other-parent', 'Other Parent'], ['other-kid', 'Other Kid']]) {
    db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, name, `${id}@example.test`);
  }
  db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'Synthetic');
  db.prepare('INSERT INTO household VALUES (?, ?)').run('other-home', 'Other Synthetic');
  for (const [user, household, role] of [
    ['parent', 'home', 'parent'],
    ['parent-two', 'home', 'parent'],
    ['kid', 'home', 'kid'],
    ['sibling', 'home', 'kid'],
    ['other-parent', 'other-home', 'parent'],
    ['other-kid', 'other-home', 'kid']
  ] as const) {
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(user, household, role);
  }
  return db;
}

const input = { title: 'Take out trash', description: 'Kitchen and curb', assigneeId: 'kid', rewardCents: 150 };
const today = '2026-11-22';
const effectiveDate = '2026-11-23';
const seriesInput = { ...input, startDate: '2026-11-16', weekdays: [1, 3] };

function occurrence(db: Database.Database, id: string, date: string) {
  return db.prepare('SELECT o.chore_id AS choreId, c.title, c.status, c.cancelled_at AS cancelledAt, c.due_date AS dueDate FROM recurring_occurrence o JOIN chore c ON c.id = o.chore_id WHERE o.series_id = ? AND o.scheduled_date = ?').get(id, date) as { choreId: string; title: string; status: string; cancelledAt: string | null; dueDate: string } | undefined;
}

function series(db: Database.Database, id: string) {
  return db.prepare('SELECT * FROM recurring_series WHERE id = ?').get(id) as { start_date: string; end_date: string | null; weekdays: string; state: string; updated_at: string; title: string; assignee_id: string; reward_cents: number | null };
}

function setStatus(db: Database.Database, id: string, date: string, status: string) {
  const row = occurrence(db, id, date)!;
  db.prepare('UPDATE chore SET status = ? WHERE id = ?').run(status, row.choreId);
}

it('revises future weekdays, cancels obsolete unstarted dates and preserves completed work', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-22T18:00:00Z'));
  const db = await fixture();
  const id = createSeries(db, 'parent', 'home', seriesInput);
  generateOccurrences(db, 'parent', 'home', '2026-11-16', '2026-12-06');
  // A past occurrence can be completed normally; a future one is marked pending through a synthetic fixture.
  changeChore(db, 'kid', 'home', occurrence(db, id, '2026-11-18')!.choreId, 'submit');
  changeChore(db, 'parent', 'home', occurrence(db, id, '2026-11-18')!.choreId, 'verify');
  setStatus(db, id, '2026-11-25', 'pending_verification');
  const before = series(db, id);
  const earningsBefore = db.prepare('SELECT count(*) AS count, COALESCE(SUM(amount_cents), 0) AS cents FROM earning').get();

  const preview = previewSeriesSchedule(db, 'parent', 'home', id, before.updated_at, { ...seriesInput, effectiveDate, weekdays: [2, 4] });
  expect(preview.oldPattern).toBe('Monday and Wednesday');
  expect(preview.newPattern).toBe('Tuesday and Thursday');
  expect(preview.firstAffectedDate).toBe(effectiveDate);
  expect(preview.cancelDates).toEqual(['2026-11-23', '2026-11-30', '2026-12-02']);
  expect(preview.preservedDates).toContain('2026-11-25');

  reviseSeriesSchedule(db, 'parent', 'home', id, before.updated_at, { ...seriesInput, effectiveDate, weekdays: [2, 4] });
  const revised = series(db, id);
  expect(revised).toMatchObject({ start_date: effectiveDate, weekdays: '[2,4]', title: 'Take out trash', assignee_id: 'kid', reward_cents: 150 });
  expect(revised.updated_at).not.toBe(before.updated_at);
  expect(occurrence(db, id, '2026-11-23')!.cancelledAt).toBeTruthy();
  expect(occurrence(db, id, '2026-11-30')!.cancelledAt).toBeTruthy();
  expect(occurrence(db, id, '2026-12-02')!.cancelledAt).toBeTruthy();
  expect(occurrence(db, id, '2026-11-25')).toMatchObject({ status: 'pending_verification', cancelledAt: null });
  expect(occurrence(db, id, '2026-11-18')).toMatchObject({ status: 'verified', cancelledAt: null });
  expect(occurrence(db, id, '2026-11-24')).toMatchObject({ title: 'Take out trash', status: 'todo', cancelledAt: null });
  expect(occurrence(db, id, '2026-11-26')).toMatchObject({ title: 'Take out trash', status: 'todo', cancelledAt: null });
  expect(db.prepare('SELECT count(*) AS count, COALESCE(SUM(amount_cents), 0) AS cents FROM earning').get()).toEqual(earningsBefore);

  const revision = db.prepare('SELECT * FROM recurring_schedule_revision WHERE series_id = ?').get(id) as { effective_date: string; old_start_date: string; old_weekdays: string; new_weekdays: string; cancelled_dates: string; created_dates: string; actor_id: string };
  expect(revision).toMatchObject({ effective_date: effectiveDate, old_start_date: '2026-11-16', old_weekdays: '[1,3]', new_weekdays: '[2,4]', actor_id: 'parent' });
  expect(JSON.parse(revision.cancelled_dates)).toEqual(['2026-11-23', '2026-11-30', '2026-12-02']);
  expect(JSON.parse(revision.created_dates)).toEqual(expect.arrayContaining(['2026-11-24', '2026-11-26']));

  const countBefore = db.prepare('SELECT count(*) AS count FROM recurring_occurrence WHERE series_id = ?').get(id);
  generateOccurrences(db, 'parent', 'home', effectiveDate, '2026-12-31');
  generateOccurrences(db, 'parent', 'home', effectiveDate, '2026-12-31');
  expect(db.prepare('SELECT count(*) AS count FROM recurring_occurrence WHERE series_id = ?').get(id)).toEqual(countBefore);
  expect(listRecoveryGaps(db, 'parent', 'home')).toEqual([]);
});

it('validates effective dates, end dates, membership, ended series and stale revisions', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-22T18:00:00Z'));
  const db = await fixture();
  const id = createSeries(db, 'parent', 'home', seriesInput);
  const current = series(db, id);
  const code = (fn: () => void) => {
    try { fn(); return 'none'; } catch (cause) { return cause instanceof SeriesChangeError ? cause.code : cause instanceof Error ? cause.message : 'other'; }
  };
  expect(code(() => reviseSeriesSchedule(db, 'parent', 'home', id, current.updated_at, { ...seriesInput, effectiveDate: today, weekdays: [2] }))).toBe('invalid');
  const future = createSeries(db, 'parent', 'home', { ...seriesInput, startDate: '2099-01-01' });
  const futureCurrent = series(db, future);
  expect(code(() => reviseSeriesSchedule(db, 'parent', 'home', future, futureCurrent.updated_at, { ...seriesInput, effectiveDate, weekdays: [2] }))).toBe('invalid');
  expect(code(() => reviseSeriesSchedule(db, 'parent', 'home', id, current.updated_at, { ...seriesInput, effectiveDate, endDate: '2026-11-20', weekdays: [2] }))).toBe('invalid');
  expect(code(() => reviseSeriesSchedule(db, 'kid', 'home', id, current.updated_at, { ...seriesInput, effectiveDate, weekdays: [2] }))).toBe('Not authorized');
  expect(code(() => reviseSeriesSchedule(db, 'other-parent', 'home', id, current.updated_at, { ...seriesInput, effectiveDate, weekdays: [2] }))).toBe('Not authorized');
  db.prepare("UPDATE membership SET disabled_at = 1, disabled_by = 'parent' WHERE user_id = 'kid'").run();
  expect(code(() => reviseSeriesSchedule(db, 'parent', 'home', id, current.updated_at, { ...seriesInput, effectiveDate, weekdays: [2] }))).toBe('invalid');
  db.prepare("UPDATE membership SET disabled_at = NULL, disabled_by = NULL WHERE user_id = 'kid'").run();

  expect(code(() => reviseSeriesSchedule(db, 'parent-two', 'home', id, current.updated_at, { ...seriesInput, effectiveDate, weekdays: [2, 4] }))).toBe('none');
  const newer = series(db, id);
  expect(code(() => reviseSeriesSchedule(db, 'parent', 'home', id, current.updated_at, { ...seriesInput, effectiveDate, weekdays: [5] }))).toBe('stale');
  expect(series(db, id)).toEqual(newer);
  setSeriesState(db, 'parent', 'home', id, 'ended');
  expect(code(() => reviseSeriesSchedule(db, 'parent', 'home', id, newer.updated_at, { ...seriesInput, effectiveDate, weekdays: [5] }))).toBe('ended');
});

it('shortens an end date by archiving later unstarted dates', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-22T18:00:00Z'));
  const db = await fixture();
  const id = createSeries(db, 'parent', 'home', seriesInput);
  generateOccurrences(db, 'parent', 'home', '2026-11-16', '2026-12-06');
  const current = series(db, id);
  reviseSeriesSchedule(db, 'parent', 'home', id, current.updated_at, { ...seriesInput, effectiveDate, endDate: '2026-11-30', weekdays: [1, 3] });
  expect(series(db, id).end_date).toBe('2026-11-30');
  expect(occurrence(db, id, '2026-11-23')).toMatchObject({ cancelledAt: null, status: 'todo' });
  expect(occurrence(db, id, '2026-11-25')).toMatchObject({ cancelledAt: null, status: 'todo' });
  expect(occurrence(db, id, '2026-11-30')).toMatchObject({ cancelledAt: null, status: 'todo' });
  expect(occurrence(db, id, '2026-12-02')!.cancelledAt).toBeTruthy();
});

it('keeps a paused series paused until it resumes, then generates the new dates once', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-22T18:00:00Z'));
  const db = await fixture();
  const id = createSeries(db, 'parent', 'home', seriesInput);
  generateOccurrences(db, 'parent', 'home', '2026-11-16', '2026-12-06');
  setSeriesState(db, 'parent', 'home', id, 'paused');
  const current = series(db, id);
  reviseSeriesSchedule(db, 'parent', 'home', id, current.updated_at, { ...seriesInput, effectiveDate, weekdays: [2, 4] });
  expect(occurrence(db, id, '2026-11-24')).toBeUndefined();
  expect(occurrence(db, id, '2026-11-23')!.cancelledAt).toBeTruthy();
  setSeriesState(db, 'parent', 'home', id, 'active');
  generateOccurrences(db, 'parent', 'home', effectiveDate, '2026-11-30');
  expect(occurrence(db, id, '2026-11-24')).toMatchObject({ status: 'todo', cancelledAt: null });
  expect(occurrence(db, id, '2026-11-26')).toMatchObject({ status: 'todo', cancelledAt: null });
});

it('does not create a date recorded as skipped and does not revive an archived old date', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-22T18:00:00Z'));
  const db = await fixture();
  const id = createSeries(db, 'parent', 'home', seriesInput);
  generateOccurrences(db, 'parent', 'home', '2026-11-16', '2026-12-06');
  db.prepare("INSERT INTO recurring_skip (series_id, scheduled_date) VALUES (?, '2026-11-24')").run(id);
  const current = series(db, id);
  reviseSeriesSchedule(db, 'parent', 'home', id, current.updated_at, { ...seriesInput, effectiveDate, weekdays: [2, 4] });
  expect(occurrence(db, id, '2026-11-24')).toBeUndefined();
  generateOccurrences(db, 'parent', 'home', effectiveDate, '2026-12-31');
  expect(occurrence(db, id, '2026-11-23')!.cancelledAt).toBeTruthy();
  expect(occurrence(db, id, '2026-11-24')).toBeUndefined();
});
