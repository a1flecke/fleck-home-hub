import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate as migrateDrizzle } from 'drizzle-orm/better-sqlite3/migrator';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from '../src/lib/server/identity';
import { createEvent, listEvents, listUpcomingEvents, hasEventOccurrence, findSavedEventElsewhere, cancelOccurrence, updateEvent, cancelEvent, addUnscheduled, updateUnscheduled, listUnscheduled, scheduleUnscheduled, archiveUnscheduled } from '../src/lib/server/calendar';

it('limits calendar management and reads to household members and preserves local recurrence dates', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    await migrate(db);
    for (const id of ['parent', 'kid', 'outsider']) db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, `${id}@example.test`);
    db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'Synthetic');
    db.prepare('INSERT INTO household VALUES (?, ?)').run('elsewhere', 'Synthetic other');
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('parent', 'home', 'parent');
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('kid', 'home', 'kid');
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('outsider', 'elsewhere', 'parent');
    const event = { title: 'Family walk', date: '2026-03-07', startTime: '09:00', endTime: '10:00', allDay: false, weekdays: [0, 6], participants: ['kid'] };
    expect(() => createEvent(db, 'kid', 'home', event)).toThrow();
    expect(() => createEvent(db, 'outsider', 'home', event)).toThrow();
    expect(() => createEvent(db, 'parent', 'home', { ...event, participants: ['outsider'] })).toThrow();
    expect(() => createEvent(db, 'parent', 'home', { ...event, date: '2026-02-30' })).toThrow();
    expect(() => createEvent(db, 'parent', 'home', { ...event, endTime: '08:00' })).toThrow();
    expect(() => createEvent(db, 'parent', 'home', { ...event, weekdays: [7] })).toThrow();
    const id = createEvent(db, 'parent', 'home', event);
    createEvent(db, 'parent', 'home', { title: 'Overlap', date: '2026-03-07', startTime: '09:30', endTime: '10:30', allDay: false });
    expect(() => listEvents(db, 'outsider', 'home', '2026-03-07', '2026-03-09')).toThrow();
    expect(listEvents(db, 'kid', 'home', '2026-03-07', '2026-03-09').map(item => [item.date, item.startTime])).toEqual([['2026-03-07', '09:00'], ['2026-03-07', '09:30'], ['2026-03-08', '09:00']]);
    expect(() => cancelOccurrence(db, 'kid', 'home', id, '2026-03-08')).toThrow();
    cancelOccurrence(db, 'parent', 'home', id, '2026-03-08');
    expect(listEvents(db, 'kid', 'home', '2026-03-07', '2026-03-09').map(item => item.date)).toEqual(['2026-03-07', '2026-03-07']);
  } finally { db.close(); }
});

it('upgrades a payout database and preserves existing household financial data', () => {
  const directory = mkdtempSync(join(tmpdir(), 'hub-calendar-migration-'));
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON'); mkdirSync(join(directory, 'meta'));
    for (const name of ['0000_household', '0001_chores', '0002_recurring', '0003_payouts']) copyFileSync(`drizzle/${name}.sql`, join(directory, `${name}.sql`));
    const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8'));
    journal.entries = journal.entries.slice(0, 4);
    writeFileSync(join(directory, 'meta/_journal.json'), JSON.stringify(journal));
    db.exec('CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL)');
    migrateDrizzle(drizzle(db), { migrationsFolder: directory });
    for (const id of ['parent', 'kid']) db.prepare('INSERT INTO user VALUES (?)').run(id);
    db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'Synthetic');
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('parent', 'home', 'parent');
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('kid', 'home', 'kid');
    db.prepare("INSERT INTO chore VALUES (?, ?, ?, ?, NULL, ?, ?, 'verified', NULL, ?, ?)").run('chore', 'home', 'kid', 'Synthetic', '2026-01-01', 200, '2026-01-01', '2026-01-01');
    db.prepare('INSERT INTO earning VALUES (?, ?, ?, ?, ?, ?)').run('earning', 'chore', 'home', 'kid', 200, '2026-01-01');
    migrateDrizzle(drizzle(db), { migrationsFolder: 'drizzle' });
    migrateDrizzle(drizzle(db), { migrationsFolder: 'drizzle' });
    expect(db.prepare('SELECT amount_cents FROM earning').get()).toEqual({ amount_cents: 200 });
    expect(db.prepare('SELECT count(*) AS count FROM membership').get()).toEqual({ count: 2 });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'calendar_event'").get()).toEqual({ name: 'calendar_event' });
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

it('edits and cancels an event without permitting cross-household changes', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON'); await migrate(db);
    for (const id of ['parent', 'outsider']) db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, `${id}@example.test`);
    for (const id of ['home', 'elsewhere']) db.prepare('INSERT INTO household VALUES (?, ?)').run(id, id);
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('parent', 'home', 'parent');
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('outsider', 'elsewhere', 'parent');
    const input = { title: 'Dinner', date: '2026-11-01', allDay: true, participants: [] };
    const id = createEvent(db, 'parent', 'home', input);
    expect(() => updateEvent(db, 'outsider', 'elsewhere', id, { ...input, title: 'Intrusion' })).toThrow();
    updateEvent(db, 'parent', 'home', id, { ...input, title: 'Family dinner' });
    expect(listEvents(db, 'parent', 'home', '2026-11-01', '2026-11-01')[0].title).toBe('Family dinner');
    cancelEvent(db, 'parent', 'home', id);
    expect(listEvents(db, 'parent', 'home', '2026-11-01', '2026-11-01')).toEqual([]);
  } finally { db.close(); }
});

it('schedules an inbox item transactionally and forbids children from managing it', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON'); await migrate(db);
    for (const id of ['parent', 'kid']) db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, `${id}@example.test`);
    db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'Synthetic');
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('parent', 'home', 'parent');
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('kid', 'home', 'kid');
    expect(() => addUnscheduled(db, 'kid', 'home', { title: 'Dentist' })).toThrow();
    const id = addUnscheduled(db, 'parent', 'home', { title: 'Dentist', ownerId: 'kid' });
    expect(listUnscheduled(db, 'kid', 'home')).toHaveLength(1);
    expect(() => updateUnscheduled(db, 'kid', 'home', id, { title: 'Wrong' })).toThrow();
    updateUnscheduled(db, 'parent', 'home', id, { title: 'Dentist appointment', ownerId: 'kid', description: 'Bring paperwork' });
    expect(listUnscheduled(db, 'parent', 'home')[0]).toMatchObject({ title: 'Dentist appointment', ownerId: 'kid', description: 'Bring paperwork' });
    const input = { title: 'Dentist', date: '2026-11-02', allDay: true, participants: ['kid'] };
    expect(() => scheduleUnscheduled(db, 'kid', 'home', id, input)).toThrow();
    scheduleUnscheduled(db, 'parent', 'home', id, input);
    expect(() => scheduleUnscheduled(db, 'parent', 'home', id, input)).toThrow();
    expect(listEvents(db, 'parent', 'home', '2026-11-02', '2026-11-02')).toHaveLength(1);
    expect(listUnscheduled(db, 'parent', 'home')).toEqual([]);
    const archived = addUnscheduled(db, 'parent', 'home', { title: 'Another' });
    archiveUnscheduled(db, 'parent', 'home', archived);
    expect(listUnscheduled(db, 'parent', 'home')).toEqual([]);
  } finally { db.close(); }
});

it('rejects recurring events with zero matching occurrences while allowing valid short and multi-year spans', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON'); await migrate(db);
    db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run('parent', 'Parent', 'parent@example.test');
    db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'Synthetic');
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('parent', 'home', 'parent');

    // Mon 2026-11-02 through Wed 2026-11-04 has no Friday (weekday 5).
    const emptyRecurrence = { title: 'Ghost Friday', date: '2026-11-02', endDate: '2026-11-04', allDay: true, weekdays: [5] };
    expect(() => createEvent(db, 'parent', 'home', emptyRecurrence)).toThrow();
    const inboxId = addUnscheduled(db, 'parent', 'home', { title: 'Inbox ghost' });
    expect(() => scheduleUnscheduled(db, 'parent', 'home', inboxId, emptyRecurrence)).toThrow();
    expect(listUnscheduled(db, 'parent', 'home')).toHaveLength(1);

    // Valid short span (Wed 2026-11-04 matches weekday 3) and valid multi-year span (> 366 days) succeed.
    const validId = createEvent(db, 'parent', 'home', { title: 'Wednesday check', date: '2026-11-02', endDate: '2026-11-04', allDay: true, weekdays: [3] });
    expect(listEvents(db, 'parent', 'home', '2026-11-02', '2026-11-04').map(event => event.date)).toEqual(['2026-11-04']);
    expect(() => updateEvent(db, 'parent', 'home', validId, emptyRecurrence)).toThrow();
    expect(listEvents(db, 'parent', 'home', '2026-11-02', '2026-11-04').map(event => event.title)).toEqual(['Wednesday check']);

    const multiYearId = createEvent(db, 'parent', 'home', { title: 'Multi-year Friday', date: '2026-01-01', endDate: '2028-12-31', allDay: true, weekdays: [5] });
    expect(listEvents(db, 'parent', 'home', '2026-01-01', '2026-01-07').some(event => event.id === multiYearId)).toBe(true);
  } finally { db.close(); }
});

it('rejects cancelOccurrence on one-off events so they cannot become phantom uncancelled rows', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON'); await migrate(db);
    db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run('parent', 'Parent', 'parent@example.test');
    db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'Synthetic');
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('parent', 'home', 'parent');

    const oneOffId = createEvent(db, 'parent', 'home', { title: 'Single dentist visit', date: '2026-11-05', allDay: true });
    expect(() => cancelOccurrence(db, 'parent', 'home', oneOffId, '2026-11-05')).toThrow();
    expect(db.prepare('SELECT count(*) AS count FROM calendar_exception WHERE event_id = ?').get(oneOffId)).toEqual({ count: 0 });
    expect(listEvents(db, 'parent', 'home', '2026-11-05', '2026-11-05').map(event => event.id)).toEqual([oneOffId]);

    // Cancelling the whole one-off event via cancelEvent still works cleanly.
    cancelEvent(db, 'parent', 'home', oneOffId);
    expect(listEvents(db, 'parent', 'home', '2026-11-05', '2026-11-05')).toEqual([]);
  } finally { db.close(); }
});

it('bounds calendar queries without scanning historical one-off events or running N+1 lookups', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON'); await migrate(db);
    for (const id of ['parent', 'kid']) db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, `${id}@example.test`);
    db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'Synthetic');
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('parent', 'home', 'parent');
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('kid', 'home', 'kid');

    // Seed 25 historical one-off events and 10 non-matching recurring events.
    for (let day = 1; day <= 25; day += 1) {
      const date = `2025-01-${String(day).padStart(2, '0')}`;
      createEvent(db, 'parent', 'home', { title: `Past one-off ${day}`, date, allDay: true, participants: ['kid'] });
    }
    for (let i = 1; i <= 10; i += 1) {
      createEvent(db, 'parent', 'home', { title: `Tuesday series ${i}`, date: '2025-01-07', allDay: true, weekdays: [2], participants: ['kid'] });
    }
    const matchingOneOff = createEvent(db, 'parent', 'home', { title: 'Monday dentist', date: '2026-11-23', startTime: '09:00', endTime: '10:00', allDay: false, participants: ['kid'] });
    const matchingSeries = createEvent(db, 'parent', 'home', { title: 'Monday soccer', date: '2024-01-01', startTime: '16:00', endTime: '17:00', allDay: false, weekdays: [1], participants: ['parent', 'kid'] });

    const originalPrepare = db.prepare.bind(db);
    const statements: string[] = [];
    db.prepare = ((sql: string) => {
      statements.push(sql);
      return originalPrepare(sql);
    }) as typeof db.prepare;

    statements.length = 0;
    const listed = listEvents(db, 'parent', 'home', '2026-11-23', '2026-11-23');
    expect(listed.map(item => item.id)).toEqual([matchingOneOff, matchingSeries]);
    expect(listed[1].participants.sort()).toEqual(['kid', 'parent']);
    expect(statements.length).toBeLessThanOrEqual(4);
    expect(statements.filter(sql => /calendar_participant/i.test(sql)).length).toBeLessThanOrEqual(1);
    expect(statements.filter(sql => /calendar_exception/i.test(sql)).length).toBeLessThanOrEqual(1);

    statements.length = 0;
    const upcoming = listUpcomingEvents(db, 'parent', 'home', '2026-11-23', '2026-11-23');
    expect(upcoming.map(item => item.id)).toEqual([matchingOneOff, matchingSeries]);
    expect(statements.length).toBeLessThanOrEqual(3);
    expect(statements.filter(sql => /calendar_participant/i.test(sql))).toEqual([]);

    statements.length = 0;
    cancelOccurrence(db, 'parent', 'home', matchingSeries, '2026-11-23');
    expect(statements.filter(sql => /calendar_participant/i.test(sql))).toEqual([]);
    expect(statements.filter(sql => /SELECT \* FROM calendar_event/i.test(sql))).toEqual([]);
    expect(listEvents(db, 'parent', 'home', '2026-11-23', '2026-11-23').map(item => item.id)).toEqual([matchingOneOff]);
  } finally { db.close(); }
});

it('finds the nearest saved occurrence relative to the viewed range instead of jumping to seriesDate', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON'); await migrate(db);
    for (const id of ['parent', 'outsider']) db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, `${id}@example.test`);
    for (const id of ['home', 'elsewhere']) db.prepare('INSERT INTO household VALUES (?, ?)').run(id, id);
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('parent', 'home', 'parent');
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('outsider', 'elsewhere', 'parent');

    // Weekly Tuesday series started in 2024.
    const seriesId = createEvent(db, 'parent', 'home', { title: 'Weekly piano', date: '2024-01-01', allDay: true, weekdays: [2] });
    // Viewed on Tuesday 2026-11-24: already in view -> null.
    expect(findSavedEventElsewhere(db, 'parent', 'home', seriesId, { start: '2026-11-24', end: '2026-11-24' })).toBeNull();
    // Viewed on Monday 2026-11-23: links to next upcoming Tuesday 2026-11-24 (not 2024-01-02).
    expect(findSavedEventElsewhere(db, 'parent', 'home', seriesId, { start: '2026-11-23', end: '2026-11-23' })).toBe('2026-11-24');
    // Cancel 2026-11-24 -> skips the cancelled occurrence and links to 2026-12-01.
    cancelOccurrence(db, 'parent', 'home', seriesId, '2026-11-24');
    expect(hasEventOccurrence(db, 'parent', 'home', seriesId, '2026-11-24')).toBe(false);
    expect(hasEventOccurrence(db, 'parent', 'home', seriesId, '2026-12-01')).toBe(true);
    expect(findSavedEventElsewhere(db, 'parent', 'home', seriesId, { start: '2026-11-23', end: '2026-11-23' })).toBe('2026-12-01');
    // Series ended before the viewed date -> links to latest occurrence before the viewed date.
    updateEvent(db, 'parent', 'home', seriesId, { title: 'Weekly piano', date: '2024-01-01', endDate: '2026-11-20', allDay: true, weekdays: [2] });
    expect(findSavedEventElsewhere(db, 'parent', 'home', seriesId, { start: '2026-11-23', end: '2026-11-23' })).toBe('2026-11-17');
    // Far-future one-off event links directly to its own date.
    const futureId = createEvent(db, 'parent', 'home', { title: 'Future reunion', date: '2099-03-08', allDay: true });
    expect(findSavedEventElsewhere(db, 'parent', 'home', futureId, { start: '2026-11-23', end: '2026-11-23' })).toBe('2099-03-08');
    // Cross-household access is rejected.
    expect(() => findSavedEventElsewhere(db, 'outsider', 'home', seriesId, null)).toThrow();
    expect(() => hasEventOccurrence(db, 'outsider', 'home', seriesId, '2026-11-17')).toThrow();
  } finally { db.close(); }
});
