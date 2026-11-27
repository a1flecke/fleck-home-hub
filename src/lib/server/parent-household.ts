import type Database from 'better-sqlite3';
import { error, redirect } from '@sveltejs/kit';
import { getIdentityServices } from './runtime';

/**
 * The households a user may administer, in the one order every parent route uses: by name, then
 * id. The first entry is the default when no household is requested, so a kid membership in
 * another household can never become, or block, the default.
 */
export function parentHouseholds(db: Database.Database, userId: string): { id: string; name: string }[] {
  return db.prepare(`
    SELECT h.id, h.name FROM household h JOIN active_membership m ON m.household_id = h.id
    WHERE m.user_id = ? AND m.role = 'parent' ORDER BY h.name, h.id
  `).all(userId) as { id: string; name: string }[];
}

export async function parentHousehold(request: Request, selected: string | null = null) {
  let services;
  try { services = getIdentityServices(); } catch { error(503, 'Identity service unavailable'); }
  const session = await services.auth.api.getSession({ headers: request.headers });
  if (!session) redirect(303, '/sign-in');
  const households = parentHouseholds(services.db, session.user.id);
  const household = selected === null ? households[0] : households.find(item => item.id === selected);
  if (!household) error(403, 'No household administration access');
  return { ...services, actor: session.user.id, household };
}
