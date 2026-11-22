import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate as migrateDrizzle } from 'drizzle-orm/better-sqlite3/migrator';
import { migrate } from '../src/lib/server/identity';
import { addGrocery, confirmWeekIngredients, listGroceries, reviewWeekIngredients, StaleWeekIngredientSelectionError, WeekIngredientConflictError, WeekIngredientValidationError, weekIngredientSources } from '../src/lib/server/groceries';
import { createMeal, updateMeal, type MealInput } from '../src/lib/server/meals';
import type { IngredientAction } from '../src/lib/grocery/handoff';
import type { WeekIngredientReview } from '../src/lib/grocery/week';

function setup(db: Database.Database) {
  for (const id of ['parent', 'kid', 'outsider']) db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, `${id}@example.test`);
  for (const id of ['home', 'other']) db.prepare('INSERT INTO household VALUES (?, ?)').run(id, id);
  db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('parent', 'home', 'parent');
  db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('kid', 'home', 'kid');
  db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('outsider', 'other', 'parent');
}

function seededMeals(db: Database.Database) {
  const recipeUrl = 'https://emeals.com/recipes/synthetic-week-shop';
  const pasta: MealInput = {
    title: 'Pasta night',
    date: '2026-11-16',
    time: '18:00',
    servings: 4,
    ingredients: '2 cups rice\n1 onion',
    notes: 'Do not shop private notes',
    source: 'eMeals',
    recipeUrl,
    recipeDetails: { sourceUrl: recipeUrl, title: 'Synthetic provider recipe', yield: '4 servings', totalTime: '20 min', groups: [{ name: 'Sauce', lines: ['1 onion', '2 tbsp olive oil'] }] },
    shared: true
  };
  const bowls: MealInput = { title: 'Rice bowls', date: '2026-11-17', ingredients: '1 cup rice\n1 bell pepper', shared: false };
  const later: MealInput = { title: 'Next week rice', date: '2026-11-23', ingredients: '5 cups rice', shared: false };
  return { pasta, pastaId: createMeal(db, 'parent', 'home', pasta), bowlsId: createMeal(db, 'parent', 'home', bowls), laterId: createMeal(db, 'parent', 'home', later) };
}

function decisions(review: WeekIngredientReview, actions: Record<string, IngredientAction> = {}) {
  return review.items.map(item => ({
    key: item.key,
    line: item.line,
    action: actions[item.key] ?? item.action,
    name: item.name,
    quantity: item.quantity,
    unit: item.unit
  }));
}

it('reviews selected ingredients across a week with source and meal attribution', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON'); await migrate(db); setup(db);
    const { pastaId, bowlsId } = seededMeals(db);
    const refs = weekIngredientSources(db, 'parent', 'home', '2026-11-16', '2026-11-22');
    expect(refs).toHaveLength(6);
    expect(refs.map(ref => ref.mealTitle)).toEqual(expect.arrayContaining(['Pasta night', 'Rice bowls']));
    expect(refs.some(ref => ref.source === 'provider' && ref.group === 'Sauce')).toBe(true);
    expect(() => weekIngredientSources(db, 'kid', 'home', '2026-11-16', '2026-11-22')).toThrow();
    expect(() => weekIngredientSources(db, 'outsider', 'home', '2026-11-16', '2026-11-22')).toThrow();
    expect(() => weekIngredientSources(db, 'parent', 'home', '2026-11-16', '2026-11-23')).toThrow();

    const riceA = refs.find(ref => ref.mealId === pastaId && ref.line === '2 cups rice')!;
    const riceB = refs.find(ref => ref.mealId === bowlsId && ref.line === '1 cup rice')!;
    const oil = refs.find(ref => ref.mealId === pastaId && ref.line === '2 tbsp olive oil')!;
    const onion = refs.find(ref => ref.mealId === pastaId && ref.line === '1 onion')!;
    const pepper = refs.find(ref => ref.mealId === bowlsId && ref.line === '1 bell pepper')!;
    const review = reviewWeekIngredients(db, 'parent', 'home', '2026-11-16', '2026-11-22', [riceA.key, riceB.key, oil.key, onion.key, pepper.key]);
    expect(review.weekStart).toBe('2026-11-16');
    expect(review.weekEnd).toBe('2026-11-22');
    expect(review.mealCount).toBe(2);
    const byLine = new Map(review.items.map(item => [item.line, item]));
    expect(byLine.get('2 cups rice')).toMatchObject({ quantity: '2', unit: 'cups', action: 'add' });
    expect(byLine.get('1 cup rice')).toMatchObject({ quantity: '1', unit: 'cup', action: 'skip', duplicateOfSelection: true });
    expect(byLine.get('2 cups rice')?.requiredBy.map(item => item.mealTitle)).toEqual(['Pasta night', 'Rice bowls']);
    expect(byLine.get('2 tbsp olive oil')).toMatchObject({ source: 'provider', group: 'Sauce', action: 'add', quantity: '2', unit: 'tbsp' });
    expect(() => reviewWeekIngredients(db, 'kid', 'home', '2026-11-16', '2026-11-22', [riceA.key])).toThrow();
    expect(() => reviewWeekIngredients(db, 'parent', 'home', '2026-11-16', '2026-11-22', [riceA.key, riceA.key])).toThrow();
    expect(() => reviewWeekIngredients(db, 'parent', 'home', '2026-11-16', '2026-11-22', ['forged:key'])).toThrow();
  } finally { db.close(); }
});

it('confirms approved week ingredients atomically and is idempotent on retry', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON'); await migrate(db); setup(db);
    const { pastaId, bowlsId } = seededMeals(db);
    const refs = weekIngredientSources(db, 'parent', 'home', '2026-11-16', '2026-11-22');
    const selected = ['2 cups rice', '1 cup rice', '2 tbsp olive oil', '1 bell pepper'].map(line => refs.find(ref => ref.line === line)!.key);
    const review = reviewWeekIngredients(db, 'parent', 'home', '2026-11-16', '2026-11-22', selected);
    const result = confirmWeekIngredients(db, 'parent', 'home', '2026-11-16', '2026-11-22', decisions(review, { [refs.find(ref => ref.line === '1 cup rice')!.key]: 'skip' }), 'confirm-week-1');
    expect(result).toEqual({ added: 3, skipped: 1, replayed: false });
    const items = listGroceries(db, 'parent', 'home');
    expect(items).toHaveLength(3);
    expect(items.find(item => item.name === 'rice')).toMatchObject({ quantity: '2', unit: 'cups' });
    expect(items.some(item => item.name === 'bell pepper')).toBe(true);
    expect(items.some(item => item.name === 'rice' && item.quantity === '1')).toBe(false);

    const retry = confirmWeekIngredients(db, 'parent', 'home', '2026-11-16', '2026-11-22', decisions(review, { [refs.find(ref => ref.line === '1 cup rice')!.key]: 'skip' }), 'confirm-week-1');
    expect(retry).toEqual({ added: 3, skipped: 1, replayed: true });
    expect(listGroceries(db, 'parent', 'home')).toHaveLength(3);
    expect(db.prepare('SELECT title, ingredients, shared FROM meal WHERE id IN (?, ?) ORDER BY title').all(pastaId, bowlsId)).toMatchObject([
      { title: 'Pasta night', ingredients: '2 cups rice\n1 onion', shared: 1 },
      { title: 'Rice bowls', ingredients: '1 cup rice\n1 bell pepper', shared: 0 }
    ]);
  } finally { db.close(); }
});

it('rejects conflicts, stale selections, invalid values and unauthorized callers without writing partial rows', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON'); await migrate(db); setup(db);
    const { pasta, pastaId } = seededMeals(db);
    const refs = weekIngredientSources(db, 'parent', 'home', '2026-11-16', '2026-11-22');
    const oil = refs.find(ref => ref.line === '2 tbsp olive oil')!;
    const rice = refs.find(ref => ref.mealId === pastaId && ref.line === '2 cups rice')!;

    const conflictReview = reviewWeekIngredients(db, 'parent', 'home', '2026-11-16', '2026-11-22', [oil.key]);
    addGrocery(db, 'parent', 'home', { name: 'olive oil', quantity: '1', unit: 'bottle' });
    const before = listGroceries(db, 'parent', 'home').length;
    expect(() => confirmWeekIngredients(db, 'parent', 'home', '2026-11-16', '2026-11-22', decisions(conflictReview, { [oil.key]: 'add' }), 'confirm-conflict')).toThrow(WeekIngredientConflictError);
    expect(listGroceries(db, 'parent', 'home')).toHaveLength(before);
    const duplicateReview = reviewWeekIngredients(db, 'parent', 'home', '2026-11-16', '2026-11-22', [oil.key]);
    expect(confirmWeekIngredients(db, 'parent', 'home', '2026-11-16', '2026-11-22', decisions(duplicateReview, { [oil.key]: 'duplicate' }), 'confirm-duplicate')).toEqual({ added: 1, skipped: 0, replayed: false });
    expect(listGroceries(db, 'parent', 'home')).toHaveLength(before + 1);

    const staleReview = reviewWeekIngredients(db, 'parent', 'home', '2026-11-16', '2026-11-22', [rice.key]);
    updateMeal(db, 'parent', 'home', pastaId, { ...pasta, ingredients: '3 cups rice\n1 onion' });
    const afterMealChange = listGroceries(db, 'parent', 'home').length;
    expect(() => confirmWeekIngredients(db, 'parent', 'home', '2026-11-16', '2026-11-22', decisions(staleReview), 'confirm-stale')).toThrow(StaleWeekIngredientSelectionError);
    expect(listGroceries(db, 'parent', 'home')).toHaveLength(afterMealChange);

    const invalidReview = reviewWeekIngredients(db, 'parent', 'home', '2026-11-16', '2026-11-22', [refs.find(ref => ref.line === '1 bell pepper')!.key]);
    const invalid = decisions(invalidReview).map((decision, index) => index === 0 ? { ...decision, name: '   ' } : decision);
    expect(() => confirmWeekIngredients(db, 'parent', 'home', '2026-11-16', '2026-11-22', invalid, 'confirm-invalid')).toThrow(WeekIngredientValidationError);
    expect(() => confirmWeekIngredients(db, 'kid', 'home', '2026-11-16', '2026-11-22', decisions(invalidReview), 'confirm-kid')).toThrow();
    expect(() => confirmWeekIngredients(db, 'outsider', 'home', '2026-11-16', '2026-11-22', decisions(invalidReview), 'confirm-outsider')).toThrow();
    expect(() => confirmWeekIngredients(db, 'parent', 'home', '2026-11-16', '2026-11-22', decisions(invalidReview), '')).toThrow(WeekIngredientValidationError);
    expect(listGroceries(db, 'parent', 'home')).toHaveLength(afterMealChange);
  } finally { db.close(); }
});

it('replays the same confirmation across two SQLite connections without adding rows twice', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'hub-grocery-week-connections-'));
  const path = join(directory, 'synthetic.sqlite');
  const first = new Database(path);
  let second: Database.Database | undefined;
  try {
    first.pragma('foreign_keys = ON'); await migrate(first); setup(first);
    const { pastaId } = seededMeals(first);
    const refs = weekIngredientSources(first, 'parent', 'home', '2026-11-16', '2026-11-22');
    const rice = refs.find(ref => ref.mealId === pastaId && ref.line === '2 cups rice')!;
    const review = reviewWeekIngredients(first, 'parent', 'home', '2026-11-16', '2026-11-22', [rice.key]);
    const decisionsToWrite = decisions(review);
    second = new Database(path, { fileMustExist: true });
    second.pragma('foreign_keys = ON');
    expect(confirmWeekIngredients(second, 'parent', 'home', '2026-11-16', '2026-11-22', decisionsToWrite, 'cross-connection')).toEqual({ added: 1, skipped: 0, replayed: false });
    expect(confirmWeekIngredients(first, 'parent', 'home', '2026-11-16', '2026-11-22', decisionsToWrite, 'cross-connection')).toEqual({ added: 1, skipped: 0, replayed: true });
    expect(first.prepare('SELECT COUNT(*) AS count FROM grocery_item WHERE household_id = ?').get('home')).toEqual({ count: 1 });
    expect(first.prepare('SELECT COUNT(*) AS count FROM grocery_week_confirmation WHERE household_id = ?').get('home')).toEqual({ count: 1 });
  } finally { second?.close(); first.close(); rmSync(directory, { recursive: true, force: true }); }
});

it('upgrades an existing grocery database without losing items when adding week confirmations', () => {
  const directory = mkdtempSync(join(tmpdir(), 'hub-grocery-week-migration-'));
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON'); mkdirSync(join(directory, 'meta'));
    const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8'));
    journal.entries = journal.entries.slice(0, 18);
    for (const entry of journal.entries) copyFileSync(`drizzle/${entry.tag}.sql`, join(directory, `${entry.tag}.sql`));
    writeFileSync(join(directory, 'meta/_journal.json'), JSON.stringify(journal));
    db.exec('CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL)');
    migrateDrizzle(drizzle(db), { migrationsFolder: directory });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'grocery_week_confirmation'").get()).toBeUndefined();
    db.prepare('INSERT INTO user VALUES (?)').run('parent');
    db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'Synthetic');
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('parent', 'home', 'parent');
    db.prepare("INSERT INTO grocery_item (id, household_id, name, quantity, unit, created_by, updated_by, created_at, updated_at) VALUES ('existing', 'home', 'Existing rice', '2', 'cups', 'parent', 'parent', '2026-11-16', '2026-11-16')").run();
    migrateDrizzle(drizzle(db), { migrationsFolder: 'drizzle' });
    migrateDrizzle(drizzle(db), { migrationsFolder: 'drizzle' });
    expect(db.prepare('SELECT name, quantity, unit FROM grocery_item WHERE id = ?').get('existing')).toEqual({ name: 'Existing rice', quantity: '2', unit: 'cups' });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'grocery_week_confirmation'").get()).toEqual({ name: 'grocery_week_confirmation' });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'grocery_week_confirmation_household_key'").get()).toEqual({ name: 'grocery_week_confirmation_household_key' });
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});
