import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { ingredientLines, sameGroceryName } from '../grocery/domain';

type ItemInput = { name: string; quantity: string; unit: string };
type Item = ItemInput & { id: string; completed: boolean; version: number };

function authorize(db: Database.Database, actor: string, household: string, parent = false) {
  const member = db.prepare('SELECT role FROM membership WHERE user_id = ? AND household_id = ?').get(actor, household) as { role: string } | undefined;
  if (!member || (parent && member.role !== 'parent')) throw new Error('Not authorized');
}

function validate(input: ItemInput) {
  const value = { name: input.name.trim(), quantity: input.quantity.trim(), unit: input.unit.trim() };
  if (!value.name || value.name.length > 200 || value.quantity.length > 60 || value.unit.length > 60) throw new Error('Invalid grocery item');
  return value;
}

export function listGroceries(db: Database.Database, actor: string, household: string): Item[] {
  authorize(db, actor, household);
  const rows = db.prepare('SELECT id, name, quantity, unit, completed, version FROM grocery_item WHERE household_id = ? ORDER BY completed, created_at, id').all(household) as (Omit<Item, 'completed'> & { completed: number })[];
  return rows.map(row => ({ ...row, completed: !!row.completed }));
}

export function addGrocery(db: Database.Database, actor: string, household: string, input: ItemInput, allowDuplicate = false): string {
  authorize(db, actor, household); const value = validate(input);
  return db.transaction(() => {
    if (!allowDuplicate && listGroceries(db, actor, household).some(item => !item.completed && sameGroceryName(item.name, value.name))) throw new Error('Item already on list');
    const id = randomUUID(), now = new Date().toISOString();
    db.prepare('INSERT INTO grocery_item (id, household_id, name, quantity, unit, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, household, value.name, value.quantity, value.unit, actor, actor, now, now);
    return id;
  }).immediate();
}

export function changeGrocery(db: Database.Database, actor: string, household: string, id: string, version: number, input: ItemInput & { completed: boolean }): void {
  authorize(db, actor, household); const value = validate(input);
  const changed = db.prepare('UPDATE grocery_item SET name = ?, quantity = ?, unit = ?, completed = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ? AND household_id = ? AND version = ?').run(value.name, value.quantity, value.unit, Number(input.completed), actor, new Date().toISOString(), id, household, version).changes;
  if (!changed) throw new Error('Item changed or is no longer available');
}

export function removeGrocery(db: Database.Database, actor: string, household: string, id: string, version: number): void {
  authorize(db, actor, household);
  if (!db.prepare('DELETE FROM grocery_item WHERE id = ? AND household_id = ? AND version = ?').run(id, household, version).changes) throw new Error('Item changed or is no longer available');
}

export function addMealIngredients(db: Database.Database, actor: string, household: string, mealId: string, selections: string[], allowDuplicates = false): number {
  authorize(db, actor, household, true);
  return db.transaction(() => {
    const meal = db.prepare('SELECT ingredients FROM meal WHERE id = ? AND household_id = ?').get(mealId, household) as { ingredients: string } | undefined;
    if (!meal) throw new Error('Meal not found');
    const available = ingredientLines(meal.ingredients);
    if (!selections.length || selections.length > 100 || selections.some(line => !available.includes(line))) throw new Error('Invalid ingredients');
    for (const name of selections) addGrocery(db, actor, household, { name, quantity: '', unit: '' }, allowDuplicates);
    return selections.length;
  }).immediate();
}
