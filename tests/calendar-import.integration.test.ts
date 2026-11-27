import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { migrate } from '../src/lib/server/identity';
import { cancelEvent, createEvent, listEvents, listUpcomingEvents } from '../src/lib/server/calendar';
import {
  CalendarImportConflictError,
  CalendarImportKeyConflictError,
  CalendarImportValidationError,
  confirmCalendarImport,
  reviewCalendarImport
} from '../src/lib/server/calendar-import';
import type { ImportDecision } from '../src/lib/calendar/ics';

const SAMPLE_ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:school-holiday@example.test',
  'SUMMARY:Fall break',
  'DTSTART;VALUE=DATE:20991110',
  'DTEND;VALUE=DATE:20991111',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:soccer-practice@example.test',
  'SUMMARY:Soccer practice',
  'LOCATION:Field 3',
  'DESCRIPTION:Bring cleats',
  'DTSTART;TZID=America/New_York:20991111T180000',
  'DTEND;TZID=America/New_York:20991111T193000',
  'RRULE:FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20991125',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n');

async function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  await migrate(db);
  for (const id of ['parent', 'parent2', 'kid', 'outsider', 'disabled']) {
    db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, `${id}@example.test`);
  }
  for (const id of ['home', 'other']) db.prepare('INSERT INTO household VALUES (?, ?)').run(id, id);
  db.prepare('INSERT INTO household_settings (household_id, timezone) VALUES (?, ?)').run('home', 'America/Chicago');
  db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('parent', 'home', 'parent');
  db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('parent2', 'home', 'parent');
  db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('kid', 'home', 'kid');
  db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('outsider', 'other', 'parent');
  db.prepare('INSERT INTO membership (user_id, household_id, role, disabled_at, disabled_by) VALUES (?, ?, ?, ?, ?)').run('disabled', 'home', 'parent', Date.now(), 'parent');
  return db;
}

function decision(overrides: Partial<ImportDecision> = {}): ImportDecision {
  return {
    key: 'ics:0',
    sourceUid: 'evt-1@example.test',
    originalSummary: 'School concert',
    action: 'import',
    title: 'School concert',
    date: '2099-11-12',
    endDate: '',
    allDay: false,
    startTime: '18:00',
    endTime: '19:30',
    weekdays: [],
    location: 'Auditorium',
    description: 'Doors open at 5:30',
    participants: [],
    ...overrides
  };
}

it('reviews without writing, imports events privately with participants, and projects them to calendar and My Day', async () => {
  const db = await setup();
  try {
    const preview = reviewCalendarImport(db, 'parent', 'home', SAMPLE_ICS);
    expect('review' in preview && preview.review.items).toHaveLength(2);
    expect(listEvents(db, 'parent', 'home', '2099-11-01', '2099-11-30')).toEqual([]);

    if (!('review' in preview)) throw new Error('Expected review');
    // America/New_York 18:00-19:30 -> America/Chicago 17:00-18:30
    expect(preview.review.items[1]).toMatchObject({
      title: 'Soccer practice',
      date: '2099-11-11',
      startTime: '17:00',
      endTime: '18:30',
      weekdays: [2, 4],
      endDate: '2099-11-25'
    });

    const decisions: ImportDecision[] = preview.review.items.map((item, idx) => ({
      key: item.key,
      sourceUid: item.sourceUid,
      originalSummary: item.originalSummary,
      action: item.action,
      title: item.title,
      date: item.date,
      endDate: item.endDate,
      allDay: item.allDay,
      startTime: item.startTime,
      endTime: item.endTime,
      weekdays: item.weekdays,
      location: item.location,
      description: item.description,
      participants: idx === 1 ? ['kid'] : []
    }));

    const key = randomUUID();
    const result = confirmCalendarImport(db, 'parent', 'home', decisions, key);
    expect(result).toEqual({ added: 2, skipped: 0, firstDate: '2099-11-10', replayed: false });

    // Imported events appear on calendar for both parent and kid, and on My Day Coming up
    const calendar = listEvents(db, 'kid', 'home', '2099-11-10', '2099-11-18');
    expect(calendar.map(e => `${e.date} ${e.title}`)).toEqual([
      '2099-11-10 Fall break',
      '2099-11-12 Soccer practice',
      '2099-11-17 Soccer practice'
    ]);
    expect(calendar[1].participants).toEqual(['kid']);
    expect(listUpcomingEvents(db, 'kid', 'home', '2099-11-10', '2099-11-16').map(e => e.title)).toEqual([
      'Fall break',
      'Soccer practice'
    ]);

    // Imported events are strictly private by default (never auto-shared on display)
    expect(db.prepare('SELECT COUNT(*) AS count FROM display_event WHERE household_id = ?').get('home')).toEqual({ count: 0 });
    // Cross-household isolation
    expect(listEvents(db, 'outsider', 'other', '2099-11-01', '2099-11-30')).toEqual([]);

    // Re-importing the same file detects both events by UID and defaults them to skip
    const secondPreview = reviewCalendarImport(db, 'parent', 'home', SAMPLE_ICS);
    expect('review' in secondPreview && secondPreview.review).toMatchObject({ toImport: 0, toSkip: 2, duplicateCount: 2 });
    if ('review' in secondPreview) {
      expect(secondPreview.review.items.every(item => item.existing?.kind === 'uid')).toBe(true);
    }

    // Cancelling an imported event means re-importing its UID is no longer treated as an active duplicate
    const fallBreakId = calendar[0].id;
    cancelEvent(db, 'parent', 'home', fallBreakId);
    const afterCancel = reviewCalendarImport(db, 'parent', 'home', SAMPLE_ICS);
    if ('review' in afterCancel) {
      expect(afterCancel.review.items[0]).toMatchObject({ action: 'import', existing: null });
      expect(afterCancel.review.items[1]).toMatchObject({ action: 'skip', existing: { kind: 'uid' } });
    }
  } finally {
    db.close();
  }
});

it('rejects child, disabled, outsider, and cross-household participants without writing', async () => {
  const db = await setup();
  try {
    expect(() => reviewCalendarImport(db, 'kid', 'home', SAMPLE_ICS)).toThrow(/Not authorized/);
    expect(() => reviewCalendarImport(db, 'disabled', 'home', SAMPLE_ICS)).toThrow(/Not authorized/);
    expect(() => reviewCalendarImport(db, 'outsider', 'home', SAMPLE_ICS)).toThrow(/Not authorized/);

    const valid = [decision()];
    expect(() => confirmCalendarImport(db, 'kid', 'home', valid, randomUUID())).toThrow(/Not authorized/);
    expect(() => confirmCalendarImport(db, 'disabled', 'home', valid, randomUUID())).toThrow(/Not authorized/);
    expect(() => confirmCalendarImport(db, 'outsider', 'home', valid, randomUUID())).toThrow(/Not authorized/);

    // Forged participant from another household or disabled member rejects the entire batch atomically
    expect(() => confirmCalendarImport(db, 'parent', 'home', [
      decision({ key: 'ics:0', sourceUid: 'ok@example.test', title: 'Valid event' }),
      decision({ key: 'ics:1', sourceUid: 'bad@example.test', title: 'Foreign participant', participants: ['outsider'] })
    ], randomUUID())).toThrow(CalendarImportValidationError);

    expect(() => confirmCalendarImport(db, 'parent', 'home', [
      decision({ key: 'ics:0', participants: ['disabled'] })
    ], randomUUID())).toThrow(CalendarImportValidationError);

    expect(listEvents(db, 'parent', 'home', '2099-11-01', '2099-11-30')).toEqual([]);
  } finally {
    db.close();
  }
});

it('skips validation on skipped rows, rejects invalid active rows atomically, and rejects zero-occurrence recurrences', async () => {
  const db = await setup();
  try {
    // Skipped row has empty title and broken times — must still succeed without validating skipped rows
    const skippedRes = confirmCalendarImport(db, 'parent', 'home', [
      decision({ key: 'ics:0', title: 'Valid dinner', date: '2099-11-12', allDay: true, startTime: '', endTime: '' }),
      decision({ key: 'ics:1', action: 'skip', title: '', date: 'not-a-date', startTime: '25:00', endTime: '01:00', participants: ['outsider'] })
    ], randomUUID());
    expect(skippedRes).toEqual({ added: 1, skipped: 1, firstDate: '2099-11-12', replayed: false });

    // Zero-occurrence recurrence (2099-11-12 is Thursday; endDate 2099-11-13 is Friday; weekday 0=Sunday)
    expect(() => confirmCalendarImport(db, 'parent', 'home', [
      decision({ key: 'ics:0', sourceUid: 'zero@example.test', title: 'Zero occ', date: '2099-11-12', endDate: '2099-11-13', allDay: true, startTime: '', endTime: '', weekdays: [0] })
    ], randomUUID())).toThrow(CalendarImportValidationError);

    // End date without weekdays
    expect(() => confirmCalendarImport(db, 'parent', 'home', [
      decision({ key: 'ics:0', sourceUid: 'end-no-days@example.test', title: 'No weekdays', date: '2099-11-12', endDate: '2099-11-20', allDay: true, startTime: '', endTime: '', weekdays: [] })
    ], randomUUID())).toThrow(CalendarImportValidationError);

    expect(listEvents(db, 'parent', 'home', '2099-11-01', '2099-11-30')).toHaveLength(1);
  } finally {
    db.close();
  }
});

it('rejects concurrent duplicate conflicts atomically unless keep_duplicate is chosen, and enforces idempotency + key conflict', async () => {
  const db = await setup();
  try {
    createEvent(db, 'parent2', 'home', { title: 'School concert', date: '2099-11-12', allDay: false, startTime: '18:00', endTime: '19:30' });

    // Confirming with action 'import' collides with parent2's newly created event -> 0 rows added
    expect(() => confirmCalendarImport(db, 'parent', 'home', [
      decision({ key: 'ics:0', sourceUid: 'first@example.test', title: 'Other event', date: '2099-11-13', allDay: true, startTime: '', endTime: '' }),
      decision({ key: 'ics:1', sourceUid: 'conflict@example.test', title: 'School concert', date: '2099-11-12', allDay: false, startTime: '18:00', endTime: '19:30', action: 'import' })
    ], randomUUID())).toThrow(CalendarImportConflictError);
    expect(listEvents(db, 'parent', 'home', '2099-11-01', '2099-11-30')).toHaveLength(1);

    // Explicitly opting in with keep_duplicate succeeds
    const key = randomUUID();
    const keepBatch = [
      decision({ key: 'ics:0', sourceUid: 'first@example.test', title: 'Other event', date: '2099-11-13', allDay: true, startTime: '', endTime: '' }),
      decision({ key: 'ics:1', sourceUid: 'conflict@example.test', title: 'School concert', date: '2099-11-12', allDay: false, startTime: '18:00', endTime: '19:30', action: 'keep_duplicate' })
    ];
    expect(confirmCalendarImport(db, 'parent', 'home', keepBatch, key)).toEqual({ added: 2, skipped: 0, firstDate: '2099-11-12', replayed: false });
    expect(listEvents(db, 'parent', 'home', '2099-11-01', '2099-11-30')).toHaveLength(3);

    // Repeating exact same key + payload is idempotent
    expect(confirmCalendarImport(db, 'parent', 'home', keepBatch, key)).toEqual({ added: 2, skipped: 0, firstDate: '2099-11-12', replayed: true });
    expect(listEvents(db, 'parent', 'home', '2099-11-01', '2099-11-30')).toHaveLength(3);

    // Reusing same key with a DIFFERENT payload rejects with CalendarImportKeyConflictError
    expect(() => confirmCalendarImport(db, 'parent', 'home', [
      decision({ key: 'ics:0', sourceUid: 'different@example.test', title: 'Changed title', date: '2099-11-14', allDay: true, startTime: '', endTime: '' })
    ], key)).toThrow(CalendarImportKeyConflictError);
    expect(listEvents(db, 'parent', 'home', '2099-11-01', '2099-11-30')).toHaveLength(3);
  } finally {
    db.close();
  }
});

it('blocks calendar import when parent membership revocation commits while the writer lock is held', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'calendar-import-revocation-'));
  const path = join(directory, 'household.sqlite');
  const db = new Database(path);
  try {
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    await migrate(db);
    db.exec(`
      INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
      VALUES ('parent', 'Parent', 'parent@example.test', 0, 0, 0), ('parent2', 'Parent Two', 'parent2@example.test', 0, 0, 0);
      INSERT INTO household VALUES ('home', 'Synthetic');
      INSERT INTO membership (user_id, household_id, role) VALUES ('parent', 'home', 'parent'), ('parent2', 'home', 'parent');
    `);

    db.exec('BEGIN IMMEDIATE');
    db.prepare("UPDATE membership SET disabled_at = 1, disabled_by = 'parent' WHERE user_id = 'parent2' AND household_id = 'home'").run();

    const worker = spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/confirm-calendar-import.ts', path, randomUUID()], {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      signal: AbortSignal.timeout(4000),
      killSignal: 'SIGKILL'
    });
    const exited = new Promise<void>(resolve => worker.once('close', () => resolve()));
    let stderr = '';
    worker.stderr?.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    try {
      const outcome = await new Promise<string>((resolve, reject) => {
        let result: string | undefined;
        worker.on('error', reject);
        worker.on('message', message => {
          if (message === 'ready') {
            worker.send('go', error => { if (error) reject(error); });
          } else if (message === 'attempting') {
            try { db.exec('COMMIT'); } catch (error) { reject(error); }
          } else if (typeof message === 'string') {
            result = message;
          }
        });
        worker.once('close', code => {
          if (code === 0 && result !== undefined) resolve(result);
          else reject(new Error(`Calendar import worker exited unexpectedly (${code}): ${stderr.trim()}`));
        });
      });
      expect(outcome).toBe('Not authorized');
      expect(listEvents(db, 'parent', 'home', '2099-05-01', '2099-05-31')).toEqual([]);
    } finally {
      if (worker.exitCode === null && worker.signalCode === null) worker.kill('SIGKILL');
      await exited;
    }
  } finally {
    if (db.inTransaction) db.exec('ROLLBACK');
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
