import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('adds checklist tables to the previous journal prefix without changing household data', () => {
  const baselinePath = mkdtempSync(join(tmpdir(), 'family-checklist-upgrade-'));
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    db.exec(readFileSync('drizzle/auth/0001_better_auth.sql', 'utf8'));
    const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as { entries: { tag: string }[] };
    const prefix = (entries: typeof journal.entries) => entries.slice(0, entries.findIndex(entry => entry.tag === '0020_chore_edit_cancel') + 1);
    const previous = prefix(journal.entries);
    expect(previous.at(-1)?.tag).toBe('0020_chore_edit_cancel');
    expect(prefix([...journal.entries, { tag: 'future' }])).toEqual(previous);
    mkdirSync(join(baselinePath, 'meta'));
    for (const entry of previous) copyFileSync('drizzle/' + entry.tag + '.sql', join(baselinePath, entry.tag + '.sql'));
    writeFileSync(join(baselinePath, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: previous }));
    migrate(drizzle(db), { migrationsFolder: baselinePath });
    const checklistTables = () => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name GLOB 'family_checklist*' ORDER BY name").pluck().all();
    expect(checklistTables()).toEqual([]);
    db.exec(`
      INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('parent', 'Synthetic', 'parent@example.test', 0, 0, 0);
      INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('child', 'Synthetic Child', 'child@example.test', 0, 0, 0);
      INSERT INTO household VALUES ('home', 'Synthetic household');
      INSERT INTO membership (user_id, household_id, role) VALUES ('parent', 'home', 'parent');
      INSERT INTO membership (user_id, household_id, role) VALUES ('child', 'home', 'kid');
      INSERT INTO chore (id, household_id, assignee_id, title, due_date, reward_cents, status, created_at, updated_at, cancelled_at, cancelled_by) VALUES ('chore', 'home', 'child', 'Synthetic chore', '2099-10-25', 0, 'todo', 'now', 'now', 'now', 'parent');
      INSERT INTO chore_revision (chore_id, actor_id, changed_at, changes) VALUES ('chore', 'parent', 'now', '{}');
      INSERT INTO calendar_event (id, household_id, creator_id, title, start_date, all_day, created_at, updated_at) VALUES ('event', 'home', 'parent', 'Synthetic trip', '2099-10-25', 1, 'now', 'now');
    `);
    const rows = () => ['user', 'household', 'membership', 'calendar_event', 'chore', 'chore_revision'].map(table => db.prepare('SELECT * FROM ' + table).all());
    const before = rows();
    migrate(drizzle(db), { migrationsFolder: 'drizzle' });
    migrate(drizzle(db), { migrationsFolder: 'drizzle' });
    expect(rows()).toEqual(before);
    expect(checklistTables()).toEqual(['family_checklist', 'family_checklist_add_request', 'family_checklist_item']);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
  } finally {
    db.close();
    rmSync(baselinePath, { recursive: true, force: true });
  }
});
