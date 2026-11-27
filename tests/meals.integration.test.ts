import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../src/lib/server/identity';
import { createMeal, listMealWeek, listMeals, mealCopySource, moveMeal, recentMeals, removeMeal, updateMeal } from '../src/lib/server/meals';
import { displayData } from '../src/lib/server/display';
import { parseRecipeLink } from '../src/lib/meals/recipe-link';
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
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('parent', 'home', 'parent');
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('kid', 'home', 'kid');
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('outsider', 'other', 'parent');
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
    updateMeal(db, 'parent', 'home', id, { ...meal, title: 'Bean soup', shared: false });
    expect(listMeals(db, 'kid', 'home', meal.date)).toEqual([]);
    const unshared = displayData(db, 'kid', 'home', meal.date, '2026-11-08');
    expect(unshared.meals).toEqual([]);
    expect(JSON.stringify(unshared)).not.toContain(meal.recipeUrl);
  } finally { db.close(); }
});

it('deduplicates retried submissions while allowing the same recipe on another date', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON'); await migrate(db);
    for (const id of ['parent', 'kid']) db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, `${id}@example.test`);
    db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'home');
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('parent', 'home', 'parent');
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('kid', 'home', 'kid');
    const recipe = { title: 'Synthetic bowls', date: '2026-11-02', ingredients: '2 cups synthetic chickpeas', recipeUrl: 'https://emeals.com/recipes/synthetic-bowls', shared: false };
    const first = createMeal(db, 'parent', 'home', { ...recipe, submissionKey: 'review-1' });
    const retry = createMeal(db, 'parent', 'home', { ...recipe, submissionKey: 'review-1' });
    expect(retry).toBe(first);
    expect(db.prepare('SELECT COUNT(*) AS count FROM meal').get()).toEqual({ count: 1 });
    const wednesday = createMeal(db, 'parent', 'home', { ...recipe, date: '2026-11-04', submissionKey: 'review-2' });
    expect(wednesday).not.toBe(first);
    expect(listMeals(db, 'parent', 'home', '2026-11-02')).toHaveLength(1);
    expect(listMeals(db, 'parent', 'home', '2026-11-04')).toHaveLength(1);
    expect(listMeals(db, 'kid', 'home', '2026-11-02')).toEqual([]);
  } finally { db.close(); }
});

it('upgrades a meal database without losing existing meals when adding submission keys', () => {
  const directory = mkdtempSync(join(tmpdir(), 'hub-meal-submission-migration-'));
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON'); mkdirSync(join(directory, 'meta'));
    const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8'));
    journal.entries = journal.entries.slice(0, 7);
    for (const entry of journal.entries) copyFileSync(`drizzle/${entry.tag}.sql`, join(directory, `${entry.tag}.sql`));
    writeFileSync(join(directory, 'meta/_journal.json'), JSON.stringify(journal));
    db.exec('CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL)');
    migrateDrizzle(drizzle(db), { migrationsFolder: directory });
    db.prepare('INSERT INTO user VALUES (?)').run('parent');
    db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'Synthetic');
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('parent', 'home', 'parent');
    db.prepare("INSERT INTO meal (id, household_id, title, meal_date, ingredients, shared, created_at, updated_at) VALUES ('existing', 'home', 'Existing dinner', '2026-11-02', '', 0, '2026-11-02', '2026-11-02')").run();
    migrateDrizzle(drizzle(db), { migrationsFolder: 'drizzle' });
    migrateDrizzle(drizzle(db), { migrationsFolder: 'drizzle' });
    expect(db.prepare('SELECT title FROM meal WHERE id = ?').get('existing')).toEqual({ title: 'Existing dinner' });
    const columns = db.prepare('PRAGMA table_info(meal)').all() as { name: string }[];
    expect(columns.map(column => column.name)).toContain('submission_key');
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'meal_household_submission'").get()).toEqual({ name: 'meal_household_submission' });
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

it('persists and projects only recipe details that match the saved eMeals link', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON'); await migrate(db);
    for (const id of ['parent', 'kid']) db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, `${id}@example.test`);
    db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'home');
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('parent', 'home', 'parent');
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('kid', 'home', 'kid');
    const recipeUrl = 'https://emeals.com/recipes/synthetic-preview';
    const details = { sourceUrl: recipeUrl, title: 'Synthetic Preview Bowl', yield: '4 servings', totalTime: '25 min', groups: [{ name: 'Synthetic Main', lines: ['1½ cups synthetic rice'] }] };
    const id = createMeal(db, 'parent', 'home', { title: 'Synthetic dinner', date: '2026-11-05', ingredients: '1 family carrot', shared: true, recipeUrl, recipeDetails: details });
    expect(listMeals(db, 'parent', 'home', '2026-11-05')[0].recipeDetails).toEqual(details);
    expect(listMeals(db, 'kid', 'home', '2026-11-05')[0].recipeDetails).toEqual(details);
    expect(displayData(db, 'kid', 'home', '2026-11-05', '2026-11-12').meals[0].recipeDetails).toEqual(details);
    updateMeal(db, 'parent', 'home', id, { title: 'Synthetic dinner', date: '2026-11-05', ingredients: '1 family carrot', shared: true, recipeUrl: 'https://emeals.com/recipes/another', recipeDetails: details });
    expect(listMeals(db, 'parent', 'home', '2026-11-05')[0].recipeDetails).toBeNull();
    updateMeal(db, 'parent', 'home', id, { title: 'Synthetic dinner', date: '2026-11-05', ingredients: '1 family carrot', shared: false, recipeUrl, recipeDetails: details });
    expect(listMeals(db, 'kid', 'home', '2026-11-05')).toEqual([]);
    expect(displayData(db, 'kid', 'home', '2026-11-05', '2026-11-12').meals).toEqual([]);
  } finally { db.close(); }
});

it('upgrades a meal database with recipe details without losing existing meals', () => {
  const directory = mkdtempSync(join(tmpdir(), 'hub-meal-details-migration-'));
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON'); mkdirSync(join(directory, 'meta'));
    const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8'));
    journal.entries = journal.entries.slice(0, 9);
    for (const entry of journal.entries) copyFileSync(`drizzle/${entry.tag}.sql`, join(directory, `${entry.tag}.sql`));
    writeFileSync(join(directory, 'meta/_journal.json'), JSON.stringify(journal));
    db.exec('CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL)');
    migrateDrizzle(drizzle(db), { migrationsFolder: directory });
    db.prepare('INSERT INTO user VALUES (?)').run('parent');
    db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'Synthetic');
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('parent', 'home', 'parent');
    db.prepare("INSERT INTO meal (id, household_id, title, meal_date, ingredients, shared, created_at, updated_at) VALUES ('existing', 'home', 'Existing dinner', '2026-11-05', '', 0, '2026-11-05', '2026-11-05')").run();
    migrateDrizzle(drizzle(db), { migrationsFolder: 'drizzle' });
    migrateDrizzle(drizzle(db), { migrationsFolder: 'drizzle' });
    expect(db.prepare('SELECT title FROM meal WHERE id = ?').get('existing')).toEqual({ title: 'Existing dinner' });
    const columns = db.prepare('PRAGMA table_info(meal)').all() as { name: string }[];
    expect(columns.map(column => column.name)).toContain('recipe_details');
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

it('lists a bounded week of meals for parents and only shared meals for children', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON'); await migrate(db);
    for (const id of ['parent', 'kid', 'outsider']) db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, `${id}@example.test`);
    for (const id of ['home', 'other']) db.prepare('INSERT INTO household VALUES (?, ?)').run(id, id);
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('parent', 'home', 'parent');
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('kid', 'home', 'kid');
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('outsider', 'other', 'parent');
    const base = { time: '18:00', servings: 4, ingredients: '1 onion', notes: 'Private note at home', source: 'Family cookbook', recipeUrl: 'https://example.test/recipe' };
    createMeal(db, 'parent', 'home', { ...base, title: 'Private Sunday', date: '2026-11-15', shared: false });
    createMeal(db, 'parent', 'home', { ...base, title: 'Shared Monday', date: '2026-11-16', shared: true });
    createMeal(db, 'parent', 'home', { ...base, title: 'Second Monday', date: '2026-11-16', time: '12:00', shared: false });
    createMeal(db, 'parent', 'home', { ...base, title: 'Shared Saturday', date: '2026-11-21', shared: true });
    createMeal(db, 'parent', 'home', { ...base, title: 'Outside week', date: '2026-11-22', shared: true });
    createMeal(db, 'outsider', 'other', { ...base, title: 'Other household', date: '2026-11-16', shared: true });

    expect(listMealWeek(db, 'parent', 'home', '2026-11-15', '2026-11-21').map(meal => meal.title)).toEqual(['Private Sunday', 'Second Monday', 'Shared Monday', 'Shared Saturday']);
    expect(listMealWeek(db, 'kid', 'home', '2026-11-15', '2026-11-21').map(meal => meal.title)).toEqual(['Shared Monday', 'Shared Saturday']);
    expect(listMealWeek(db, 'kid', 'home', '2026-11-15', '2026-11-21').every(meal => meal.notes === null)).toBe(true);
    expect(() => listMealWeek(db, 'outsider', 'home', '2026-11-15', '2026-11-21')).toThrow();
    expect(() => listMealWeek(db, 'parent', 'home', '2026-11-15', '2026-11-22')).toThrow();
    expect(() => listMealWeek(db, 'parent', 'home', '2026-02-30', '2026-03-07')).toThrow();
  } finally { db.close(); }
});

it('moves and removes meals only for a parent in the owning household', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON'); await migrate(db);
    for (const id of ['parent', 'kid', 'outsider']) db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, `${id}@example.test`);
    for (const id of ['home', 'other']) db.prepare('INSERT INTO household VALUES (?, ?)').run(id, id);
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('parent', 'home', 'parent');
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('kid', 'home', 'kid');
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('outsider', 'other', 'parent');
    const input = { title: 'Moved dinner', date: '2026-11-16', time: '18:30', servings: 5, ingredients: '2 cups beans\n1 onion', notes: 'Keep this note', source: 'eMeals', recipeUrl: 'https://emeals.com/recipes/moved', shared: true };
    const id = createMeal(db, 'parent', 'home', input);
    const otherId = createMeal(db, 'outsider', 'other', { ...input, title: 'Other dinner' });

    expect(() => moveMeal(db, 'kid', 'home', id, '2026-11-18')).toThrow();
    expect(() => moveMeal(db, 'outsider', 'home', id, '2026-11-18')).toThrow();
    expect(() => moveMeal(db, 'parent', 'home', id, '2026-02-30')).toThrow();
    expect(() => moveMeal(db, 'parent', 'home', otherId, '2026-11-18')).toThrow();
    expect(listMeals(db, 'parent', 'home', '2026-11-16')).toHaveLength(1);
    moveMeal(db, 'parent', 'home', id, '2026-11-18');
    expect(listMeals(db, 'parent', 'home', '2026-11-16')).toEqual([]);
    expect(listMeals(db, 'parent', 'home', '2026-11-18')[0]).toMatchObject({ ...input, date: '2026-11-18' });

    expect(() => removeMeal(db, 'kid', 'home', id)).toThrow();
    expect(() => removeMeal(db, 'outsider', 'home', id)).toThrow();
    expect(() => removeMeal(db, 'parent', 'home', otherId)).toThrow();
    removeMeal(db, 'parent', 'home', id);
    expect(listMeals(db, 'parent', 'home', '2026-11-18')).toEqual([]);
    expect(listMeals(db, 'outsider', 'other', '2026-11-16')).toHaveLength(1);
  } finally { db.close(); }
});

it('lists a bounded, searchable set of recent household meals for parents only', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON'); await migrate(db);
    for (const id of ['parent', 'kid', 'outsider']) db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, `${id}@example.test`);
    for (const id of ['home', 'other']) db.prepare('INSERT INTO household VALUES (?, ?)').run(id, id);
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('parent', 'home', 'parent');
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('kid', 'home', 'kid');
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('outsider', 'other', 'parent');
    const base = { time: '18:00', servings: 4, ingredients: '1 onion', notes: 'Private repeat note', source: 'Family cookbook', recipeUrl: 'https://example.test/recipe', shared: false };
    createMeal(db, 'parent', 'home', { ...base, title: 'Synthetic chicken pasta', date: '2026-10-01' });
    createMeal(db, 'parent', 'home', { ...base, title: 'Synthetic taco night', date: '2026-10-05', ingredients: '2 cups synthetic chicken' });
    createMeal(db, 'parent', 'home', { ...base, title: 'Synthetic soup', date: '2026-10-09' });
    for (let index = 0; index < 45; index += 1) {
      createMeal(db, 'parent', 'home', { ...base, title: `Filler dinner ${index}`, date: `2025-01-${String((index % 28) + 1).padStart(2, '0')}` });
    }
    createMeal(db, 'outsider', 'other', { ...base, title: 'Synthetic chicken elsewhere', date: '2026-10-10' });

    const recent = recentMeals(db, 'parent', 'home');
    expect(recent).toHaveLength(40);
    expect(recent[0]).toMatchObject({ title: 'Synthetic soup', date: '2026-10-09' });
    expect(JSON.stringify(recent)).not.toContain('Private repeat note');
    expect(recent.some(meal => meal.title === 'Synthetic chicken elsewhere')).toBe(false);
    expect(recentMeals(db, 'parent', 'home', 'chicken').map(meal => meal.title)).toEqual(['Synthetic chicken pasta']);
    expect(recentMeals(db, 'parent', 'home', '  TACO  ').map(meal => meal.title)).toEqual(['Synthetic taco night']);
    expect(recentMeals(db, 'parent', 'home', 'x'.repeat(80))).toEqual([]);
    expect(() => recentMeals(db, 'parent', 'home', 'x'.repeat(81))).toThrow();
    expect(() => recentMeals(db, 'kid', 'home')).toThrow();
    expect(() => recentMeals(db, 'outsider', 'home')).toThrow();

    const source = mealCopySource(db, 'parent', 'home', recent[0].id);
    expect(source).toMatchObject({ title: 'Synthetic soup', ingredients: '1 onion', recipeUrl: 'https://example.test/recipe', time: '18:00', servings: 4, source: 'Family cookbook', shared: false });
    expect('notes' in source).toBe(false);
    expect(() => mealCopySource(db, 'kid', 'home', recent[0].id)).toThrow();
    expect(() => mealCopySource(db, 'parent', 'home', 'missing')).toThrow();
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
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('parent', 'home', 'parent');
    migrateDrizzle(drizzle(db), { migrationsFolder: 'drizzle' });
    migrateDrizzle(drizzle(db), { migrationsFolder: 'drizzle' });
    expect(db.prepare('SELECT role FROM membership WHERE user_id = ?').get('parent')).toEqual({ role: 'parent' });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'meal'").get()).toEqual({ name: 'meal' });
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

it('accepts only recipe links the meal pages can display', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON'); await migrate(db);
    db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run('parent', 'parent', 'parent@example.test');
    db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'home');
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('parent', 'home', 'parent');
    const base = { title: 'Soup', date: '2026-11-01', ingredients: '1 onion', shared: false };
    // Each of these used to be saved, then hidden by parseRecipeLink on every meal surface.
    for (const recipeUrl of ['https://example.test/', 'https://example.test', 'https://example.test/?recipe=soup', 'https://example.test:8443/recipes/soup']) {
      expect(() => createMeal(db, 'parent', 'home', { ...base, recipeUrl }), recipeUrl).toThrow('Invalid recipe URL');
      expect(parseRecipeLink(recipeUrl), recipeUrl).toBeNull();
    }
    for (const recipeUrl of ['https://example.test/recipes/soup', 'https://example.test/recipe?id=soup', 'https://emeals.com/recipes/synthetic-bowls']) {
      const id = createMeal(db, 'parent', 'home', { ...base, recipeUrl });
      expect(parseRecipeLink(recipeUrl), recipeUrl).not.toBeNull();
      expect(listMeals(db, 'parent', 'home', '2026-11-01').find(meal => meal.id === id)?.recipeUrl).toBe(recipeUrl);
    }
    const id = createMeal(db, 'parent', 'home', { ...base, recipeUrl: 'https://example.test/recipes/soup' });
    expect(() => updateMeal(db, 'parent', 'home', id, { ...base, recipeUrl: 'https://example.test/' })).toThrow('Invalid recipe URL');
  } finally { db.close(); }
});
