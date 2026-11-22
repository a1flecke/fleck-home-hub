import { error, fail, redirect } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import type { Actions, PageServerLoad } from './$types';
import { localDate, occurrenceDates } from '../../../lib/chores/recurrence';
import { parseRecipeDetailsJson, type RecipeDetails } from '../../../lib/meals/recipe-details';
import { createMeal, MAX_RECENT_MEAL_QUERY, mealCopySource, normalizeMealDraft, recentMeals, type MealCopySource, type MealDraft, type MealInput } from '../../../lib/server/meals';
import { mealAccess } from '../../../lib/server/meal-access';

type CopyFields = { sourceId: string; title: string; date: string; time: string; servings: string; ingredients: string; source: string; recipeUrl: string; submissionKey: string; shared: boolean; recipeDetails: RecipeDetails | null };

function draftFrom(source: MealCopySource, date: string, submissionKey: string): MealDraft {
  return {
    title: source.title,
    date,
    time: source.time ?? '',
    servings: source.servings,
    ingredients: source.ingredients,
    source: source.source,
    recipeUrl: source.recipeUrl,
    recipeDetails: source.recipeDetails,
    shared: false,
    submissionKey
  };
}

function fields(form: FormData): CopyFields {
  return {
    sourceId: String(form.get('sourceId') ?? ''),
    title: String(form.get('title') ?? ''),
    date: String(form.get('date') ?? '').trim(),
    time: String(form.get('time') ?? ''),
    servings: String(form.get('servings') ?? ''),
    ingredients: String(form.get('ingredients') ?? ''),
    source: String(form.get('source') ?? ''),
    recipeUrl: String(form.get('recipeUrl') ?? ''),
    submissionKey: String(form.get('submissionKey') ?? ''),
    shared: form.has('shared'),
    recipeDetails: parseRecipeDetailsJson(String(form.get('recipeDetails') ?? ''))
  };
}

function inputFrom(value: CopyFields): MealInput {
  return {
    title: value.title,
    date: value.date,
    time: value.time,
    servings: value.servings ? Number(value.servings) : undefined,
    ingredients: value.ingredients,
    notes: '',
    source: value.source,
    recipeUrl: value.recipeUrl,
    recipeDetails: value.recipeDetails,
    shared: value.shared,
    submissionKey: value.submissionKey
  };
}

export const load: PageServerLoad = async ({ request, url }) => {
  const { db, actor, householdId, role } = await mealAccess(request);
  if (role !== 'parent') error(403, 'Only a parent can repeat a meal');
  const settings = db.prepare('SELECT timezone FROM household_settings WHERE household_id = ?').get(householdId) as { timezone: string } | undefined;
  const today = localDate(new Date(), settings?.timezone ?? 'America/Chicago');
  const query = (url.searchParams.get('q') ?? '').trim();
  if (query.length > MAX_RECENT_MEAL_QUERY) error(400, 'Meal search is too long');
  const sourceId = url.searchParams.get('source') ?? '';
  let draft: MealDraft | undefined;
  let sourceMissing = false;
  if (sourceId) {
    const requestedDate = url.searchParams.get('date') ?? today;
    try { occurrenceDates(requestedDate, requestedDate, [0]); } catch { error(400, 'Invalid meal date'); }
    try { draft = draftFrom(mealCopySource(db, actor, householdId, sourceId), requestedDate, randomUUID()); }
    catch { sourceMissing = true; }
  }
  return { role, today, query, sourceId, sourceMissing, draft, recent: recentMeals(db, actor, householdId, query), submissionKey: randomUUID() };
};

export const actions = {
  preview: async ({ request }) => {
    const { db, actor, householdId, origin, role } = await mealAccess(request);
    if (request.headers.get('origin') !== origin || role !== 'parent') return fail(403, { message: 'Request not authorized.' });
    const form = await request.formData(), value = fields(form);
    try { mealCopySource(db, actor, householdId, value.sourceId); }
    catch { return fail(400, { message: 'That meal is no longer available. Choose another recent meal.', copyError: value, gone: true }); }
    try { return { copyPreview: normalizeMealDraft(inputFrom(value)) }; }
    catch { return fail(400, { message: 'Check the meal name, date, ingredients and recipe link, then preview again.', copyError: value }); }
  },
  save: async ({ request }) => {
    const { db, actor, householdId, origin, role } = await mealAccess(request);
    if (request.headers.get('origin') !== origin || role !== 'parent') return fail(403, { message: 'Request not authorized.' });
    const form = await request.formData(), value = fields(form);
    try { mealCopySource(db, actor, householdId, value.sourceId); }
    catch { return fail(400, { message: 'That meal is no longer available. Nothing was saved. Choose another recent meal.', copyError: value, gone: true }); }
    try { createMeal(db, actor, householdId, inputFrom(value)); }
    catch { return fail(400, { message: 'Unable to save this plan. Check its date and details, then preview again.', copyError: value }); }
    redirect(303, `/meals?date=${encodeURIComponent(value.date)}`);
  }
} satisfies Actions;
