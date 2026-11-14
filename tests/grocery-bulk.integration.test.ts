import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from '../src/lib/server/identity';
import { addBulkGroceries, addGrocery, BulkConflictError, BulkValidationError, listGroceries } from '../src/lib/server/groceries';
import { bulkItemKey, MAX_BULK_LINES, type BulkDecision } from '../src/lib/grocery/bulk';

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

function decision(index: number, line: string, name: string, quantity = '', unit = '', action: 'add' | 'skip' = 'add'): BulkDecision {
  return { key: bulkItemKey(index), line, action, name, quantity, unit };
}

function itemNamed(db: Database.Database, name: string) {
  return listGroceries(db, 'parent', 'home').filter(item => item.name === name);
}

it('inserts a reviewed batch with quantities and units preserved', async () => {
  const db = await setup();
  try {
    const result = addBulkGroceries(db, 'parent', 'home', [
      decision(0, '2 gallons milk', 'milk', '2', 'gallons'),
      decision(1, '3 apples', 'apples', '3'),
      decision(2, '1/2 lb cheddar cheese', 'cheddar cheese', '1/2', 'lb'),
      decision(3, 'Fresh basil', 'Fresh basil')
    ]);

    expect(result).toEqual({ added: 4, skipped: 0 });
    expect(listGroceries(db, 'kid', 'home')).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'milk', quantity: '2', unit: 'gallons', completed: false }),
      expect.objectContaining({ name: 'apples', quantity: '3', unit: '' }),
      expect.objectContaining({ name: 'cheddar cheese', quantity: '1/2', unit: 'lb' }),
      expect.objectContaining({ name: 'Fresh basil', quantity: '', unit: '' })
    ]));
  } finally { db.close(); }
});

it('allows an active child to add their own reviewed batch', async () => {
  const db = await setup();
  try {
    expect(addBulkGroceries(db, 'kid', 'home', [decision(0, '2 cups rice', 'rice', '2', 'cups')])).toEqual({ added: 1, skipped: 0 });
    expect(listGroceries(db, 'parent', 'home')).toMatchObject([{ name: 'rice', quantity: '2', unit: 'cups' }]);
  } finally { db.close(); }
});

it('rejects anonymous, disabled and cross-household callers without writing', async () => {
  const db = await setup();
  try {
    const batch = [decision(0, '2 cups rice', 'rice', '2', 'cups')];
    expect(() => addBulkGroceries(db, 'anonymous', 'home', batch)).toThrow(/Not authorized/);
    expect(() => addBulkGroceries(db, 'disabled-parent', 'home', batch)).toThrow(/Not authorized/);
    expect(() => addBulkGroceries(db, 'outsider', 'home', batch)).toThrow(/Not authorized/);
    expect(() => addBulkGroceries(db, 'parent', 'other', batch)).toThrow(/Not authorized/);
    expect(listGroceries(db, 'parent', 'home')).toEqual([]);
    expect(listGroceries(db, 'outsider', 'other')).toEqual([]);
  } finally { db.close(); }
});

it('rejects a probable match with an active item and leaves existing rows untouched', async () => {
  const db = await setup();
  try {
    const existing = addGrocery(db, 'parent', 'home', { name: 'milk', quantity: '1', unit: 'gallon' });
    const before = listGroceries(db, 'parent', 'home');

    expect(() => addBulkGroceries(db, 'parent', 'home', [
      decision(0, '2 gallons milk', 'milk', '2', 'gallons'),
      decision(1, '3 apples', 'apples', '3')
    ])).toThrow(BulkConflictError);
    expect(listGroceries(db, 'parent', 'home')).toEqual(before);
    expect(itemNamed(db, 'milk')).toEqual([expect.objectContaining({ id: existing, quantity: '1', unit: 'gallon', version: 1 })]);
    expect(itemNamed(db, 'apples')).toEqual([]);
  } finally { db.close(); }
});

it('rejects a legacy row that stores the complete ingredient line', async () => {
  const db = await setup();
  try {
    addGrocery(db, 'parent', 'home', { name: '2 cups black beans', quantity: '', unit: '' });
    expect(() => addBulkGroceries(db, 'parent', 'home', [decision(0, '2 cups black beans', 'black beans', '2', 'cups')])).toThrow(BulkConflictError);
    expect(listGroceries(db, 'parent', 'home')).toHaveLength(1);
  } finally { db.close(); }
});

it('rejects duplicate names among the accepted items instead of combining them', async () => {
  const db = await setup();
  try {
    expect(() => addBulkGroceries(db, 'parent', 'home', [
      decision(0, '2 apples', 'apples', '2'),
      decision(1, '3 apples', 'apples', '3')
    ])).toThrow(BulkConflictError);
    expect(listGroceries(db, 'parent', 'home')).toEqual([]);
  } finally { db.close(); }
});

it('inserts accepted items atomically and leaves skipped items alone', async () => {
  const db = await setup();
  try {
    expect(addBulkGroceries(db, 'parent', 'home', [
      decision(0, '2 cups rice', 'rice', '2', 'cups'),
      decision(1, 'Salt to taste', 'Salt to taste', '', '', 'skip'),
      decision(2, '3 apples', 'apples', '3')
    ])).toEqual({ added: 2, skipped: 1 });
    expect(listGroceries(db, 'parent', 'home').map(item => item.name).sort()).toEqual(['apples', 'rice']);
  } finally { db.close(); }
});

it('validates every submitted field before writing', async () => {
  const db = await setup();
  try {
    const invalid: BulkDecision[][] = [
      [],
      [decision(0, '2 cups rice', '   ', '2', 'cups')],
      [decision(0, '2 cups rice', 'x'.repeat(201), '2', 'cups')],
      [decision(0, '2 cups rice', 'rice', '1'.repeat(61), 'cups')],
      [decision(0, '2 cups rice', 'rice', '2', 'x'.repeat(61))],
      [decision(0, '2 cups rice', 'rice', '2', 'cups'), decision(0, '3 apples', 'apples', '3')],
      [{ ...decision(0, '2 cups rice', 'rice', '2', 'cups'), action: 'forged' as 'add' }],
      [decision(0, '2 cups rice', 'rice', '2', 'cups'), decision(1, 'Salt to taste', '', '', '', 'skip')]
    ];
    for (const batch of invalid) expect(() => addBulkGroceries(db, 'parent', 'home', batch)).toThrow(BulkValidationError);

    expect(() => addBulkGroceries(db, 'parent', 'home', Array.from({ length: MAX_BULK_LINES + 1 }, (_, index) => decision(index, `synthetic ${index}`, `synthetic ${index}`)))).toThrow(BulkValidationError);
    expect(() => addBulkGroceries(db, 'parent', 'home', [decision(0, 'x'.repeat(6001), 'rice')])).toThrow(BulkValidationError);
    expect(listGroceries(db, 'parent', 'home')).toEqual([]);
  } finally { db.close(); }
});

it('rejects a repeated submission of an already accepted batch without duplicating items', async () => {
  const db = await setup();
  try {
    const batch = [
      decision(0, '2 gallons milk', 'milk', '2', 'gallons'),
      decision(1, '3 apples', 'apples', '3')
    ];
    expect(addBulkGroceries(db, 'parent', 'home', batch)).toEqual({ added: 2, skipped: 0 });
    expect(() => addBulkGroceries(db, 'parent', 'home', batch)).toThrow(BulkConflictError);
    expect(listGroceries(db, 'parent', 'home')).toHaveLength(2);
    expect(itemNamed(db, 'milk')).toHaveLength(1);
    expect(itemNamed(db, 'apples')).toHaveLength(1);
  } finally { db.close(); }
});

it('rejects a batch when another connection adds a matching item before confirmation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fleck-bulk-'));
  const dbPath = join(directory, 'fixture.sqlite');
  const first = new Database(dbPath);
  first.pragma('foreign_keys = ON');
  const second = new Database(dbPath);
  second.pragma('foreign_keys = ON');
  try {
    await migrate(first);
    for (const id of ['parent', 'other-parent']) first.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, `${id}@example.test`);
    first.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'home');
    for (const id of ['parent', 'other-parent']) first.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(id, 'home', 'parent');

    addGrocery(second, 'other-parent', 'home', { name: 'milk', quantity: '2', unit: 'gallons' });
    expect(listGroceries(first, 'parent', 'home')).toHaveLength(1);

    expect(() => addBulkGroceries(first, 'parent', 'home', [
      decision(0, '2 gallons milk', 'milk', '2', 'gallons'),
      decision(1, '3 apples', 'apples', '3')
    ])).toThrow(BulkConflictError);
    expect(listGroceries(first, 'parent', 'home')).toHaveLength(1);
    expect(itemNamed(first, 'apples')).toEqual([]);
    expect(itemNamed(first, 'milk')).toEqual([expect.objectContaining({ quantity: '2', unit: 'gallons' })]);
  } finally {
    second.close();
    first.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it('does not modify unrelated, bought or other-household grocery rows', async () => {
  const db = await setup();
  try {
    const boughtId = addGrocery(db, 'parent', 'home', { name: 'Synthetic bought oats', quantity: '1', unit: 'bag' });
    db.prepare('UPDATE grocery_item SET completed = 1 WHERE id = ?').run(boughtId);
    const otherId = addGrocery(db, 'outsider', 'other', { name: 'Synthetic other rice', quantity: '', unit: '' });
    const snapshot = db.prepare('SELECT id, name, quantity, unit, completed, version, updated_at AS updatedAt FROM grocery_item WHERE id IN (?, ?) ORDER BY id');
    const before = snapshot.all(boughtId, otherId);

    expect(addBulkGroceries(db, 'kid', 'home', [decision(0, '2 cups synthetic rice', 'synthetic rice', '2', 'cups')])).toEqual({ added: 1, skipped: 0 });

    const after = snapshot.all(boughtId, otherId);
    expect(after).toEqual(before);
  } finally { db.close(); }
});
