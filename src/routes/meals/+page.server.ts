import { error, fail, redirect } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import type { Actions, PageServerLoad } from './$types';
import { localDate, occurrenceDates } from '../../lib/chores/recurrence';
import { parseRecipeDetailsJson, type RecipeDetails } from '../../lib/meals/recipe-details';
import { parseRecipeLink } from '../../lib/meals/recipe-link';
import { createMeal, listMeals, updateMeal, type MealInput } from '../../lib/server/meals';
import { addMealIngredients } from '../../lib/server/groceries';
import { mealAccess } from '../../lib/server/meal-access';
import { previewRecipe } from '../../lib/server/recipe-preview';

const principal = mealAccess;

type DraftInput = { id: string; title: string; date: string; time: string; servings: string; ingredients: string; notes: string; source: string; recipeUrl: string; submissionKey: string; suggestedTitle: string; mode: string; shared: boolean; recipeDetails: RecipeDetails | null };

function draftFrom(raw: DraftInput, recipeDetails: RecipeDetails | null) {
  return { recipeUrl: raw.recipeUrl, title: raw.title, date: raw.date, time: raw.time, servings: raw.servings, ingredients: raw.ingredients, notes: raw.notes, source: raw.source, shared: raw.shared, submissionKey: raw.submissionKey || randomUUID(), suggestedTitle: raw.suggestedTitle, mode: 'recipeLink', recipeDetails };
}

export const load: PageServerLoad = async ({ request, url }) => {
  const { db, actor, householdId, role } = await principal(request);
  const settings = db.prepare('SELECT timezone FROM household_settings WHERE household_id = ?').get(householdId) as { timezone: string } | undefined;
  const date = url.searchParams.get('date') || localDate(new Date(), settings?.timezone ?? 'America/Chicago');
  try { return { date, role, meals: listMeals(db, actor, householdId, date), submissionKey: randomUUID() }; } catch { error(400, 'Invalid meal date'); }
};

export const actions = {
  draft: async ({ request }) => {
    const { origin, role } = await principal(request);
    if (request.headers.get('origin') !== origin || role !== 'parent') return fail(403, { message: 'Request not authorized.' });
    const form = await request.formData();
    const recipeUrl = String(form.get('recipeUrl') ?? '').trim(), date = String(form.get('date') ?? '').trim();
    const recipeLinkError = { recipeUrl };
    const link = parseRecipeLink(recipeUrl);
    if (!link) return fail(400, { message: 'Enter a valid HTTPS recipe link, then review the draft.', recipeLinkError });
    try { if (occurrenceDates(date, date, [0, 1, 2, 3, 4, 5, 6]).length !== 1) throw new Error('Invalid date'); } catch { return fail(400, { message: 'Choose a valid dinner date, then review the draft.', recipeLinkError }); }
    return { recipeDraft: { recipeUrl: link.url, title: link.suggestedTitle ?? '', date, submissionKey: randomUUID(), suggestedTitle: link.suggestedTitle ?? '', mode: 'recipeLink', recipeDetails: null } };
  },
  save: async ({ request, fetch }) => {
    const { db, actor, householdId, origin, role } = await principal(request);
    if (request.headers.get('origin') !== origin || role !== 'parent') return fail(403, { message: 'Request not authorized.' });
    const form = await request.formData();
    const raw: DraftInput = { id: String(form.get('id') ?? ''), title: String(form.get('title') ?? ''), date: String(form.get('date') ?? ''), time: String(form.get('time') ?? ''), servings: String(form.get('servings') ?? ''), ingredients: String(form.get('ingredients') ?? ''), notes: String(form.get('notes') ?? ''), source: String(form.get('source') ?? ''), recipeUrl: String(form.get('recipeUrl') ?? ''), submissionKey: String(form.get('submissionKey') ?? ''), suggestedTitle: String(form.get('suggestedTitle') ?? ''), mode: String(form.get('mode') ?? ''), shared: form.has('shared'), recipeDetails: parseRecipeDetailsJson(String(form.get('recipeDetails') ?? '')) };
    if (String(form.get('intent') ?? 'save') === 'preview') {
      const link = parseRecipeLink(raw.recipeUrl);
      const existing = link && link.provider?.id === 'emeals' && raw.recipeDetails?.sourceUrl === link.url ? raw.recipeDetails : null;
      if (!link || link.provider?.id !== 'emeals') return { message: 'Recipe details can only be previewed from an eMeals link. You can still save this meal.', recipeDraft: draftFrom(raw, null) };
      const preview = await previewRecipe(link.url, fetch);
      if (preview.status !== 'ok') return { message: 'Could not read recipe details from eMeals. You can still save the link-only meal.', recipeDraft: draftFrom(raw, existing) };
      const current = raw.title.trim(), suggested = raw.suggestedTitle.trim(), providerTitle = preview.details.title ?? '';
      const useProviderTitle = !current || (!!suggested && current === suggested);
      const title = useProviderTitle ? providerTitle || current : current;
      const nextSuggested = useProviderTitle && providerTitle ? providerTitle : raw.suggestedTitle;
      return { message: 'Recipe details loaded from eMeals. Review and save when ready.', recipeDraft: { ...draftFrom({ ...raw, title }, preview.details), suggestedTitle: nextSuggested } };
    }
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
