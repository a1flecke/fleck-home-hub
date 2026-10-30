import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../src/lib/server/identity';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate as migrateDrizzle } from 'drizzle-orm/better-sqlite3/migrator';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('creates chore, transition, and earnings tables on a fresh database and repeat migration', async () => {
  const db = new Database(':memory:');
  try {
    await migrate(db);
    await migrate(db);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('chore', 'chore_transition', 'earning') ORDER BY name").all();
    expect(tables).toEqual([{ name: 'chore' }, { name: 'chore_transition' }, { name: 'earning' }]);
  } finally { db.close(); }
});

it('upgrades an existing household while preserving membership', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-old-migration-'));
  const db = new Database(':memory:');
  try {
    mkdirSync(join(dir, 'meta'));
    copyFileSync('drizzle/0000_household.sql', join(dir, '0000_household.sql'));
    writeFileSync(join(dir, 'meta/_journal.json'), JSON.stringify({ version: '7', dialect: 'sqlite', entries: [{ idx: 0, version: '6', when: 1793232000000, tag: '0000_household', breakpoints: true }] }));
    db.exec('CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL)');
    migrateDrizzle(drizzle(db), { migrationsFolder: dir });
    db.prepare('INSERT INTO user VALUES (?)').run('synthetic');
    db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'Example');
    db.prepare('INSERT INTO membership VALUES (?, ?, ?)').run('synthetic', 'home', 'parent');
    migrateDrizzle(drizzle(db), { migrationsFolder: 'drizzle' });
    expect(db.prepare('SELECT role FROM membership WHERE user_id = ?').get('synthetic')).toEqual({ role: 'parent' });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'earning'").get()).toEqual({ name: 'earning' });
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

it('upgrades a chore database without changing membership or verified earnings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-recurring-migration-'));
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    mkdirSync(join(dir, 'meta'));
    for (const file of ['0000_household.sql', '0001_chores.sql']) copyFileSync(`drizzle/${file}`, join(dir, file));
    writeFileSync(join(dir, 'meta/_journal.json'), JSON.stringify({ version: '7', dialect: 'sqlite', entries: [
      { idx: 0, version: '6', when: 1793232000000, tag: '0000_household', breakpoints: true },
      { idx: 1, version: '6', when: 1793322000000, tag: '0001_chores', breakpoints: true }
    ] }));
    db.exec('CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL)');
    migrateDrizzle(drizzle(db), { migrationsFolder: dir });
    db.prepare('INSERT INTO user VALUES (?)').run('parent');
    db.prepare('INSERT INTO user VALUES (?)').run('kid');
    db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'Synthetic');
    db.prepare('INSERT INTO membership VALUES (?, ?, ?)').run('parent', 'home', 'parent');
    db.prepare('INSERT INTO membership VALUES (?, ?, ?)').run('kid', 'home', 'kid');
    db.prepare("INSERT INTO chore VALUES (?, ?, ?, ?, NULL, ?, ?, 'verified', NULL, ?, ?)").run('chore', 'home', 'kid', 'Synthetic chore', '2026-01-01', 200, '2026-01-01', '2026-01-01');
    db.prepare('INSERT INTO earning VALUES (?, ?, ?, ?, ?, ?)').run('earning', 'chore', 'home', 'kid', 200, '2026-01-01');
    migrateDrizzle(drizzle(db), { migrationsFolder: 'drizzle' });
    migrateDrizzle(drizzle(db), { migrationsFolder: 'drizzle' });
    expect(db.prepare('SELECT amount_cents FROM earning').get()).toEqual({ amount_cents: 200 });
    expect(db.prepare('SELECT user_id, role FROM membership ORDER BY user_id').all()).toEqual([{ user_id: 'kid', role: 'kid' }, { user_id: 'parent', role: 'parent' }]);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'recurring_occurrence'").get()).toEqual({ name: 'recurring_occurrence' });
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
