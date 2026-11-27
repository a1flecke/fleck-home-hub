import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('adds occurrence links after templates without altering existing calendar or list history', () => {
  const baselinePath = mkdtempSync(join(tmpdir(), 'checklist-event-upgrade-'));
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    db.exec(readFileSync('drizzle/auth/0001_better_auth.sql', 'utf8'));
    const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as { entries: { tag: string }[] };
    const boundary = '0025_checklist_templates';
    const prefix = (entries: typeof journal.entries) => entries.slice(0, entries.findIndex(entry => entry.tag === boundary) + 1);
    const previous = prefix(journal.entries);
    expect(previous.at(-1)?.tag).toBe(boundary);
    expect(prefix([...journal.entries, { tag: 'future' }])).toEqual(previous);
    mkdirSync(join(baselinePath, 'meta'));
    for (const { tag } of previous) copyFileSync(`drizzle/${tag}.sql`, join(baselinePath, `${tag}.sql`));
    writeFileSync(join(baselinePath, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: previous }));
    migrate(drizzle(db), { migrationsFolder: baselinePath });

    const linksTable = () => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'family_checklist_event'").pluck().get();
    expect(linksTable()).toBeUndefined();
    db.exec(`
      INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('parent', 'Synthetic', 'parent@example.test', 0, 0, 0);
      INSERT INTO household VALUES ('home', 'Synthetic household');
      INSERT INTO membership (user_id, household_id, role) VALUES ('parent', 'home', 'parent');
      INSERT INTO family_checklist (id, household_id, name, description, target_date, shared, archived, version, created_by, create_request_id, created_at, updated_at)
        VALUES ('packing', 'home', 'Packing', 'Pack early', '2099-11-22', 1, 1, 4, 'parent', 'original-request', 'before', 'later');
      INSERT INTO family_checklist_item VALUES ('item', 'packing', 'Books', 1, 'parent', 'later', 2, 1);
      INSERT INTO family_checklist_add_request VALUES ('packing', 'parent', 'add-request');
      INSERT INTO calendar_event (id, household_id, creator_id, title, start_date, all_day, weekdays, created_at, updated_at)
        VALUES ('trip', 'home', 'parent', 'Weekend trip', '2099-05-04', 1, '[1]', 'before', 'later');
      INSERT INTO calendar_exception VALUES ('trip', '2099-05-04');
      INSERT INTO family_checklist_template (id, household_id, name, items) VALUES ('template', 'home', 'Weekend trip', '["Books"]');
    `);
    const rows = () => [
      db.prepare('SELECT * FROM family_checklist').all(),
      db.prepare('SELECT * FROM family_checklist_item').all(),
      db.prepare('SELECT * FROM family_checklist_add_request').all(),
      db.prepare('SELECT * FROM family_checklist_template').all(),
      db.prepare('SELECT * FROM calendar_event').all(),
      db.prepare('SELECT * FROM calendar_exception').all()
    ];
    const before = rows();
    migrate(drizzle(db), { migrationsFolder: 'drizzle' });
    migrate(drizzle(db), { migrationsFolder: 'drizzle' });

    expect(linksTable()).toBe('family_checklist_event');
    expect(rows()).toEqual(before);
    expect(db.prepare('SELECT COUNT(*) FROM family_checklist_event').pluck().get()).toBe(0);
    db.prepare('INSERT INTO household VALUES (?, ?)').run('away', 'Synthetic outside');
    db.prepare(`INSERT INTO calendar_event (id, household_id, creator_id, title, start_date, all_day, created_at, updated_at)
      VALUES ('outside', 'away', 'parent', 'Outside event', '2099-05-11', 1, 'before', 'later')`).run();
    const link = db.prepare('INSERT INTO family_checklist_event VALUES (?, ?, ?, ?, ?)');
    expect(() => link.run('packing', 'home', 'outside', '2099-05-11', 'outside-event')).toThrow(/FOREIGN KEY/);
    expect(() => link.run('packing', 'away', 'outside', '2099-05-11', 'outside-checklist')).toThrow(/FOREIGN KEY/);
    link.run('packing', 'home', 'trip', '2099-05-11', 'linked');
    expect(db.prepare('SELECT event_id, occurrence_date FROM family_checklist_event').get())
      .toEqual({ event_id: 'trip', occurrence_date: '2099-05-11' });
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
  } finally {
    db.close();
    rmSync(baselinePath, { recursive: true, force: true });
  }
});
