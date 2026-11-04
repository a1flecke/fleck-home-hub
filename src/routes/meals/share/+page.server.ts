import { fail, redirect } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import type { Actions, PageServerLoad } from './$types';
import { localDate } from '../../../lib/chores/recurrence';
import { cleanRecipeTitle, firstHttpsRecipeLink, parseRecipeLink } from '../../../lib/meals/recipe-link';
import { mealAccess } from '../../../lib/server/meal-access';

export const load: PageServerLoad = async ({ request }) => {
  const { role } = await mealAccess(request);
  if (role !== 'parent') redirect(303, '/meals');
  return {};
};

function readableTitle(value: string): string {
  return cleanRecipeTitle(value).slice(0, 120);
}

export const actions = {
  default: async ({ request }) => {
    const { db, householdId, role, origin } = await mealAccess(request);
    const requestOrigin = request.headers.get('origin');
    if (requestOrigin && requestOrigin !== 'null' && requestOrigin !== origin) return fail(403, { message: 'Request not authorized.' });
    if (role !== 'parent') return fail(403, { message: 'Only a parent can add a meal from a shared link.' });

    const form = await request.formData();
    const sharedText = String(form.get('text') ?? '').trim();
    const suppliedTitle = readableTitle(String(form.get('title') ?? ''));
    const recipeUrl = firstHttpsRecipeLink(String(form.get('url') ?? '')) ?? firstHttpsRecipeLink(sharedText);
    const link = parseRecipeLink(recipeUrl);
    if (!link) return fail(400, { message: 'This share did not include a valid HTTPS recipe link. Paste one below.', sharedText, sharedTitle: suppliedTitle });

    const settings = db.prepare('SELECT timezone FROM household_settings WHERE household_id = ?').get(householdId) as { timezone: string } | undefined;
    const date = localDate(new Date(), settings?.timezone ?? 'America/Chicago');
    const title = suppliedTitle.length >= 2 && suppliedTitle !== link.url ? suppliedTitle : link.suggestedTitle ?? '';
    return { recipeDraft: { recipeUrl: link.url, title, date, submissionKey: randomUUID(), mode: 'recipeLink' } };
  }
} satisfies Actions;
