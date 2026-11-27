import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { localDate } from '../../../lib/chores/recurrence';
import { displayChoices, setDisplayVisibility } from '../../../lib/server/display';
import { parentHouseholds } from '../../../lib/server/parent-household';

async function principal(request: Request, url: URL) {
  const { household, ...rest } = await parentHouseholds(request, url.searchParams.get('household'));
  return { ...rest, household: household.id };
}

export const load: PageServerLoad = async ({ request, url }) => {
  const { db, actor, household, households } = await principal(request, url);
  const settings = db.prepare('SELECT timezone FROM household_settings WHERE household_id = ?').get(household) as { timezone: string } | undefined;
  const today = localDate(new Date(), settings?.timezone ?? 'America/Chicago');
  const last = new Date(`${today}T00:00:00Z`); last.setUTCDate(last.getUTCDate() + 7);
  const end = last.toISOString().slice(0, 10);
  const raw = url.searchParams.get('sharedPage') ?? '1';
  const page = /^\d{1,6}$/.test(raw) ? Number(raw) : 1;
  return { households, householdId: household, today, end, choices: displayChoices(db, actor, household, today, end, page) };
};

export const actions = {
  share: async ({ request, url }) => {
    const { db, actor, household, origin } = await principal(request, url);
    if (request.headers.get('origin') !== origin) return fail(403, { message: 'Request not authorized.' });
    const form = await request.formData();
    const kind = String(form.get('kind'));
    const visible = String(form.get('visible'));
    if ((kind !== 'event' && kind !== 'chore') || (visible !== 'yes' && visible !== 'no')) return fail(400, { message: 'Invalid selection.' });
    try { setDisplayVisibility(db, actor, household, kind, String(form.get('id') ?? ''), visible === 'yes'); }
    catch { return fail(403, { message: 'Unable to change display visibility.' }); }
    return { message: 'Display updated.' };
  }
} satisfies Actions;
