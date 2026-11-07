import { error, redirect } from '@sveltejs/kit';
import { getIdentityServices } from './runtime';

/** Resolves the signed-in household member for meal routes without exposing another household. */
export async function mealAccess(request: Request) {
  let services;
  try { services = getIdentityServices(); } catch { error(503, 'Identity service unavailable'); }
  const session = await services.auth.api.getSession({ headers: request.headers });
  if (!session) redirect(303, '/sign-in');
  const member = services.db.prepare('SELECT household_id AS householdId, role FROM active_membership WHERE user_id = ? ORDER BY household_id LIMIT 1').get(session.user.id) as { householdId: string; role: 'parent' | 'kid' } | undefined;
  if (!member) error(403, 'No household access');
  return { ...services, actor: session.user.id, ...member };
}
