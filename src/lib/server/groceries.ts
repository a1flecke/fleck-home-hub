import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { MAX_BULK_INPUT_CHARS, MAX_BULK_LINES, bulkActions, type BulkDecision } from '../grocery/bulk';
import { ingredientLines, matchesActiveGrocery, MAX_BOUGHT_CLEAR_ROWS, probableGroceryMatch, sameGroceryName } from '../grocery/domain';
import {
  familyIngredientKey,
  ingredientActions,
  providerIngredientKey,
  type IngredientAction,
  type IngredientDecision,
  type IngredientReview,
  type IngredientReviewItem,
  type IngredientReviewOverrides,
  type IngredientSource
} from '../grocery/handoff';
import { parseIngredientLine } from '../grocery/ingredient-parser';
import { buildWeekIngredientReview, type WeekIngredientRef, type WeekIngredientReview } from '../grocery/week';
import { parseRecipeDetailsJson, recipeDetailsForMeal } from '../meals/recipe-details';
import { listMealWeek } from './meals';

type ItemInput = { name: string; quantity: string; unit: string };
type Item = ItemInput & { id: string; completed: boolean; version: number };
type MealIngredientRef = { key: string; line: string; source: IngredientSource; group: string | null };
export type BoughtSelection = { id: string; version: number };

/** One request may review at most this many bought rows before clearing (see grocery/domain). */
export { MAX_BOUGHT_CLEAR_ROWS };
/** One week may review or confirm at most this many selected ingredient lines. */
export const MAX_WEEK_INGREDIENT_LINES = 150;
/** A retry key is an opaque client value with a bounded length. */
export const MAX_CONFIRMATION_KEY_LENGTH = 100;

export class IngredientValidationError extends Error {}
export class IngredientConflictError extends Error {
  constructor(readonly keys: string[]) { super('Ingredient now matches an active grocery item'); }
}
export class StaleIngredientSelectionError extends Error {}
export class BulkValidationError extends Error {}
export class BulkConflictError extends Error {
  constructor(readonly keys: string[]) { super('Batch now matches active grocery items'); }
}
export class GroceryClearValidationError extends Error {}
export class GroceryClearConflictError extends Error {
  constructor() { super('Bought items changed or are no longer available'); }
}
export class WeekIngredientValidationError extends Error {}
export class WeekIngredientConflictError extends Error {
  constructor(readonly keys: string[]) { super('Week ingredient now matches an active grocery item'); }
}
export class StaleWeekIngredientSelectionError extends Error {}

function authorize(db: Database.Database, actor: string, household: string, parent = false) {
  const member = db.prepare('SELECT role FROM active_membership WHERE user_id = ? AND household_id = ?').get(actor, household) as { role: string } | undefined;
  if (!member || (parent && member.role !== 'parent')) throw new Error('Not authorized');
}

function validate(input: ItemInput) {
  const value = { name: input.name.trim(), quantity: input.quantity.trim(), unit: input.unit.trim() };
  if (!value.name || value.name.length > 200 || value.quantity.length > 60 || value.unit.length > 60) throw new IngredientValidationError('Invalid grocery item');
  return value;
}

function insertGrocery(db: Database.Database, actor: string, household: string, value: ItemInput): string {
  const id = randomUUID(), now = new Date().toISOString();
  db.prepare('INSERT INTO grocery_item (id, household_id, name, quantity, unit, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, household, value.name, value.quantity, value.unit, actor, actor, now, now);
  return id;
}

function groceryItems(db: Database.Database, household: string): Item[] {
  const rows = db.prepare('SELECT id, name, quantity, unit, completed, version FROM grocery_item WHERE household_id = ? ORDER BY completed, created_at, id').all(household) as (Omit<Item, 'completed'> & { completed: number })[];
  return rows.map(row => ({ ...row, completed: !!row.completed }));
}

export function listGroceries(db: Database.Database, actor: string, household: string): Item[] {
  authorize(db, actor, household);
  return groceryItems(db, household);
}

export function addGrocery(db: Database.Database, actor: string, household: string, input: ItemInput, allowDuplicate = false): string {
  return db.transaction(() => {
    authorize(db, actor, household);
    const value = validate(input);
    if (!allowDuplicate && groceryItems(db, household).some(item => !item.completed && sameGroceryName(item.name, value.name))) throw new Error('Item already on list');
    return insertGrocery(db, actor, household, value);
  }).immediate();
}

export function changeGrocery(db: Database.Database, actor: string, household: string, id: string, version: number, input: ItemInput & { completed: boolean }): void {
  db.transaction(() => {
    authorize(db, actor, household);
    const value = validate(input);
    const changed = db.prepare('UPDATE grocery_item SET name = ?, quantity = ?, unit = ?, completed = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ? AND household_id = ? AND version = ?').run(value.name, value.quantity, value.unit, Number(input.completed), actor, new Date().toISOString(), id, household, version).changes;
    if (!changed) throw new Error('Item changed or is no longer available');
  }).immediate();
}

export function removeGrocery(db: Database.Database, actor: string, household: string, id: string, version: number): void {
  db.transaction(() => {
    authorize(db, actor, household);
    if (!db.prepare('DELETE FROM grocery_item WHERE id = ? AND household_id = ? AND version = ?').run(id, household, version).changes) throw new Error('Item changed or is no longer available');
  }).immediate();
}

/**
 * Removes exactly the bought rows a parent reviewed. The identifiers and versions are
 * untrusted, so every row is re-read and rechecked inside one immediate transaction.
 * A missing, forged, cross-household, duplicated, stale or no-longer-bought row rejects
 * the whole batch. Rows added after review are not part of the selection and stay put.
 */
export function clearBoughtGroceries(db: Database.Database, actor: string, household: string, selection: BoughtSelection[]): { cleared: number } {
  return db.transaction(() => {
    authorize(db, actor, household, true);
    if (!Array.isArray(selection) || selection.length > MAX_BOUGHT_CLEAR_ROWS) throw new GroceryClearValidationError('Invalid bought selection');
    if (!selection.length) return { cleared: 0 };

    const seen = new Set<string>();
    for (const entry of selection) {
      if (!entry || typeof entry.id !== 'string' || !entry.id || entry.id.length > 100 ||
          !Number.isSafeInteger(entry.version) || entry.version < 1 || seen.has(entry.id)) {
        throw new GroceryClearValidationError('Invalid bought selection');
      }
      seen.add(entry.id);
    }

    const find = db.prepare('SELECT household_id AS householdId, completed, version FROM grocery_item WHERE id = ?');
    const remove = db.prepare('DELETE FROM grocery_item WHERE id = ? AND household_id = ? AND completed = 1 AND version = ?');
    for (const entry of selection) {
      const row = find.get(entry.id) as { householdId: string; completed: number; version: number } | undefined;
      if (!row || row.householdId !== household || row.completed !== 1 || row.version !== entry.version) throw new GroceryClearConflictError();
      if (remove.run(entry.id, household, entry.version).changes !== 1) throw new GroceryClearConflictError();
    }
    return { cleared: selection.length };
  }).immediate();
}

function ingredientRefsFromMeal(ingredients: string, details: ReturnType<typeof recipeDetailsForMeal>): MealIngredientRef[] {
  const refs: MealIngredientRef[] = [];
  ingredientLines(ingredients).forEach((line, index) => refs.push({ key: familyIngredientKey(index), line, source: 'family', group: null }));
  details?.groups.forEach((group, groupIndex) => group.lines.forEach((line, lineIndex) => refs.push({ key: providerIngredientKey(groupIndex, lineIndex), line, source: 'provider', group: group.name })));
  return refs;
}

function mealIngredientRefs(db: Database.Database, household: string, mealId: string): { title: string; refs: MealIngredientRef[] } {
  const meal = db.prepare('SELECT title, ingredients, recipe_url AS recipeUrl, recipe_details AS recipeDetailsJson FROM meal WHERE id = ? AND household_id = ?').get(mealId, household) as { title: string; ingredients: string; recipeUrl: string | null; recipeDetailsJson: string | null } | undefined;
  if (!meal) throw new Error('Meal not found');
  const details = recipeDetailsForMeal(parseRecipeDetailsJson(meal.recipeDetailsJson), meal.recipeUrl);
  return { title: meal.title, refs: ingredientRefsFromMeal(meal.ingredients, details) };
}

function mealIngredients(db: Database.Database, actor: string, household: string, mealId: string): { title: string; refs: MealIngredientRef[] } {
  authorize(db, actor, household, true);
  return mealIngredientRefs(db, household, mealId);
}

function normalizedLine(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Resolves selected ingredient keys against the meal's current authorized lines and returns
 * editable proposals. Nothing is written; every value can be changed by the parent.
 */
export function reviewMealIngredients(db: Database.Database, actor: string, household: string, mealId: string, keys: string[], overrides: IngredientReviewOverrides = {}): IngredientReview {
  const { title, refs } = mealIngredients(db, actor, household, mealId);
  const byKey = new Map(refs.map(ref => [ref.key, ref]));
  const uniqueKeys = [...new Set(keys)];
  if (uniqueKeys.length !== keys.length) throw new Error('Invalid ingredients');
  if (!uniqueKeys.length || uniqueKeys.length > 100 || uniqueKeys.some(key => !byKey.has(key))) throw new Error('Invalid ingredients');

  const active = listGroceries(db, actor, household).filter(item => !item.completed);
  const seen = new Set<string>();
  const items: IngredientReviewItem[] = uniqueKeys.map(key => {
    const ref = byKey.get(key)!;
    const parsed = parseIngredientLine(ref.line);
    const override = overrides[key] ?? {};
    const name = override.name ?? parsed.name;
    const existing = active.find(item => matchesActiveGrocery(name, ref.line, item.name, override.name !== undefined)) ?? null;
    const lineKey = normalizedLine(ref.line);
    const duplicateOfSelection = seen.has(lineKey);
    seen.add(lineKey);

    let action: IngredientAction = override.action ?? (existing || duplicateOfSelection ? 'skip' : 'add');
    if (!existing && action === 'duplicate') action = 'add';
    if (existing && action === 'add') action = 'skip';

    return {
      ...parsed,
      key: ref.key,
      line: ref.line,
      source: ref.source,
      group: ref.group,
      existing: existing ? { id: existing.id, name: existing.name, quantity: existing.quantity, unit: existing.unit } : null,
      duplicateOfSelection,
      action,
      name,
      quantity: override.quantity ?? parsed.quantity,
      unit: override.unit ?? parsed.unit
    };
  });
  return { mealId, mealTitle: title, items };
}

/**
 * Revalidates every submitted proposal against the meal and the current grocery list, then
 * adds the accepted rows in one immediate transaction. A row that gained a matching active
 * item after review is rejected instead of silently creating a duplicate; no rows are written
 * when any proposal is stale, invalid or conflicting.
 */
export function confirmMealIngredients(db: Database.Database, actor: string, household: string, mealId: string, decisions: IngredientDecision[]): { added: number; skipped: number } {
  return db.transaction(() => {
    const { refs } = mealIngredients(db, actor, household, mealId);
    const byKey = new Map(refs.map(ref => [ref.key, ref]));
    if (!decisions.length || decisions.length > 100) throw new IngredientValidationError('Choose ingredients');
    const keys = new Set<string>();
    for (const decision of decisions) {
      const ref = byKey.get(decision.key);
      if (!decision.key || keys.has(decision.key) || !ref || ref.line !== decision.line) throw new StaleIngredientSelectionError('Ingredient selection changed');
      keys.add(decision.key);
      if (!ingredientActions.includes(decision.action)) throw new IngredientValidationError('Invalid action');
    }

    const active = groceryItems(db, household).filter(item => !item.completed);
    const prepared = new Map<string, ItemInput>();
    const conflicts: string[] = [];
    for (const decision of decisions) {
      if (decision.action === 'skip') continue;
      const value = validate({ name: decision.name, quantity: decision.quantity, unit: decision.unit });
      if (decision.action === 'add' && active.some(item => probableGroceryMatch(value.name, item.name))) conflicts.push(decision.key);
      prepared.set(decision.key, value);
    }
    if (conflicts.length) throw new IngredientConflictError(conflicts);

    let added = 0, skipped = 0;
    for (const decision of decisions) {
      if (decision.action === 'skip') { skipped++; continue; }
      insertGrocery(db, actor, household, prepared.get(decision.key)!);
      added++;
    }
    return { added, skipped };
  }).immediate();
}

function weekIngredientRefs(db: Database.Database, actor: string, household: string, start: string, end: string) {
  const meals = listMealWeek(db, actor, household, start, end);
  const refs: WeekIngredientRef[] = meals.flatMap(meal => ingredientRefsFromMeal(meal.ingredients, meal.recipeDetails).map(ref => ({
    ...ref,
    key: `${meal.id}:${ref.key}`,
    mealId: meal.id,
    mealTitle: meal.title,
    mealDate: meal.date
  })));
  return { meals, refs };
}

/** Lists every ingredient line a parent can choose from one bounded meal week. */
export function weekIngredientSources(db: Database.Database, actor: string, household: string, start: string, end: string): WeekIngredientRef[] {
  authorize(db, actor, household, true);
  return weekIngredientRefs(db, actor, household, start, end).refs;
}

/** Builds the editable multi-meal review; nothing is written. */
export function reviewWeekIngredients(
  db: Database.Database,
  actor: string,
  household: string,
  start: string,
  end: string,
  selections: string[],
  overrides: IngredientReviewOverrides = {}
): WeekIngredientReview & { weekStart: string; weekEnd: string; mealCount: number } {
  authorize(db, actor, household, true);
  const { meals, refs } = weekIngredientRefs(db, actor, household, start, end);
  if (!Array.isArray(selections) || !selections.length || selections.length > MAX_WEEK_INGREDIENT_LINES) throw new WeekIngredientValidationError('Choose ingredients');
  const unique = [...new Set(selections)];
  if (unique.length !== selections.length) throw new StaleWeekIngredientSelectionError('Ingredient selection changed');
  const byKey = new Map(refs.map(ref => [ref.key, ref]));
  if (unique.some(key => !byKey.has(key))) throw new StaleWeekIngredientSelectionError('Ingredient selection changed');
  const active = listGroceries(db, actor, household).filter(item => !item.completed);
  const review = buildWeekIngredientReview(unique.map(key => byKey.get(key)!), active, overrides);
  return { ...review, weekStart: start, weekEnd: end, mealCount: meals.length };
}

/**
 * Revalidates every selected line against the current week, current active list and current
 * parent membership inside one immediate transaction, then writes the accepted rows together.
 * A confirmation key makes a retried or double-clicked submission return the original result
 * instead of creating another set of rows.
 */
export function confirmWeekIngredients(
  db: Database.Database,
  actor: string,
  household: string,
  start: string,
  end: string,
  decisions: IngredientDecision[],
  confirmationKey: string
): { added: number; skipped: number; replayed: boolean } {
  return db.transaction(() => {
    authorize(db, actor, household, true);
    if (typeof confirmationKey !== 'string' || !confirmationKey || confirmationKey.length > MAX_CONFIRMATION_KEY_LENGTH) throw new WeekIngredientValidationError('Invalid confirmation');
    const previous = db.prepare('SELECT added, skipped FROM grocery_week_confirmation WHERE household_id = ? AND confirmation_key = ?').get(household, confirmationKey) as { added: number; skipped: number } | undefined;
    if (previous) return { added: previous.added, skipped: previous.skipped, replayed: true };

    const { refs } = weekIngredientRefs(db, actor, household, start, end);
    const byKey = new Map(refs.map(ref => [ref.key, ref]));
    if (!Array.isArray(decisions) || !decisions.length || decisions.length > MAX_WEEK_INGREDIENT_LINES) throw new WeekIngredientValidationError('Choose ingredients');
    const keys = new Set<string>();
    for (const decision of decisions) {
      const ref = decision && byKey.get(decision.key);
      if (!decision || typeof decision.key !== 'string' || !decision.key || decision.key.length > 200 || keys.has(decision.key) ||
          typeof decision.line !== 'string' || !ref || ref.line !== decision.line || !ingredientActions.includes(decision.action)) {
        throw new StaleWeekIngredientSelectionError('Ingredient selection changed');
      }
      keys.add(decision.key);
    }

    const active = listGroceries(db, actor, household).filter(item => !item.completed);
    const prepared = new Map<string, ItemInput>();
    const conflicts: string[] = [];
    for (const decision of decisions) {
      if (decision.action === 'skip') continue;
      let value: ItemInput;
      try { value = validate({ name: decision.name, quantity: decision.quantity, unit: decision.unit }); }
      catch { throw new WeekIngredientValidationError('Invalid grocery item'); }
      if (decision.action === 'add' && active.some(item => probableGroceryMatch(value.name, item.name))) conflicts.push(decision.key);
      prepared.set(decision.key, value);
    }
    if (conflicts.length) throw new WeekIngredientConflictError(conflicts);

    let added = 0, skipped = 0;
    for (const decision of decisions) {
      if (decision.action === 'skip') { skipped++; continue; }
      insertGrocery(db, actor, household, prepared.get(decision.key)!);
      added++;
    }
    db.prepare('INSERT INTO grocery_week_confirmation (id, household_id, actor_id, confirmation_key, week_start, week_end, added, skipped, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(randomUUID(), household, actor, confirmationKey, start, end, added, skipped, new Date().toISOString());
    return { added, skipped, replayed: false };
  }).immediate();
}

/**
 * Revalidates an already reviewed bulk list and inserts the accepted rows in one
 * immediate transaction. The submitted names, quantities and units are ordinary
 * grocery input and remain untrusted, so they get the same validation as the
 * individual add form. A row that matches an active item, or another accepted row,
 * rejects the whole batch instead of combining or overwriting it.
 */
export function addBulkGroceries(db: Database.Database, actor: string, household: string, decisions: BulkDecision[]): { added: number; skipped: number } {
  return db.transaction(() => {
    authorize(db, actor, household);
    if (!Array.isArray(decisions) || !decisions.length || decisions.length > MAX_BULK_LINES) throw new BulkValidationError('Choose 1 to 30 items');

    const keys = new Set<string>();
    const prepared: Array<{ key: string; action: 'add' | 'skip'; value: ItemInput | null }> = [];
    for (const decision of decisions) {
      if (!decision || typeof decision !== 'object' ||
          typeof decision.key !== 'string' || !decision.key || decision.key.length > 100 || keys.has(decision.key) ||
          typeof decision.line !== 'string' || decision.line.length > MAX_BULK_INPUT_CHARS ||
          !bulkActions.includes(decision.action) ||
          typeof decision.name !== 'string' || typeof decision.quantity !== 'string' || typeof decision.unit !== 'string') {
        throw new BulkValidationError('Invalid bulk item');
      }
      keys.add(decision.key);
      if (decision.action === 'skip') {
        prepared.push({ key: decision.key, action: 'skip', value: null });
        continue;
      }
      try {
        prepared.push({
          key: decision.key,
          action: decision.action,
          value: validate({ name: decision.name, quantity: decision.quantity, unit: decision.unit })
        });
      } catch (err) {
        if (err instanceof IngredientValidationError) throw new BulkValidationError('Invalid grocery item');
        throw err;
      }
    }

    const active = groceryItems(db, household).filter(item => !item.completed);
    const accepted: ItemInput[] = [];
    const conflicts: string[] = [];
    for (const entry of prepared) {
      if (entry.action === 'skip' || !entry.value) continue;
      if (active.some(item => probableGroceryMatch(entry.value!.name, item.name)) ||
          accepted.some(item => probableGroceryMatch(entry.value!.name, item.name))) {
        conflicts.push(entry.key);
        continue;
      }
      accepted.push(entry.value);
    }
    if (conflicts.length) throw new BulkConflictError(conflicts);

    for (const value of accepted) insertGrocery(db, actor, household, value);
    return { added: accepted.length, skipped: prepared.length - accepted.length };
  }).immediate();
}
