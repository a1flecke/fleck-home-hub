import { error, fail, redirect } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import type { Actions, PageServerLoad } from './$types';
import { localDate, occurrenceDates } from '../../../lib/chores/recurrence';
import { ingredientLines } from '../../../lib/grocery/domain';
import { ingredientActions, type IngredientAction, type IngredientDecision, type IngredientReviewOverrides } from '../../../lib/grocery/handoff';
import { mealDayLabel, mealWeekLabel, shiftWeek, weekDates, weekStart } from '../../../lib/meals/week';
import { confirmWeekIngredients, MAX_WEEK_INGREDIENT_LINES, reviewWeekIngredients, StaleWeekIngredientSelectionError, WeekIngredientConflictError, WeekIngredientValidationError } from '../../../lib/server/groceries';
import { mealAccess } from '../../../lib/server/meal-access';
import { listMealWeek } from '../../../lib/server/meals';

function weekStartFrom(value: string | null, fallback: string): string {
  if (!value) return weekStart(fallback);
  occurrenceDates(value, value, [0]);
  return weekStart(value);
}

export const load: PageServerLoad = async ({ request, url }) => {
  const { db, actor, householdId, role } = await mealAccess(request);
  if (role !== 'parent') error(403, 'Only a parent can shop the week');
  const settings = db.prepare('SELECT timezone FROM household_settings WHERE household_id = ?').get(householdId) as { timezone: string } | undefined;
  const today = localDate(new Date(), settings?.timezone ?? 'America/Chicago');
  let start: string;
  try { start = weekStartFrom(url.searchParams.get('week') ?? url.searchParams.get('date'), today); }
  catch { error(400, 'Invalid meal week'); }
  const days = weekDates(start);
  const meals = listMealWeek(db, actor, householdId, days[0], days[6]);
  const selectionDays = days.map(date => ({
    date,
    label: mealDayLabel(date),
    meals: meals.filter(meal => meal.date === date).map(meal => ({
      id: meal.id,
      title: meal.title,
      time: meal.time,
      familyLines: ingredientLines(meal.ingredients),
      groups: meal.recipeDetails?.groups ?? []
    }))
  }));
  return {
    today,
    role,
    weekStart: start,
    weekLabel: mealWeekLabel(start),
    previousWeek: shiftWeek(start, -1),
    nextWeek: shiftWeek(start, 1),
    currentWeek: weekStart(today),
    mealCount: meals.length,
    hasIngredients: selectionDays.some(day => day.meals.some(meal => meal.familyLines.length || meal.groups.length)),
    days: selectionDays,
    confirmationKey: randomUUID()
  };
};

function decisionsFrom(form: FormData): IngredientDecision[] | null {
  const rowCount = Number(form.get('rowCount'));
  if (!Number.isInteger(rowCount) || rowCount < 1 || rowCount > MAX_WEEK_INGREDIENT_LINES) return null;
  const decisions: IngredientDecision[] = [];
  for (let index = 0; index < rowCount; index += 1) {
    const action = String(form.get(`action-${index}`) ?? '');
    if (!ingredientActions.includes(action as IngredientAction)) return null;
    decisions.push({
      key: String(form.get(`key-${index}`) ?? ''),
      line: String(form.get(`line-${index}`) ?? ''),
      action: action as IngredientAction,
      name: String(form.get(`name-${index}`) ?? ''),
      quantity: String(form.get(`quantity-${index}`) ?? ''),
      unit: String(form.get(`unit-${index}`) ?? '')
    });
  }
  return decisions;
}

function overridesFrom(decisions: IngredientDecision[]): IngredientReviewOverrides {
  return Object.fromEntries(decisions.map(decision => [decision.key, {
    action: decision.action,
    name: decision.name,
    quantity: decision.quantity,
    unit: decision.unit
  }]));
}

function isUnauthorized(err: unknown): boolean {
  return err instanceof Error && err.message === 'Not authorized';
}

export const actions = {
  review: async ({ request }) => {
    const { db, actor, householdId, origin, role } = await mealAccess(request);
    if (request.headers.get('origin') !== origin || role !== 'parent') return fail(403, { message: 'Request not authorized.' });
    const form = await request.formData(), selections = form.getAll('ingredient').map(String).filter(Boolean);
    let start: string;
    try { start = weekStartFrom(String(form.get('week') ?? ''), localDate(new Date(), 'America/Chicago')); } catch { return fail(400, { message: 'Choose a valid meal week.' }); }
    try { return { review: reviewWeekIngredients(db, actor, householdId, start, weekDates(start)[6], selections), weekStart: start, confirmationKey: randomUUID() }; }
    catch (err) {
      if (isUnauthorized(err)) return fail(403, { message: 'Request not authorized.' });
      if (err instanceof StaleWeekIngredientSelectionError) return fail(400, { message: 'The meals changed. Select the ingredients again.', selections, weekStart: start });
      return fail(400, { message: 'Choose at least one ingredient from the week, then review again.', selections, weekStart: start });
    }
  },
  confirm: async ({ request }) => {
    const { db, actor, householdId, origin, role } = await mealAccess(request);
    if (request.headers.get('origin') !== origin || role !== 'parent') return fail(403, { message: 'Request not authorized.' });
    const form = await request.formData();
    let start: string;
    try { start = weekStartFrom(String(form.get('week') ?? ''), localDate(new Date(), 'America/Chicago')); } catch { return fail(400, { message: 'Choose a valid meal week.' }); }
    const end = weekDates(start)[6], confirmationKey = String(form.get('confirmationKey') ?? ''), decisions = decisionsFrom(form);
    if (!decisions || !confirmationKey) return fail(400, { message: 'The reviewed ingredients were not valid. Choose them again.', weekStart: start });

    let result: { added: number; skipped: number; replayed: boolean };
    try {
      result = confirmWeekIngredients(db, actor, householdId, start, end, decisions, confirmationKey);
    } catch (err) {
      if (isUnauthorized(err)) return fail(403, { message: 'Request not authorized.' });
      if (err instanceof WeekIngredientConflictError) {
        try {
          const review = reviewWeekIngredients(db, actor, householdId, start, end, decisions.map(decision => decision.key), overridesFrom(decisions));
          return fail(409, { message: 'The grocery list changed. An item now matches the list. Nothing was added. Choose Keep separate duplicate or Skip, then confirm again.', review, weekStart: start, confirmationKey });
        } catch { return fail(409, { message: 'The grocery list changed. Nothing was added. Refresh and choose the ingredients again.', weekStart: start }); }
      }
      if (err instanceof WeekIngredientValidationError) {
        try {
          const review = reviewWeekIngredients(db, actor, householdId, start, end, decisions.map(decision => decision.key), overridesFrom(decisions));
          return fail(400, { message: 'Check each item name, quantity and unit, then confirm again.', review, weekStart: start, confirmationKey });
        } catch { return fail(400, { message: 'Check each item name, quantity and unit.', weekStart: start }); }
      }
      if (err instanceof StaleWeekIngredientSelectionError) {
        return fail(400, { message: 'The meals changed. Select the ingredients again.', selections: decisions.map(decision => decision.key), weekStart: start });
      }
      return fail(400, { message: 'Unable to add the reviewed ingredients. Choose them again.', weekStart: start });
    }
    redirect(303, `/groceries?added=${result.added}&skipped=${result.skipped}`);
  }
} satisfies Actions;
