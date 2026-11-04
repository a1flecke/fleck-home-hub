import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { occurrenceDates } from '../chores/recurrence';

export type MealInput = { title: string; date: string; time?: string; servings?: number; ingredients: string; notes?: string; source?: string; recipeUrl?: string; shared: boolean; submissionKey?: string };
export type Meal = { id: string; title: string; date: string; time: string | null; servings: number | null; ingredients: string; notes: string | null; source: string | null; recipeUrl: string | null; shared: boolean };

function authorize(db: Database.Database, actor: string, household: string, parent = false) {
  const member = db.prepare('SELECT role FROM membership WHERE user_id = ? AND household_id = ?').get(actor, household) as { role: string } | undefined;
  if (!member || (parent && member.role !== 'parent')) throw new Error('Not authorized');
  return member.role;
}

function validate(input: MealInput) {
  const title = input.title.trim(), ingredients = input.ingredients.trim(), notes = input.notes?.trim() || null, source = input.source?.trim() || null, recipeUrl = input.recipeUrl?.trim() || null, submissionKey = input.submissionKey?.trim() || null;
  occurrenceDates(input.date, input.date, [0]);
  if (!title || title.length > 120 || ingredients.length > 5000 || (notes && notes.length > 1000) || (source && source.length > 120) || (submissionKey && submissionKey.length > 100) || (input.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) || (input.servings !== undefined && (!Number.isInteger(input.servings) || input.servings < 1 || input.servings > 100))) throw new Error('Invalid meal');
  if (recipeUrl) {
    let url: URL;
    try { url = new URL(recipeUrl); } catch { throw new Error('Invalid recipe URL'); }
    if (url.protocol !== 'https:' || url.username || url.password || recipeUrl.length > 2048) throw new Error('Invalid recipe URL');
  }
  return { title, ingredients, notes, source, recipeUrl, submissionKey };
}

export function createMeal(db: Database.Database, actor: string, household: string, input: MealInput): string {
  authorize(db, actor, household, true);
  const value = validate(input);
  return db.transaction(() => {
    if (value.submissionKey) {
      const existing = db.prepare('SELECT id FROM meal WHERE household_id = ? AND submission_key = ?').get(household, value.submissionKey) as { id: string } | undefined;
      if (existing) return existing.id;
    }
    const id = randomUUID(), now = new Date().toISOString();
    try {
      db.prepare('INSERT INTO meal (id, household_id, title, meal_date, meal_time, servings, ingredients, notes, source, recipe_url, submission_key, shared, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, household, value.title, input.date, input.time || null, input.servings ?? null, value.ingredients, value.notes, value.source, value.recipeUrl, value.submissionKey, Number(input.shared), now, now);
    } catch (error) {
      if (value.submissionKey) {
        const existing = db.prepare('SELECT id FROM meal WHERE household_id = ? AND submission_key = ?').get(household, value.submissionKey) as { id: string } | undefined;
        if (existing) return existing.id;
      }
      throw error;
    }
    return id;
  }).immediate();
}

export function updateMeal(db: Database.Database, actor: string, household: string, id: string, input: MealInput): void {
  authorize(db, actor, household, true); const value = validate(input);
  if (!db.prepare('UPDATE meal SET title = ?, meal_date = ?, meal_time = ?, servings = ?, ingredients = ?, notes = ?, source = ?, recipe_url = ?, shared = ?, updated_at = ? WHERE id = ? AND household_id = ?').run(value.title, input.date, input.time || null, input.servings ?? null, value.ingredients, value.notes, value.source, value.recipeUrl, Number(input.shared), new Date().toISOString(), id, household).changes) throw new Error('Meal not found');
}

export function listMeals(db: Database.Database, actor: string, household: string, date: string): Meal[] {
  const role = authorize(db, actor, household); occurrenceDates(date, date, [0]);
  const rows = db.prepare('SELECT id, title, meal_date AS date, meal_time AS time, servings, ingredients, notes, source, recipe_url AS recipeUrl, shared FROM meal WHERE household_id = ? AND meal_date = ? ORDER BY meal_time, title, id').all(household, date) as (Omit<Meal, 'shared'> & { shared: number })[];
  return rows.filter(row => role === 'parent' || row.shared).map(row => ({ ...row, notes: role === 'parent' ? row.notes : null, shared: !!row.shared }));
}
