import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('adds optional responsibility without changing checklist, completion, template, or calendar history', () => {
  const baseline = mkdtempSync(join(tmpdir(), 'checklist-responsibility-upgrade-'));
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    db.exec(readFileSync('drizzle/auth/0001_better_auth.sql', 'utf8'));
    const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as { entries: { tag: string; idx: number; when: number }[] };
    const boundary = '0027_calendar_import';
    const prefix = (entries: typeof journal.entries) => entries.slice(0, entries.findIndex(entry => entry.tag === boundary) + 1);
    const previous = prefix(journal.entries);
    expect(previous.at(-1)?.tag).toBe(boundary);
    expect(prefix([...journal.entries, { tag: 'future', idx: 999, when: Number.MAX_SAFE_INTEGER }])).toEqual(previous);

    mkdirSync(join(baseline, 'meta'));
    for (const { tag } of previous) copyFileSync(`drizzle/${tag}.sql`, join(baseline, `${tag}.sql`));
    writeFileSync(join(baseline, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: previous }));
    migrate(drizzle(db), { migrationsFolder: baseline });

    const table = db.prepare("SELECT name FROM sqlite_master WHERE name = 'family_checklist_item_assignment'").pluck();
    expect(table.get()).toBeUndefined();
    db.exec(`
      INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES
        ('parent', 'Parent', 'parent@example.test', 0, 0, 0), ('outside', 'Outside', 'outside@example.test', 0, 0, 0);
      INSERT INTO household VALUES ('home', 'Synthetic home'), ('away', 'Synthetic away');
      INSERT INTO membership (user_id, household_id, role) VALUES ('parent', 'home', 'parent'), ('outside', 'away', 'parent');
      INSERT INTO family_checklist (id, household_id, name, target_date, shared, archived, version, created_by, create_request_id, created_at, updated_at)
        VALUES ('packing', 'home', 'Packing', '2099-11-22', 1, 1, 4, 'parent', 'original', 'before', 'later'),
          ('food', 'home', 'Food', NULL, 0, 0, 1, 'parent', 'other', 'before', 'later');
      INSERT INTO family_checklist_item VALUES ('books', 'packing', 'Books', 1, 'parent', 'later', 2, 1),
        ('coat', 'packing', 'Coat', 0, NULL, NULL, 1, 2);
      INSERT INTO family_checklist_template (id, household_id, name, items) VALUES ('template', 'home', 'Weekend trip', '["Books","Coat"]');
      INSERT INTO calendar_event (id, household_id, creator_id, title, start_date, all_day, created_at, updated_at)
        VALUES ('trip', 'home', 'parent', 'Weekend trip', '2099-11-22', 1, 'before', 'later');
      INSERT INTO family_checklist_event VALUES ('packing', 'home', 'trip', '2099-11-22', 'linked');
      INSERT INTO calendar_import_batch VALUES ('batch', 'home', 'parent', 'import-key', 'hash', 1, 0, '2099-11-22', 'before');
      INSERT INTO calendar_import_item VALUES ('batch', 'trip', 'home', 'source-uid');
    `);
    const snapshot = () => [
      db.prepare('SELECT * FROM family_checklist').all(),
      db.prepare('SELECT * FROM family_checklist_item').all(),
      db.prepare('SELECT * FROM family_checklist_template').all(),
      db.prepare('SELECT * FROM family_checklist_event').all(),
      db.prepare('SELECT * FROM calendar_event').all(),
      db.prepare('SELECT * FROM calendar_import_batch').all(),
      db.prepare('SELECT * FROM calendar_import_item').all()
    ];
    const before = snapshot();

    migrate(drizzle(db), { migrationsFolder: 'drizzle' });
    migrate(drizzle(db), { migrationsFolder: 'drizzle' });

    expect(table.get()).toBe('family_checklist_item_assignment');
    expect(snapshot()).toEqual(before);
    const assignments = db.prepare('SELECT item_id FROM family_checklist_item_assignment').pluck();
    expect(assignments.all()).toEqual([]);
    const assign = db.prepare('INSERT INTO family_checklist_item_assignment VALUES (?, ?, ?, ?)');
    expect(() => assign.run('coat', 'food', 'home', 'parent')).toThrow(/FOREIGN KEY/);
    expect(() => assign.run('coat', 'packing', 'away', 'outside')).toThrow(/FOREIGN KEY/);
    expect(() => assign.run('coat', 'packing', 'home', 'outside')).toThrow(/FOREIGN KEY/);
    assign.run('coat', 'packing', 'home', 'parent');
    expect(assignments.all()).toEqual(['coat']);
    db.prepare("DELETE FROM family_checklist_item WHERE id = 'coat'").run();
    expect(assignments.all()).toEqual([]);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
  } finally {
    db.close();
    rmSync(baseline, { recursive: true, force: true });
  }
});
