import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../src/lib/server/identity';
import { createMeal, listMeals, updateMeal } from '../src/lib/server/meals';
import { displayData } from '../src/lib/server/display';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate as migrateDrizzle } from 'drizzle-orm/better-sqlite3/migrator';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('keeps meal management parent-only and household-scoped, with opt-in display sharing', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON'); await migrate(db);
    for (const id of ['parent', 'kid', 'outsider']) db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, `${id}@example.test`);
    for (const id of ['home', 'other']) db.prepare('INSERT INTO household VALUES (?, ?)').run(id, id);
    db.prepare('INSERT INTO membership VALUES (?, ?, ?)').run('parent', 'home', 'parent');
    db.prepare('INSERT INTO membership VALUES (?, ?, ?)').run('kid', 'home', 'kid');
    db.prepare('INSERT INTO membership VALUES (?, ?, ?)').run('outsider', 'other', 'parent');
    const meal = { title: 'Soup', date: '2026-11-01', time: '18:00', servings: 4, ingredients: '2 cups beans\n1 onion', notes: 'Private notes', source: 'eMeals', recipeUrl: 'https://example.test/recipe', shared: false };
    expect(() => createMeal(db, 'kid', 'home', meal)).toThrow();
    expect(() => createMeal(db, 'outsider', 'home', meal)).toThrow();
    expect(() => createMeal(db, 'parent', 'home', { ...meal, recipeUrl: 'javascript:alert(1)' })).toThrow();
    expect(() => createMeal(db, 'parent', 'home', { ...meal, date: '2026-02-30' })).toThrow();
    const id = createMeal(db, 'parent', 'home', meal);
    expect(displayData(db, 'kid', 'home', meal.date, '2026-11-08').meals).toEqual([]);
    expect(listMeals(db, 'kid', 'home', '2026-11-01')).toEqual([]);
    expect(listMeals(db, 'parent', 'home', '2026-11-01')).toMatchObject([{ id, title: 'Soup', ingredients: '2 cups beans\n1 onion', shared: false }]);
    expect(listMeals(db, 'outsider', 'other', '2026-11-01')).toEqual([]);
    expect(() => listMeals(db, 'outsider', 'home', '2026-11-01')).toThrow();
    expect(() => updateMeal(db, 'kid', 'home', id, meal)).toThrow();
    expect(() => updateMeal(db, 'outsider', 'other', id, meal)).toThrow();
    updateMeal(db, 'parent', 'home', id, { ...meal, title: 'Bean soup', shared: true });
    expect(listMeals(db, 'parent', 'home', '2026-11-01')[0]).toMatchObject({ title: 'Bean soup', shared: true });
    expect(listMeals(db, 'kid', 'home', meal.date)[0]).toMatchObject({ title: 'Bean soup', notes: null });
    const shared = displayData(db, 'kid', 'home', meal.date, '2026-11-08').meals;
    expect(shared).toMatchObject([{ title: 'Bean soup', ingredients: '2 cups beans\n1 onion', source: 'eMeals' }]);
    expect(JSON.stringify(shared)).not.toContain('Private notes');
  } finally { db.close(); }
});

it('upgrades the previous schema without losing household membership and is repeatable', () => {
  const directory = mkdtempSync(join(tmpdir(), 'hub-meal-migration-'));
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON'); mkdirSync(join(directory, 'meta'));
    const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8'));
    journal.entries = journal.entries.slice(0, 6);
    for (const entry of journal.entries) copyFileSync(`drizzle/${entry.tag}.sql`, join(directory, `${entry.tag}.sql`));
    writeFileSync(join(directory, 'meta/_journal.json'), JSON.stringify(journal));
    db.exec('CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL)');
    migrateDrizzle(drizzle(db), { migrationsFolder: directory });
    db.prepare('INSERT INTO user VALUES (?)').run('parent');
    db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'Synthetic');
    db.prepare('INSERT INTO membership VALUES (?, ?, ?)').run('parent', 'home', 'parent');
    migrateDrizzle(drizzle(db), { migrationsFolder: 'drizzle' });
    migrateDrizzle(drizzle(db), { migrationsFolder: 'drizzle' });
    expect(db.prepare('SELECT role FROM membership WHERE user_id = ?').get('parent')).toEqual({ role: 'parent' });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'meal'").get()).toEqual({ name: 'meal' });
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});
