import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../src/lib/server/identity';
import {
  addGrocery,
  changeGrocery,
  clearBoughtGroceries,
  confirmMealIngredients,
  GroceryClearConflictError,
  GroceryClearValidationError,
  IngredientConflictError,
  IngredientValidationError,
  listGroceries,
  removeGrocery,
  reviewMealIngredients
} from '../src/lib/server/groceries';
import { createMeal, updateMeal } from '../src/lib/server/meals';
import { familyIngredientKey, providerIngredientKey, type IngredientDecision, type IngredientReview } from '../src/lib/grocery/handoff';

async function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  await migrate(db);
  for (const id of ['parent', 'kid', 'outsider', 'disabled-parent']) db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, `${id}@example.test`);
  for (const id of ['home', 'other']) db.prepare('INSERT INTO household VALUES (?, ?)').run(id, id);
  db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('parent', 'home', 'parent');
  db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('kid', 'home', 'kid');
  db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('outsider', 'other', 'parent');
  db.prepare('INSERT INTO membership (user_id, household_id, role, disabled_at, disabled_by) VALUES (?, ?, ?, ?, ?)').run('disabled-parent', 'home', 'parent', Date.now(), 'parent');
  return db;
}

function addBought(db: Database.Database, actor: string, household: string, input: { name: string; quantity?: string; unit?: string }) {
  const value = { name: input.name, quantity: input.quantity ?? '', unit: input.unit ?? '' };
  const id = addGrocery(db, actor, household, value);
  changeGrocery(db, actor, household, id, 1, { ...value, completed: true });
  return { id, version: 2 };
}

function decisions(review: IngredientReview, change: (item: IngredientReview['items'][number]) => Partial<IngredientDecision> = () => ({})): IngredientDecision[] {
  return review.items.map(item => ({ key: item.key, line: item.line, action: item.action, name: item.name, quantity: item.quantity, unit: item.unit, ...change(item) }));
}

function itemNamed(db: Database.Database, household: string, name: string) {
  return listGroceries(db, 'parent', household).filter(item => item.name === name);
}

it('imports reviewed ingredient quantities and units from family and provider groups', async () => {
  const db = await setup();
  try {
    const recipeUrl = 'https://emeals.com/recipes/synthetic-handoff';
    const meal = createMeal(db, 'parent', 'home', {
      title: 'Reviewed dinner',
      date: '2099-01-02',
      ingredients: '2 cups black beans\n1 onion\nSalt to taste',
      recipeUrl,
      recipeDetails: {
        sourceUrl: recipeUrl,
        title: 'Reviewed dinner',
        yield: null,
        totalTime: null,
        groups: [{ name: 'Synthetic Main', lines: ['1½ cups synthetic rice', '2 Tbsp synthetic oil'] }]
      },
      shared: false
    });

    const review = reviewMealIngredients(db, 'parent', 'home', meal, [
      familyIngredientKey(0),
      familyIngredientKey(1),
      familyIngredientKey(2),
      providerIngredientKey(0, 0),
      providerIngredientKey(0, 1)
    ]);
    expect(review.items).toMatchObject([
      { line: '2 cups black beans', source: 'family', group: null, name: 'black beans', quantity: '2', unit: 'cups', needsReview: false },
      { line: '1 onion', source: 'family', group: null, name: 'onion', quantity: '1', unit: '', needsReview: false },
      { line: 'Salt to taste', source: 'family', group: null, name: 'Salt to taste', quantity: '', unit: '', needsReview: false },
      { line: '1½ cups synthetic rice', source: 'provider', group: 'Synthetic Main', name: 'synthetic rice', quantity: '1½', unit: 'cups', needsReview: false },
      { line: '2 Tbsp synthetic oil', source: 'provider', group: 'Synthetic Main', name: 'synthetic oil', quantity: '2', unit: 'Tbsp', needsReview: false }
    ]);

    expect(confirmMealIngredients(db, 'parent', 'home', meal, decisions(review))).toEqual({ added: 5, skipped: 0 });
    expect(itemNamed(db, 'home', 'black beans')).toMatchObject([{ quantity: '2', unit: 'cups' }]);
    expect(itemNamed(db, 'home', 'onion')).toMatchObject([{ quantity: '1', unit: '' }]);
    expect(itemNamed(db, 'home', 'Salt to taste')).toMatchObject([{ quantity: '', unit: '' }]);
    expect(itemNamed(db, 'home', 'synthetic rice')).toMatchObject([{ quantity: '1½', unit: 'cups' }]);
    expect(itemNamed(db, 'home', 'synthetic oil')).toMatchObject([{ quantity: '2', unit: 'Tbsp' }]);
    expect(listGroceries(db, 'kid', 'home')).toHaveLength(5);
  } finally { db.close(); }
});

it('requires explicit duplicate confirmation and never combines quantities', async () => {
  const db = await setup();
  try {
    const meal = createMeal(db, 'parent', 'home', { title: 'Onion soup', date: '2099-01-03', ingredients: '1 onion', shared: false });
    const existing = addGrocery(db, 'parent', 'home', { name: 'onion', quantity: '2', unit: '' });
    const review = reviewMealIngredients(db, 'parent', 'home', meal, [familyIngredientKey(0)]);
    expect(review.items[0]).toMatchObject({ name: 'onion', quantity: '1', action: 'skip', existing: { id: existing, name: 'onion', quantity: '2', unit: '' } });

    expect(() => confirmMealIngredients(db, 'parent', 'home', meal, decisions(review, () => ({ action: 'add' })))).toThrow(IngredientConflictError);
    expect(itemNamed(db, 'home', 'onion')).toHaveLength(1);

    expect(confirmMealIngredients(db, 'parent', 'home', meal, decisions(review, () => ({ action: 'duplicate' })))).toEqual({ added: 1, skipped: 0 });
    expect(itemNamed(db, 'home', 'onion').map(item => item.quantity).sort()).toEqual(['1', '2']);
    expect(itemNamed(db, 'home', 'onion').every(item => item.unit === '')).toBe(true);

    expect(confirmMealIngredients(db, 'parent', 'home', meal, decisions(review, () => ({ action: 'skip' })))).toEqual({ added: 0, skipped: 1 });
    expect(itemNamed(db, 'home', 'onion')).toHaveLength(2);
  } finally { db.close(); }
});

it('rejects forged, stale, cross-household and child handoffs without partial writes', async () => {
  const db = await setup();
  try {
    const meal = createMeal(db, 'parent', 'home', { title: 'Protected dinner', date: '2099-01-04', ingredients: '2 cups beans\n1 onion', shared: false });
    expect(() => reviewMealIngredients(db, 'kid', 'home', meal, [familyIngredientKey(0)])).toThrow();
    expect(() => reviewMealIngredients(db, 'outsider', 'other', meal, [familyIngredientKey(0)])).toThrow();
    expect(() => reviewMealIngredients(db, 'outsider', 'other', meal, [familyIngredientKey(0)])).toThrow();
    expect(() => reviewMealIngredients(db, 'parent', 'home', meal, ['family:99'])).toThrow();
    expect(() => reviewMealIngredients(db, 'parent', 'home', meal, [familyIngredientKey(0), familyIngredientKey(0)])).toThrow();

    const review = reviewMealIngredients(db, 'parent', 'home', meal, [familyIngredientKey(0)]);
    const forgedLine = decisions(review, () => ({ line: 'forged ingredient' }));
    expect(() => confirmMealIngredients(db, 'parent', 'home', meal, forgedLine)).toThrow();
    expect(listGroceries(db, 'parent', 'home')).toEqual([]);

    const forgedHousehold = decisions(review);
    expect(() => confirmMealIngredients(db, 'parent', 'other', meal, forgedHousehold)).toThrow();
    expect(listGroceries(db, 'parent', 'home')).toEqual([]);
    expect(listGroceries(db, 'outsider', 'other')).toEqual([]);

    const validThenForged: IngredientDecision[] = [
      ...decisions(review),
      ...decisions(review, item => ({ key: `${item.key}-forged`, line: 'forged ingredient' }))
    ];
    expect(() => confirmMealIngredients(db, 'parent', 'home', meal, validThenForged)).toThrow();
    expect(listGroceries(db, 'parent', 'home')).toEqual([]);

    expect(() => confirmMealIngredients(db, 'kid', 'home', meal, decisions(review))).toThrow();
    expect(listGroceries(db, 'parent', 'home')).toEqual([]);
  } finally { db.close(); }
});

it('rechecks matches at confirmation time and leaves no partial writes', async () => {
  const db = await setup();
  try {
    const meal = createMeal(db, 'parent', 'home', { title: 'Concurrent dinner', date: '2099-01-05', ingredients: '2 cups beans\n1 onion', shared: false });
    const review = reviewMealIngredients(db, 'parent', 'home', meal, [familyIngredientKey(0), familyIngredientKey(1)]);
    addGrocery(db, 'parent', 'home', { name: 'beans', quantity: '3', unit: 'cups' });

    expect(() => confirmMealIngredients(db, 'parent', 'home', meal, decisions(review))).toThrow(IngredientConflictError);
    expect(listGroceries(db, 'parent', 'home')).toMatchObject([{ name: 'beans', quantity: '3', unit: 'cups' }]);

    const refreshed = reviewMealIngredients(db, 'parent', 'home', meal, [familyIngredientKey(0), familyIngredientKey(1)], {
      [familyIngredientKey(0)]: { action: 'skip', name: 'my beans', quantity: '4', unit: 'bags' }
    });
    expect(refreshed.items[0]).toMatchObject({ name: 'my beans', quantity: '4', unit: 'bags', action: 'skip', existing: { name: 'beans' } });
    expect(refreshed.items.map(item => item.action)).toEqual(['skip', 'add']);
    expect(confirmMealIngredients(db, 'parent', 'home', meal, decisions(refreshed))).toEqual({ added: 1, skipped: 1 });
    const items = listGroceries(db, 'parent', 'home');
    expect(items).toHaveLength(2);
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'beans', quantity: '3', unit: 'cups' }),
      expect.objectContaining({ name: 'onion', quantity: '1', unit: '' })
    ]));
  } finally { db.close(); }
});

it('keeps legacy grocery rows readable and matches them by their parsed name', async () => {
  const db = await setup();
  try {
    const legacy = addGrocery(db, 'parent', 'home', { name: '2 cups black beans', quantity: '', unit: '' });
    expect(listGroceries(db, 'kid', 'home')).toMatchObject([{ id: legacy, name: '2 cups black beans', quantity: '', unit: '' }]);
    changeGrocery(db, 'kid', 'home', legacy, 1, { name: '2 cups black beans', quantity: '', unit: 'dry', completed: false });

    const meal = createMeal(db, 'parent', 'home', { title: 'Legacy dinner', date: '2099-01-06', ingredients: '2 cups black beans', shared: false });
    const review = reviewMealIngredients(db, 'parent', 'home', meal, [familyIngredientKey(0)]);
    expect(review.items[0]).toMatchObject({ name: 'black beans', quantity: '2', unit: 'cups', action: 'skip', existing: { id: legacy } });

    expect(confirmMealIngredients(db, 'parent', 'home', meal, decisions(review, () => ({ action: 'duplicate' })))).toEqual({ added: 1, skipped: 0 });
    const items = listGroceries(db, 'parent', 'home');
    expect(items).toHaveLength(2);
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: legacy, name: '2 cups black beans', quantity: '', unit: 'dry' }),
      expect.objectContaining({ name: 'black beans', quantity: '2', unit: 'cups' })
    ]));
  } finally { db.close(); }
});

it('validates edited fields and does not corrupt the list', async () => {
  const db = await setup();
  try {
    const meal = createMeal(db, 'parent', 'home', { title: 'Edit dinner', date: '2099-01-07', ingredients: '1 onion', shared: false });
    const review = reviewMealIngredients(db, 'parent', 'home', meal, [familyIngredientKey(0)]);

    expect(() => confirmMealIngredients(db, 'parent', 'home', meal, decisions(review, () => ({ name: '   ' })))).toThrow(IngredientValidationError);
    expect(() => confirmMealIngredients(db, 'parent', 'home', meal, decisions(review, () => ({ name: 'x'.repeat(201) })))).toThrow(IngredientValidationError);
    expect(() => confirmMealIngredients(db, 'parent', 'home', meal, decisions(review, () => ({ quantity: '1'.repeat(61) })))).toThrow(IngredientValidationError);
    expect(() => confirmMealIngredients(db, 'parent', 'home', meal, decisions(review, () => ({ unit: 'x'.repeat(61) })))).toThrow(IngredientValidationError);
    expect(listGroceries(db, 'parent', 'home')).toEqual([]);

    const recovered = reviewMealIngredients(db, 'parent', 'home', meal, [familyIngredientKey(0)], {
      [familyIngredientKey(0)]: { action: 'add', name: '   ', quantity: '4', unit: 'bags' }
    });
    expect(recovered.items[0]).toMatchObject({ action: 'add', name: '   ', quantity: '4', unit: 'bags' });

    expect(confirmMealIngredients(db, 'parent', 'home', meal, decisions(review, () => ({ name: 'yellow onions', quantity: '3', unit: 'bags' })))).toEqual({ added: 1, skipped: 0 });
    expect(listGroceries(db, 'parent', 'home')).toMatchObject([{ name: 'yellow onions', quantity: '3', unit: 'bags' }]);
  } finally { db.close(); }
});

it('shows an exact duplicate from overlapping groups once by default', async () => {
  const db = await setup();
  try {
    const recipeUrl = 'https://emeals.com/recipes/synthetic-overlap';
    const meal = createMeal(db, 'parent', 'home', {
      title: 'Overlap dinner',
      date: '2099-01-08',
      ingredients: '1 onion',
      recipeUrl,
      recipeDetails: { sourceUrl: recipeUrl, title: null, yield: null, totalTime: null, groups: [{ name: 'Synthetic Main', lines: ['1 onion'] }] },
      shared: false
    });
    const review = reviewMealIngredients(db, 'parent', 'home', meal, [familyIngredientKey(0), providerIngredientKey(0, 0)]);
    expect(review.items).toMatchObject([
      { source: 'family', group: null, duplicateOfSelection: false, action: 'add' },
      { source: 'provider', group: 'Synthetic Main', duplicateOfSelection: true, action: 'skip' }
    ]);
    expect(confirmMealIngredients(db, 'parent', 'home', meal, decisions(review))).toEqual({ added: 1, skipped: 1 });
    expect(itemNamed(db, 'home', 'onion')).toHaveLength(1);
  } finally { db.close(); }
});

it('does not merge different products with similar names', async () => {
  const db = await setup();
  try {
    addGrocery(db, 'parent', 'home', { name: 'red apples', quantity: '2', unit: '' });
    const meal = createMeal(db, 'parent', 'home', { title: 'Apple dinner', date: '2099-01-09', ingredients: '2 green apples', shared: false });
    const review = reviewMealIngredients(db, 'parent', 'home', meal, [familyIngredientKey(0)]);
    expect(review.items[0]).toMatchObject({ name: 'green apples', quantity: '2', unit: '', existing: null, action: 'add' });
    expect(confirmMealIngredients(db, 'parent', 'home', meal, decisions(review))).toEqual({ added: 1, skipped: 0 });
    expect(listGroceries(db, 'parent', 'home').map(item => item.name).sort()).toEqual(['green apples', 'red apples']);
  } finally { db.close(); }
});

it('leaves meal saving and recipe preview data unchanged after a handoff', async () => {
  const db = await setup();
  try {
    const recipeUrl = 'https://emeals.com/recipes/synthetic-unchanged';
    const meal = createMeal(db, 'parent', 'home', {
      title: 'Unchanged dinner',
      date: '2099-01-10',
      ingredients: '2 cups beans',
      recipeUrl,
      recipeDetails: { sourceUrl: recipeUrl, title: 'Unchanged dinner', yield: '4 servings', totalTime: '25 min', groups: [{ name: 'Synthetic Main', lines: ['1 synthetic lemon'] }] },
      shared: false
    });
    const review = reviewMealIngredients(db, 'parent', 'home', meal, [familyIngredientKey(0)]);
    confirmMealIngredients(db, 'parent', 'home', meal, decisions(review));
    updateMeal(db, 'parent', 'home', meal, { title: 'Renamed dinner', date: '2099-01-10', ingredients: '2 cups beans', recipeUrl, recipeDetails: { sourceUrl: recipeUrl, title: 'Unchanged dinner', yield: '4 servings', totalTime: '25 min', groups: [{ name: 'Synthetic Main', lines: ['1 synthetic lemon'] }] }, shared: false });
    const saved = db.prepare('SELECT title, ingredients, recipe_url AS recipeUrl, recipe_details AS details FROM meal WHERE id = ?').get(meal) as { title: string; ingredients: string; recipeUrl: string; details: string };
    expect(saved.title).toBe('Renamed dinner');
    expect(saved.ingredients).toBe('2 cups beans');
    expect(saved.recipeUrl).toBe(recipeUrl);
    expect(JSON.parse(saved.details)).toMatchObject({ groups: [{ name: 'Synthetic Main', lines: ['1 synthetic lemon'] }] });
  } finally { db.close(); }
});

it('shares grocery items within the household and rejects stale edits', async () => {
  const db = await setup();
  try {
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
  } finally { db.close(); }
});

it('clears only the reviewed bought items for an active parent', async () => {
  const db = await setup();
  try {
    const apples = addGrocery(db, 'parent', 'home', { name: 'Synthetic apples', quantity: '2', unit: 'bags' });
    const bread = addBought(db, 'parent', 'home', { name: 'Synthetic bread', quantity: '1', unit: 'loaf' });
    const milk = addBought(db, 'parent', 'home', { name: 'Synthetic milk', quantity: '2', unit: 'bottles' });

    expect(clearBoughtGroceries(db, 'parent', 'home', [bread, milk])).toEqual({ cleared: 2 });
    expect(listGroceries(db, 'kid', 'home')).toMatchObject([
      { id: apples, name: 'Synthetic apples', quantity: '2', unit: 'bags', completed: false, version: 1 }
    ]);
  } finally { db.close(); }
});

it('rejects non-parent, disabled, unknown and cross-household clears without deleting anything', async () => {
  const db = await setup();
  try {
    const bread = addBought(db, 'parent', 'home', { name: 'Synthetic protected bread' });
    const otherBread = addBought(db, 'outsider', 'other', { name: 'Synthetic other bread' });
    const selection = [bread];

    expect(() => clearBoughtGroceries(db, 'kid', 'home', selection)).toThrow(/Not authorized/);
    expect(() => clearBoughtGroceries(db, 'kid', 'home', [])).toThrow(/Not authorized/);
    expect(() => clearBoughtGroceries(db, 'disabled-parent', 'home', selection)).toThrow(/Not authorized/);
    expect(() => clearBoughtGroceries(db, 'anonymous', 'home', selection)).toThrow(/Not authorized/);
    expect(() => clearBoughtGroceries(db, 'outsider', 'other', selection)).toThrow(GroceryClearConflictError);
    expect(() => clearBoughtGroceries(db, 'parent', 'home', [otherBread])).toThrow(GroceryClearConflictError);

    expect(itemNamed(db, 'home', 'Synthetic protected bread')).toHaveLength(1);
    expect(listGroceries(db, 'outsider', 'other')).toMatchObject([{ name: 'Synthetic other bread', completed: true }]);
  } finally { db.close(); }
});

it('rejects forged, duplicate, stale and completion-changed rows as one atomic batch', async () => {
  const db = await setup();
  try {
    const apples = addBought(db, 'parent', 'home', { name: 'Synthetic batch apples' });
    const bread = addBought(db, 'parent', 'home', { name: 'Synthetic batch bread' });
    const milk = addBought(db, 'parent', 'home', { name: 'Synthetic batch milk' });

    expect(() => clearBoughtGroceries(db, 'parent', 'home', [apples, { id: 'forged-item', version: 1 }])).toThrow(GroceryClearConflictError);
    expect(() => clearBoughtGroceries(db, 'parent', 'home', [apples, { id: bread.id, version: bread.version + 4 }])).toThrow(GroceryClearConflictError);
    expect(() => clearBoughtGroceries(db, 'parent', 'home', [apples, apples])).toThrow(GroceryClearValidationError);
    expect(() => clearBoughtGroceries(db, 'parent', 'home', [{ id: apples.id, version: 0 }])).toThrow(GroceryClearValidationError);
    expect(() => clearBoughtGroceries(db, 'parent', 'home', Array.from({ length: 201 }, () => apples))).toThrow(GroceryClearValidationError);
    expect(listGroceries(db, 'parent', 'home')).toHaveLength(3);

    changeGrocery(db, 'parent', 'home', bread.id, bread.version, { name: 'Synthetic batch bread', quantity: '', unit: '', completed: false });
    expect(() => clearBoughtGroceries(db, 'parent', 'home', [apples, { id: bread.id, version: bread.version + 1 }])).toThrow(GroceryClearConflictError);
    expect(listGroceries(db, 'parent', 'home')).toHaveLength(3);
    expect(listGroceries(db, 'parent', 'home').find(item => item.id === bread.id)?.completed).toBe(false);

    expect(clearBoughtGroceries(db, 'parent', 'home', [apples, milk])).toEqual({ cleared: 2 });
    expect(listGroceries(db, 'parent', 'home')).toMatchObject([{ id: bread.id, completed: false }]);
  } finally { db.close(); }
});

it('leaves newly added bought items alone and handles empty or repeated submissions', async () => {
  const db = await setup();
  try {
    expect(clearBoughtGroceries(db, 'parent', 'home', [])).toEqual({ cleared: 0 });

    const reviewed = addBought(db, 'parent', 'home', { name: 'Synthetic reviewed rice' });
    const addedLater = addBought(db, 'parent', 'home', { name: 'Synthetic later rice' });
    expect(clearBoughtGroceries(db, 'parent', 'home', [reviewed])).toEqual({ cleared: 1 });

    const fresh = addBought(db, 'parent', 'home', { name: 'Synthetic fresh rice' });
    expect(() => clearBoughtGroceries(db, 'parent', 'home', [reviewed])).toThrow(GroceryClearConflictError);
    expect(listGroceries(db, 'parent', 'home')).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: addedLater.id, completed: true }),
      expect.objectContaining({ id: fresh.id, completed: true })
    ]));
    expect(listGroceries(db, 'parent', 'home')).toHaveLength(2);
    expect(clearBoughtGroceries(db, 'parent', 'home', [addedLater, fresh])).toEqual({ cleared: 2 });
    expect(listGroceries(db, 'parent', 'home')).toEqual([]);
  } finally { db.close(); }
});

it('keeps per-item changes, removals and meal handoff working after a clear', async () => {
  const db = await setup();
  try {
    const cleared = addBought(db, 'parent', 'home', { name: 'Synthetic cleared oats' });
    const remaining = addGrocery(db, 'parent', 'home', { name: 'Synthetic remaining oats', quantity: '1', unit: 'bag' });
    expect(clearBoughtGroceries(db, 'parent', 'home', [cleared])).toEqual({ cleared: 1 });

    changeGrocery(db, 'kid', 'home', remaining, 1, { name: 'Synthetic remaining oats', quantity: '2', unit: 'bags', completed: false });
    expect(listGroceries(db, 'parent', 'home')).toMatchObject([{ id: remaining, quantity: '2', unit: 'bags' }]);

    const meal = createMeal(db, 'parent', 'home', { title: 'Synthetic after clear dinner', date: '2099-01-11', ingredients: '1 onion', shared: false });
    const review = reviewMealIngredients(db, 'parent', 'home', meal, [familyIngredientKey(0)]);
    expect(confirmMealIngredients(db, 'parent', 'home', meal, decisions(review))).toEqual({ added: 1, skipped: 0 });
    expect(itemNamed(db, 'home', 'onion')).toHaveLength(1);

    removeGrocery(db, 'kid', 'home', remaining, 2);
    expect(listGroceries(db, 'parent', 'home')).toMatchObject([{ name: 'onion' }]);
  } finally { db.close(); }
});
