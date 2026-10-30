import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { localDate } from '../../lib/chores/recurrence';
import { displayData } from '../../lib/server/display';
import { getIdentityServices } from '../../lib/server/runtime';

async function principal(request: Request) {
  let services;
  try { services = getIdentityServices(); } catch { error(503, 'Identity service unavailable'); }
  const session = await services.auth.api.getSession({ headers: request.headers });
  if (!session) redirect(303, '/sign-in');
  const member = services.db.prepare('SELECT household_id AS householdId FROM membership WHERE user_id = ? ORDER BY household_id LIMIT 1').get(session.user.id) as { householdId: string } | undefined;
  if (!member) error(403, 'No household access');
  return { ...services, actor: session.user.id, household: member.householdId };
}

export const load: PageServerLoad = async ({ request }) => {
  const { db, actor, household } = await principal(request);
  const settings = db.prepare('SELECT timezone FROM household_settings WHERE household_id = ?').get(household) as { timezone: string } | undefined;
  const timezone = settings?.timezone ?? 'America/Chicago';
  const today = localDate(new Date(), timezone);
  const last = new Date(`${today}T00:00:00Z`); last.setUTCDate(last.getUTCDate() + 7);
  const { choices, events, chores } = displayData(db, actor, household, today, last.toISOString().slice(0, 10));
  return { today, timezone, events, chores, canManage: choices !== null };
};
