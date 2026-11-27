import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('adds templates and copy receipts to the latest contiguous baseline without changing checklist history', () => {
  const baselinePath = mkdtempSync(join(tmpdir(), 'checklist-template-upgrade-'));
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    db.exec(readFileSync('drizzle/auth/0001_better_auth.sql', 'utf8'));
    const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as { entries: { tag: string }[] };
    const boundary = '0024_recurring_schedule_versions';
    const prefix = (entries: typeof journal.entries) => entries.slice(0, entries.findIndex(entry => entry.tag === boundary) + 1);
    const previous = prefix(journal.entries);
    expect(previous.at(-1)?.tag).toBe(boundary);
    expect(prefix([...journal.entries, { tag: 'future' }])).toEqual(previous);
    mkdirSync(join(baselinePath, 'meta'));
    for (const { tag } of previous) copyFileSync(`drizzle/${tag}.sql`, join(baselinePath, `${tag}.sql`));
    writeFileSync(join(baselinePath, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: previous }));
    migrate(drizzle(db), { migrationsFolder: baselinePath });

    const templatesTable = () => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'family_checklist_template'").pluck().get();
    const checklistColumns = () => (db.pragma('table_info(family_checklist)') as { name: string }[]).map(column => column.name);
    expect(templatesTable()).toBeUndefined();
    expect(checklistColumns()).not.toContain('copy_fingerprint');
    db.exec(`
      INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('parent', 'Synthetic', 'parent@example.test', 0, 0, 0);
      INSERT INTO household VALUES ('home', 'Synthetic household');
      INSERT INTO membership (user_id, household_id, role) VALUES ('parent', 'home', 'parent');
      INSERT INTO family_checklist (id, household_id, name, description, target_date, shared, archived, version, created_by, create_request_id, created_at, updated_at)
        VALUES ('packing', 'home', 'Packing', 'Pack early', '2099-11-22', 1, 1, 4, 'parent', 'original-request', 'before', 'later');
      INSERT INTO family_checklist_item VALUES ('item', 'packing', 'Books', 1, 'parent', 'later', 2, 1);
      INSERT INTO family_checklist_add_request VALUES ('packing', 'parent', 'add-request');
    `);
    const originalColumns = checklistColumns().join(', ');
    const rows = () => [
      db.prepare(`SELECT ${originalColumns} FROM family_checklist`).all(),
      db.prepare('SELECT * FROM family_checklist_item').all(),
      db.prepare('SELECT * FROM family_checklist_add_request').all()
    ];
    const before = rows();
    migrate(drizzle(db), { migrationsFolder: 'drizzle' });
    migrate(drizzle(db), { migrationsFolder: 'drizzle' });

    expect(templatesTable()).toBe('family_checklist_template');
    expect(db.prepare('SELECT copy_fingerprint FROM family_checklist').pluck().get()).toBeNull();
    expect(rows()).toEqual(before);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
  } finally {
    db.close();
    rmSync(baselinePath, { recursive: true, force: true });
  }
});
