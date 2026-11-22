import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate as migrateDrizzle } from 'drizzle-orm/better-sqlite3/migrator';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

it('adds cancellation and edit audit fields without changing existing chores or earnings', () => {
  const directory = mkdtempSync(join(tmpdir(), 'chore-edit-migration-'));
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    db.exec(readFileSync('drizzle/auth/0001_better_auth.sql', 'utf8'));
    mkdirSync(join(directory, 'meta'));
    const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as { entries: { tag: string }[] };
    const boundary = journal.entries.findIndex(entry => entry.tag === '0019_display_choice_indexes');
    expect(boundary).toBeGreaterThanOrEqual(0);
    journal.entries = journal.entries.slice(0, boundary + 1);
    for (const entry of journal.entries) copyFileSync(`drizzle/${entry.tag}.sql`, join(directory, `${entry.tag}.sql`));
    writeFileSync(join(directory, 'meta/_journal.json'), JSON.stringify(journal));
    migrateDrizzle(drizzle(db), { migrationsFolder: directory });
    expect(db.prepare('PRAGMA table_info(chore)').all().map(column => (column as { name: string }).name)).not.toContain('cancelled_at');
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'chore_revision'").get()).toBeUndefined();

    db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run('parent', 'Synthetic Parent', 'parent@example.test');
    db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run('child', 'Synthetic Child', 'child@example.test');
    db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'Synthetic');
    db.prepare("INSERT INTO membership (user_id, household_id, role) VALUES ('parent', 'home', 'parent')").run();
    db.prepare("INSERT INTO membership (user_id, household_id, role) VALUES ('child', 'home', 'kid')").run();
    db.prepare("INSERT INTO chore (id, household_id, assignee_id, title, due_date, reward_cents, status, created_at, updated_at) VALUES ('chore', 'home', 'child', 'Synthetic verified chore', '2026-01-01', 500, 'verified', 'now', 'now')").run();
    db.prepare("INSERT INTO earning VALUES ('earning', 'chore', 'home', 'child', 500, 'now')").run();
    const before = db.prepare('SELECT * FROM chore').all() as Record<string, unknown>[];

    migrateDrizzle(drizzle(db), { migrationsFolder: 'drizzle' });
    migrateDrizzle(drizzle(db), { migrationsFolder: 'drizzle' });

    expect(db.prepare('SELECT * FROM chore').all()).toEqual([{ ...before[0], cancelled_at: null, cancelled_by: null }]);
    expect(db.prepare('SELECT amount_cents FROM earning WHERE chore_id = ?').get('chore')).toEqual({ amount_cents: 500 });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'chore_revision'").get()).toEqual({ name: 'chore_revision' });
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});
