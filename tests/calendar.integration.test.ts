import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate as migrateDrizzle } from 'drizzle-orm/better-sqlite3/migrator';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from '../src/lib/server/identity';
import { createEvent, listEvents, cancelOccurrence, updateEvent, cancelEvent, addUnscheduled, updateUnscheduled, listUnscheduled, scheduleUnscheduled, archiveUnscheduled } from '../src/lib/server/calendar';

it('limits calendar management and reads to household members and preserves local recurrence dates', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    await migrate(db);
    for (const id of ['parent', 'kid', 'outsider']) db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, `${id}@example.test`);
    db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'Synthetic');
    db.prepare('INSERT INTO household VALUES (?, ?)').run('elsewhere', 'Synthetic other');
    db.prepare('INSERT INTO membership VALUES (?, ?, ?)').run('parent', 'home', 'parent');
    db.prepare('INSERT INTO membership VALUES (?, ?, ?)').run('kid', 'home', 'kid');
    db.prepare('INSERT INTO membership VALUES (?, ?, ?)').run('outsider', 'elsewhere', 'parent');
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
    db.prepare('INSERT INTO membership VALUES (?, ?, ?)').run('parent', 'home', 'parent');
    db.prepare('INSERT INTO membership VALUES (?, ?, ?)').run('kid', 'home', 'kid');
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
    db.prepare('INSERT INTO membership VALUES (?, ?, ?)').run('parent', 'home', 'parent');
    db.prepare('INSERT INTO membership VALUES (?, ?, ?)').run('outsider', 'elsewhere', 'parent');
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
    db.prepare('INSERT INTO membership VALUES (?, ?, ?)').run('parent', 'home', 'parent');
    db.prepare('INSERT INTO membership VALUES (?, ?, ?)').run('kid', 'home', 'kid');
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
