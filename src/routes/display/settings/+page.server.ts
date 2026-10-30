import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { localDate } from '../../../lib/chores/recurrence';
import { displayData, setDisplayVisibility } from '../../../lib/server/display';
import { getIdentityServices } from '../../../lib/server/runtime';

async function principal(request: Request) {
  let services;
  try { services = getIdentityServices(); } catch { error(503, 'Identity service unavailable'); }
  const session = await services.auth.api.getSession({ headers: request.headers });
  if (!session) redirect(303, '/sign-in');
  const member = services.db.prepare('SELECT household_id AS householdId, role FROM membership WHERE user_id = ? ORDER BY household_id LIMIT 1').get(session.user.id) as { householdId: string; role: string } | undefined;
  if (!member || member.role !== 'parent') error(403, 'Not authorized');
  return { ...services, actor: session.user.id, household: member.householdId };
}

export const load: PageServerLoad = async ({ request }) => {
  const { db, actor, household } = await principal(request);
  const settings = db.prepare('SELECT timezone FROM household_settings WHERE household_id = ?').get(household) as { timezone: string } | undefined;
  const today = localDate(new Date(), settings?.timezone ?? 'America/Chicago');
  const last = new Date(`${today}T00:00:00Z`); last.setUTCDate(last.getUTCDate() + 7);
  return { choices: displayData(db, actor, household, today, last.toISOString().slice(0, 10)).choices };
};

export const actions = {
  share: async ({ request }) => {
    const { db, actor, household, origin } = await principal(request);
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
