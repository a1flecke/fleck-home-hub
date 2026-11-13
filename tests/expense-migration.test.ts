import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate as migrateDrizzle } from 'drizzle-orm/better-sqlite3/migrator';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

it('upgrades the contiguous display-pairing baseline without altering household data', () => {
  const directory = mkdtempSync(join(tmpdir(), 'expense-migration-'));
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    db.exec(readFileSync('drizzle/auth/0001_better_auth.sql', 'utf8'));
    mkdirSync(join(directory, 'meta'));
    const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as { entries: { tag: string }[] };
    const boundary = journal.entries.findIndex(entry => entry.tag === '0012_display_pairing');
    expect(boundary).toBeGreaterThanOrEqual(0);
    journal.entries = journal.entries.slice(0, boundary + 1);
    for (const entry of journal.entries) copyFileSync(`drizzle/${entry.tag}.sql`, join(directory, `${entry.tag}.sql`));
    writeFileSync(join(directory, 'meta/_journal.json'), JSON.stringify(journal));
    migrateDrizzle(drizzle(db), { migrationsFolder: directory });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'expense'").get()).toBeUndefined();
    db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run('parent', 'Synthetic', 'parent@example.test');
    db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'Synthetic');
    db.prepare("INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, 'parent')").run('parent', 'home');
    migrateDrizzle(drizzle(db), { migrationsFolder: 'drizzle' });
    expect(db.prepare('SELECT user_id, role FROM membership').all()).toEqual([{ user_id: 'parent', role: 'parent' }]);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'expense'").get()).toEqual({ name: 'expense' });
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

it('upgrades the expense-planning journal prefix and ignores future entries in the baseline', () => {
  const directory = mkdtempSync(join(tmpdir(), 'expense-payment-migration-'));
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    db.exec(readFileSync('drizzle/auth/0001_better_auth.sql', 'utf8'));
    mkdirSync(join(directory, 'meta'));
    const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as { entries: { tag: string }[] };
    const prefix = (entries: { tag: string }[]) => entries.slice(0, entries.findIndex(entry => entry.tag === '0013_expenses') + 1);
    const baseline = prefix(journal.entries);
    expect(baseline.at(-1)?.tag).toBe('0013_expenses');
    expect(prefix([...journal.entries, { tag: 'future_migration' }])).toEqual(baseline);
    journal.entries = baseline;
    for (const entry of baseline) copyFileSync(`drizzle/${entry.tag}.sql`, join(directory, `${entry.tag}.sql`));
    writeFileSync(join(directory, 'meta/_journal.json'), JSON.stringify(journal));
    migrateDrizzle(drizzle(db), { migrationsFolder: directory });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'expense_payment'").get()).toBeUndefined();
    db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run('parent', 'Synthetic', 'parent@example.test');
    db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'Synthetic');
    db.prepare("INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, 'parent')").run('parent', 'home');
    db.prepare("INSERT INTO expense (id, household_id, creator_id, due_date, cadence, created_at, updated_at) VALUES (?, ?, ?, ?, 'once', ?, ?)").run('expense', 'home', 'parent', '2099-01-31', '2026-01-01', '2026-01-01');
    db.prepare('INSERT INTO expense_version VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('expense', '0000-01-01', 'Synthetic', 7000, null, null, null, 'parent', '2026-01-01');
    migrateDrizzle(drizzle(db), { migrationsFolder: 'drizzle' });
    expect(db.prepare('SELECT title, amount_cents FROM expense_version').get()).toEqual({ title: 'Synthetic', amount_cents: 7000 });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'expense_payment'").get()).toEqual({ name: 'expense_payment' });
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});
