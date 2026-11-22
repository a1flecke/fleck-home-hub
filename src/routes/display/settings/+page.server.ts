import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { localDate } from '../../../lib/chores/recurrence';
import { displayData, setDisplayVisibility } from '../../../lib/server/display';
import { getIdentityServices } from '../../../lib/server/runtime';

/**
 * Without ?household= this keeps the previous default: the caller's primary active membership,
 * which must be a parent one. With it, the household must be one the caller is an active parent
 * of; anything else is refused rather than replaced, so a form can never act on another household.
 */
async function principal(request: Request, url: URL) {
  let services;
  try { services = getIdentityServices(); } catch { error(503, 'Identity service unavailable'); }
  const session = await services.auth.api.getSession({ headers: request.headers });
  if (!session) redirect(303, '/sign-in');
  const households = services.db.prepare("SELECT household.id, household.name FROM household JOIN active_membership ON active_membership.household_id = household.id WHERE active_membership.user_id = ? AND active_membership.role = 'parent' ORDER BY household.name, household.id").all(session.user.id) as { id: string; name: string }[];
  const requested = url.searchParams.get('household');
  const primary = services.db.prepare('SELECT household_id AS householdId, role FROM active_membership WHERE user_id = ? ORDER BY household_id LIMIT 1').get(session.user.id) as { householdId: string; role: string } | undefined;
  const household = requested ?? (primary?.role === 'parent' ? primary.householdId : undefined);
  if (!household || !households.some(item => item.id === household)) error(403, 'Not authorized');
  return { ...services, actor: session.user.id, household, households };
}

export const load: PageServerLoad = async ({ request, url }) => {
  const { db, actor, household, households } = await principal(request, url);
  const settings = db.prepare('SELECT timezone FROM household_settings WHERE household_id = ?').get(household) as { timezone: string } | undefined;
  const today = localDate(new Date(), settings?.timezone ?? 'America/Chicago');
  const last = new Date(`${today}T00:00:00Z`); last.setUTCDate(last.getUTCDate() + 7);
  return { households, householdId: household, choices: displayData(db, actor, household, today, last.toISOString().slice(0, 10)).choices };
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
