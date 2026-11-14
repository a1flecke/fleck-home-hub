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
    db.exec(`
      INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('child', 'Synthetic Child', 'child@example.test', 0, 0, 0);
      INSERT INTO membership (user_id, household_id, role) VALUES ('child', 'home', 'kid');
      INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, userId) VALUES ('session', 200, 'synthetic-session', 100, 100, 'parent');
      INSERT INTO chore (id, household_id, assignee_id, title, due_date, reward_cents, status, created_at, updated_at) VALUES ('chore', 'home', 'child', 'Synthetic chore', '2026-01-01', 500, 'verified', 'now', 'now');
      INSERT INTO earning VALUES ('earning', 'chore', 'home', 'child', 500, 'now');
      INSERT INTO payout VALUES ('payout', 'home', 'child', 'parent', 200, '2026-01-01', NULL, 'request', 'now');
      INSERT INTO payout_reversal VALUES ('reversal', 'payout', 'parent', 'Synthetic correction', 'now');
      INSERT INTO calendar_event (id, household_id, creator_id, title, start_date, all_day, created_at, updated_at) VALUES ('event', 'home', 'parent', 'Synthetic event', '2026-01-01', 1, 'now', 'now');
      INSERT INTO meal (id, household_id, title, meal_date, created_at, updated_at) VALUES ('meal', 'home', 'Synthetic meal', '2026-01-01', 'now', 'now');
      INSERT INTO grocery_item (id, household_id, name, created_by, updated_by, created_at, updated_at) VALUES ('grocery', 'home', 'Synthetic grocery', 'parent', 'parent', 'now', 'now');
      INSERT INTO display_pairing (id, secret_hash, household_id, label, created_by, created_at, expires_at) VALUES ('pair', 'synthetic-pair-hash', 'home', 'Synthetic display', 'parent', 100, 200);
      INSERT INTO display_device (id, pairing_id, token_hash, household_id, label, created_by, created_at, expires_at) VALUES ('display', 'pair', 'synthetic-token-hash', 'home', 'Synthetic display', 'parent', 100, 200);
    `);
    const tables = ['membership', 'session', 'chore', 'earning', 'payout', 'payout_reversal', 'calendar_event', 'meal', 'grocery_item', 'display_pairing', 'display_device'];
    const readRows = () => tables.map(table => db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all());
    const before = readRows();
    expect(before.every(rows => rows.length > 0)).toBe(true);
    migrateDrizzle(drizzle(db), { migrationsFolder: 'drizzle' });
    expect(readRows()).toEqual(before);
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
