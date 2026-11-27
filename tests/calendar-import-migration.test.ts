import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('adds calendar import tables to the latest journal prefix without changing household data', () => {
  const baselinePath = mkdtempSync(join(tmpdir(), 'calendar-import-upgrade-'));
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    db.exec(readFileSync('drizzle/auth/0001_better_auth.sql', 'utf8'));
    const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as { entries: { tag: string; idx: number; when: number }[] };
    const prefix = (entries: typeof journal.entries) => entries.slice(0, entries.findIndex(entry => entry.tag === '0025_checklist_templates') + 1);
    const previous = prefix(journal.entries);
    expect(previous.at(-1)?.tag).toBe('0025_checklist_templates');
    expect(prefix([...journal.entries, { tag: 'future', idx: 999, when: 9999999999999 }])).toEqual(previous);
    // Ensure consecutive indexes and strictly increasing timestamps across the journal
    for (let i = 0; i < journal.entries.length; i += 1) {
      expect(journal.entries[i].idx).toBe(i);
      if (i > 0) expect(journal.entries[i].when).toBeGreaterThan(journal.entries[i - 1].when);
    }

    mkdirSync(join(baselinePath, 'meta'));
    for (const entry of previous) copyFileSync(`drizzle/${entry.tag}.sql`, join(baselinePath, `${entry.tag}.sql`));
    writeFileSync(join(baselinePath, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: previous }));
    migrate(drizzle(db), { migrationsFolder: baselinePath });

    const importTables = () => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name GLOB 'calendar_import*' ORDER BY name").pluck().all();
    expect(importTables()).toEqual([]);

    db.exec(`
      INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('parent', 'Synthetic Parent', 'parent@example.test', 0, 0, 0);
      INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('child', 'Synthetic Child', 'child@example.test', 0, 0, 0);
      INSERT INTO household VALUES ('home', 'Synthetic household');
      INSERT INTO membership (user_id, household_id, role) VALUES ('parent', 'home', 'parent');
      INSERT INTO membership (user_id, household_id, role) VALUES ('child', 'home', 'kid');
      INSERT INTO chore (id, household_id, assignee_id, title, due_date, reward_cents, status, created_at, updated_at) VALUES ('chore-1', 'home', 'child', 'Synthetic chore', '2099-10-25', 500, 'verified', 'now', 'now');
      INSERT INTO earning (id, chore_id, household_id, child_id, amount_cents, created_at) VALUES ('earn-1', 'chore-1', 'home', 'child', 500, 'now');
      INSERT INTO calendar_event (id, household_id, creator_id, title, start_date, all_day, created_at, updated_at) VALUES ('event-1', 'home', 'parent', 'Existing family dinner', '2099-10-25', 1, 'now', 'now');
      INSERT INTO calendar_participant (event_id, household_id, user_id) VALUES ('event-1', 'home', 'child');
    `);

    const rows = () => ['user', 'household', 'membership', 'chore', 'earning', 'calendar_event', 'calendar_participant'].map(table => db.prepare(`SELECT * FROM ${table}`).all());
    const before = rows();

    migrate(drizzle(db), { migrationsFolder: 'drizzle' });
    migrate(drizzle(db), { migrationsFolder: 'drizzle' });

    expect(rows()).toEqual(before);
    expect(importTables()).toEqual(['calendar_import_batch', 'calendar_import_item']);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
  } finally {
    db.close();
    rmSync(baselinePath, { recursive: true, force: true });
  }
});
