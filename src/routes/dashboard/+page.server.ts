import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getIdentityServices } from '../../lib/server/runtime';

export const load: PageServerLoad = async ({ request }) => {
  let services;
  try { services = getIdentityServices(); } catch { return error(503, 'Identity service unavailable'); }
  const session = await services.auth.api.getSession({ headers: request.headers });
  if (!session) redirect(303, '/sign-in');
  const membership = services.db.prepare('SELECT household_id AS householdId, role FROM membership WHERE user_id = ? ORDER BY household_id LIMIT 1').get(session.user.id) as { householdId: string; role: 'parent' | 'kid' } | undefined;
  if (!membership) return error(403, 'No household access');
  return { name: session.user.name, ...membership };
};
