import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../src/lib/server/identity';
import { addGrocery, addMealIngredients, changeGrocery, listGroceries, removeGrocery } from '../src/lib/server/groceries';
import { createMeal } from '../src/lib/server/meals';

it('accepts stored provider ingredient lines and deduplicates selections', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON'); await migrate(db);
    for (const id of ['parent', 'kid']) db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, `${id}@example.test`);
    db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'home');
    db.prepare('INSERT INTO membership VALUES (?, ?, ?)').run('parent', 'home', 'parent');
    db.prepare('INSERT INTO membership VALUES (?, ?, ?)').run('kid', 'home', 'kid');
    const recipeUrl = 'https://emeals.com/recipes/synthetic-preview';
    const meal = createMeal(db, 'parent', 'home', {
      title: 'Provider dinner',
      date: '2099-01-02',
      ingredients: '1 family carrot',
      recipeUrl,
      recipeDetails: { sourceUrl: recipeUrl, title: 'Provider dinner', yield: null, totalTime: null, groups: [{ name: 'Synthetic Main', lines: ['1 provider rice', '1 provider lemon'] }] },
      shared: false
    });
    expect(() => addMealIngredients(db, 'parent', 'home', meal, ['1 forged provider line'])).toThrow();
    expect(addMealIngredients(db, 'parent', 'home', meal, ['1 provider rice', '1 provider rice'], true)).toBe(1);
    expect(listGroceries(db, 'parent', 'home')).toMatchObject([{ name: '1 provider rice' }]);
    expect(addMealIngredients(db, 'parent', 'home', meal, ['1 family carrot', '1 provider lemon'])).toBe(2);
    expect(listGroceries(db, 'parent', 'home').map(item => item.name).sort()).toEqual(['1 family carrot', '1 provider lemon', '1 provider rice']);
    expect(() => addMealIngredients(db, 'kid', 'home', meal, ['1 provider rice'])).toThrow();
  } finally { db.close(); }
});

it('shares grocery items within the household and rejects stale edits', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON'); await migrate(db);
    for (const id of ['parent', 'kid', 'outsider']) db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, `${id}@example.test`);
    for (const id of ['home', 'other']) db.prepare('INSERT INTO household VALUES (?, ?)').run(id, id);
    db.prepare('INSERT INTO membership VALUES (?, ?, ?)').run('parent', 'home', 'parent');
    db.prepare('INSERT INTO membership VALUES (?, ?, ?)').run('kid', 'home', 'kid');
    db.prepare('INSERT INTO membership VALUES (?, ?, ?)').run('outsider', 'other', 'parent');
    const id = addGrocery(db, 'parent', 'home', { name: 'Apples', quantity: '2', unit: 'bags' });
    expect(listGroceries(db, 'kid', 'home')).toMatchObject([{ id, name: 'Apples', quantity: '2', unit: 'bags', version: 1 }]);
    expect(() => addGrocery(db, 'kid', 'home', { name: ' apples ', quantity: '3', unit: 'bags' })).toThrow(/already/i);
    expect(() => changeGrocery(db, 'outsider', 'other', id, 1, { name: 'Stolen', quantity: '', unit: '', completed: false })).toThrow();
    changeGrocery(db, 'kid', 'home', id, 1, { name: 'Apples', quantity: '2', unit: 'bags', completed: true });
    expect(() => changeGrocery(db, 'parent', 'home', id, 1, { name: 'Apples', quantity: '3', unit: 'bags', completed: false })).toThrow(/changed/i);
    expect(listGroceries(db, 'parent', 'home')).toMatchObject([{ id, quantity: '2', completed: true, version: 2 }]);
    expect(listGroceries(db, 'outsider', 'other')).toEqual([]);
    expect(() => removeGrocery(db, 'parent', 'home', id, 1)).toThrow(/changed/i);
    removeGrocery(db, 'parent', 'home', id, 2);
    expect(listGroceries(db, 'kid', 'home')).toEqual([]);
    const meal = createMeal(db, 'parent', 'home', { title: 'Soup', date: '2099-01-01', ingredients: '2 cups beans\n1 onion', shared: false });
    expect(() => addMealIngredients(db, 'kid', 'home', meal, ['2 cups beans'])).toThrow();
    expect(() => addMealIngredients(db, 'parent', 'home', meal, ['forged ingredient'])).toThrow();
    addGrocery(db, 'parent', 'home', { name: 'onion', quantity: '', unit: '' });
    expect(() => addMealIngredients(db, 'parent', 'home', meal, ['1 onion'])).toThrow(/already/i);
    const onion = listGroceries(db, 'parent', 'home')[0];
    removeGrocery(db, 'parent', 'home', onion.id, onion.version);
    expect(addMealIngredients(db, 'parent', 'home', meal, ['2 cups beans'])).toBe(1);
    expect(() => addMealIngredients(db, 'parent', 'home', meal, ['1 onion', '2 cups beans'])).toThrow(/already/i);
    expect(listGroceries(db, 'kid', 'home')).toMatchObject([{ name: '2 cups beans' }]);
    expect(addMealIngredients(db, 'parent', 'home', meal, ['1 onion', '2 cups beans'], true)).toBe(2);
  } finally { db.close(); }
});
