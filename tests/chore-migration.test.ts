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
