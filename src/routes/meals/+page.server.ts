import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { localDate } from '../../lib/chores/recurrence';
import { createMeal, listMeals, updateMeal, type MealInput } from '../../lib/server/meals';
import { addMealIngredients } from '../../lib/server/groceries';
import { getIdentityServices } from '../../lib/server/runtime';

async function principal(request: Request) {
  let services;
  try { services = getIdentityServices(); } catch { error(503, 'Identity service unavailable'); }
  const session = await services.auth.api.getSession({ headers: request.headers });
  if (!session) redirect(303, '/sign-in');
  const member = services.db.prepare('SELECT household_id AS householdId, role FROM membership WHERE user_id = ? ORDER BY household_id LIMIT 1').get(session.user.id) as { householdId: string; role: 'parent' | 'kid' } | undefined;
  if (!member) error(403, 'No household access');
  return { ...services, actor: session.user.id, ...member };
}

export const load: PageServerLoad = async ({ request, url }) => {
  const { db, actor, householdId, role } = await principal(request);
  const settings = db.prepare('SELECT timezone FROM household_settings WHERE household_id = ?').get(householdId) as { timezone: string } | undefined;
  const date = url.searchParams.get('date') || localDate(new Date(), settings?.timezone ?? 'America/Chicago');
  try { return { date, role, meals: listMeals(db, actor, householdId, date) }; } catch { error(400, 'Invalid meal date'); }
};

export const actions = {
  save: async ({ request }) => {
    const { db, actor, householdId, origin, role } = await principal(request);
    if (request.headers.get('origin') !== origin || role !== 'parent') return fail(403, { message: 'Request not authorized.' });
    const form = await request.formData();
    const raw = { id: String(form.get('id') ?? ''), title: String(form.get('title') ?? ''), date: String(form.get('date') ?? ''), time: String(form.get('time') ?? ''), servings: String(form.get('servings') ?? ''), ingredients: String(form.get('ingredients') ?? ''), notes: String(form.get('notes') ?? ''), source: String(form.get('source') ?? ''), recipeUrl: String(form.get('recipeUrl') ?? ''), shared: form.has('shared') };
    const input: MealInput = { ...raw, servings: raw.servings ? Number(raw.servings) : undefined };
    try { if (raw.id) updateMeal(db, actor, householdId, raw.id, input); else createMeal(db, actor, householdId, input); }
    catch { return fail(400, { message: 'Unable to save meal. Check its details and use an HTTPS recipe link.', mealError: raw }); }
    redirect(303, `/meals?date=${encodeURIComponent(raw.date)}`);
  },
  ingredients: async ({ request }) => {
    const { db, actor, householdId, origin, role } = await principal(request);
    if (request.headers.get('origin') !== origin || role !== 'parent') return fail(403, { message: 'Request not authorized.' });
    const form = await request.formData(), id = String(form.get('id') ?? ''), selections = form.getAll('ingredient').map(String);
    try { addMealIngredients(db, actor, householdId, id, selections, form.get('allowDuplicate') === 'yes'); }
    catch (err) { return fail(400, { message: err instanceof Error && err.message === 'Item already on list' ? 'A matching ingredient is already on the list. Confirm if you want another.' : 'Choose ingredients to add.', ingredientError: { id, selections, duplicate: err instanceof Error && err.message === 'Item already on list' } }); }
    redirect(303, '/groceries');
  }
} satisfies Actions;
