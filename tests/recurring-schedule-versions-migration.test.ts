import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('upgrades recurring schedules from 0023_family_checklists with versions and archived occurrence tracking', () => {
  const baselinePath = mkdtempSync(join(tmpdir(), 'recurring-schedule-versions-upgrade-'));
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    db.exec(readFileSync('drizzle/auth/0001_better_auth.sql', 'utf8'));
    const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as { entries: { tag: string }[] };
    const prefix = (entries: typeof journal.entries) => entries.slice(0, entries.findIndex(entry => entry.tag === '0023_family_checklists') + 1);
    const previous = prefix(journal.entries);
    expect(previous.at(-1)?.tag).toBe('0023_family_checklists');
    expect(prefix([...journal.entries, { tag: '9999_future' }])).toEqual(previous);
    mkdirSync(join(baselinePath, 'meta'));
    for (const entry of previous) copyFileSync(`drizzle/${entry.tag}.sql`, join(baselinePath, `${entry.tag}.sql`));
    writeFileSync(join(baselinePath, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: previous }));
    migrate(drizzle(db), { migrationsFolder: baselinePath });

    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'recurring_series_version'").get()).toBeUndefined();
    expect(db.prepare('PRAGMA table_info(recurring_occurrence)').all().map(column => (column as { name: string }).name)).not.toContain('archived_at');

    db.exec(`
      INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('parent', 'Synthetic Parent', 'parent@example.test', 0, 0, 0);
      INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('child', 'Synthetic Child', 'child@example.test', 0, 0, 0);
      INSERT INTO household VALUES ('home', 'Synthetic household');
      INSERT INTO membership (user_id, household_id, role) VALUES ('parent', 'home', 'parent');
      INSERT INTO membership (user_id, household_id, role) VALUES ('child', 'home', 'kid');
      INSERT INTO recurring_series (id, household_id, creator_id, assignee_id, title, start_date, weekdays, state, created_at, updated_at)
        VALUES ('series', 'home', 'parent', 'child', 'Synthetic trash', '2026-05-01', '[1,3]', 'active', '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z');
      INSERT INTO chore (id, household_id, assignee_id, title, due_date, reward_cents, status, created_at, updated_at)
        VALUES ('active-chore', 'home', 'child', 'Synthetic trash', '2026-05-04', 200, 'verified', '2026-05-04T00:00:00.000Z', '2026-05-04T00:00:00.000Z');
      INSERT INTO chore (id, household_id, assignee_id, title, due_date, reward_cents, status, created_at, updated_at, cancelled_at, cancelled_by)
        VALUES ('cancelled-chore', 'home', 'child', 'Synthetic trash', '2026-05-06', 200, 'todo', '2026-05-04T00:00:00.000Z', '2026-05-05T00:00:00.000Z', '2026-05-05T00:00:00.000Z', 'parent');
      INSERT INTO earning VALUES ('earn-1', 'active-chore', 'home', 'child', 200, '2026-05-04T00:00:00.000Z');
      INSERT INTO recurring_occurrence (series_id, household_id, scheduled_date, chore_id) VALUES ('series', 'home', '2026-05-04', 'active-chore');
      INSERT INTO recurring_occurrence (series_id, household_id, scheduled_date, chore_id) VALUES ('series', 'home', '2026-05-06', 'cancelled-chore');
    `);
    const seriesBefore = db.prepare('SELECT * FROM recurring_series').all();
    const earningBefore = db.prepare('SELECT * FROM earning').all();

    migrate(drizzle(db), { migrationsFolder: 'drizzle' });
    migrate(drizzle(db), { migrationsFolder: 'drizzle' });

    expect(db.prepare('SELECT * FROM recurring_series').all()).toEqual(seriesBefore);
    expect(db.prepare('SELECT * FROM earning').all()).toEqual(earningBefore);
    expect(db.prepare('SELECT series_id, effective_date, weekdays, title FROM recurring_series_version').all()).toEqual([
      { series_id: 'series', effective_date: '2026-05-01', weekdays: '[1,3]', title: 'Synthetic trash' }
    ]);
    expect(db.prepare('SELECT chore_id, scheduled_date, archived_at FROM recurring_occurrence ORDER BY scheduled_date').all()).toEqual([
      { chore_id: 'active-chore', scheduled_date: '2026-05-04', archived_at: null },
      { chore_id: 'cancelled-chore', scheduled_date: '2026-05-06', archived_at: '2026-05-05T00:00:00.000Z' }
    ]);

    // A previously cancelled date can now accept a fresh active occurrence, while two active occurrences on one date are rejected.
    db.prepare("INSERT INTO chore (id, household_id, assignee_id, title, due_date, reward_cents, status, created_at, updated_at) VALUES ('readded-chore', 'home', 'child', 'Synthetic trash', '2026-05-06', 200, 'todo', '2026-05-06T00:00:00.000Z', '2026-05-06T00:00:00.000Z')").run();
    db.prepare("INSERT INTO recurring_occurrence (series_id, household_id, scheduled_date, chore_id) VALUES ('series', 'home', '2026-05-06', 'readded-chore')").run();
    db.prepare("INSERT INTO chore (id, household_id, assignee_id, title, due_date, reward_cents, status, created_at, updated_at) VALUES ('dup-chore', 'home', 'child', 'Synthetic trash', '2026-05-06', 200, 'todo', '2026-05-06T00:00:00.000Z', '2026-05-06T00:00:00.000Z')").run();
    expect(() => db.prepare("INSERT INTO recurring_occurrence (series_id, household_id, scheduled_date, chore_id) VALUES ('series', 'home', '2026-05-06', 'dup-chore')").run()).toThrow();

    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
  } finally {
    db.close();
    rmSync(baselinePath, { recursive: true, force: true });
  }
});
