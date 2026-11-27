import { error, redirect } from '@sveltejs/kit';
import { getIdentityServices } from './runtime';

/**
 * Authorizes an active parent for household administration. Without `selected`, chooses the
 * caller's first active parent household ordered consistently by `(name, id)`. With `selected`,
 * requires an exact match among the caller's active parent households rather than falling back.
 */
export async function parentHouseholds(request: Request, selected: string | null = null) {
  let services;
  try { services = getIdentityServices(); } catch { error(503, 'Identity service unavailable'); }
  const session = await services.auth.api.getSession({ headers: request.headers });
  if (!session) redirect(303, '/sign-in');
  const households = services.db.prepare(`
    SELECT h.id, h.name FROM household h JOIN active_membership m ON m.household_id = h.id
    WHERE m.user_id = ? AND m.role = 'parent' ORDER BY h.name, h.id
  `).all(session.user.id) as { id: string; name: string }[];
  const household = selected === null
    ? households[0]
    : households.find(item => item.id === selected);
  if (!household) error(403, 'No household administration access');
  return { ...services, actor: session.user.id, household, households };
}

export async function parentHousehold(request: Request, selected: string | null = null) {
  return parentHouseholds(request, selected);
}
