import { error, redirect } from '@sveltejs/kit';
import { getIdentityServices } from './runtime';

export async function parentHousehold(request: Request, selected: string | null = null) {
  const services = getIdentityServices();
  const session = await services.auth.api.getSession({ headers: request.headers });
  if (!session) redirect(303, '/sign-in');
  const household = services.db.prepare(`
    SELECT h.id, h.name FROM household h JOIN active_membership m ON m.household_id = h.id
    WHERE m.user_id = ? AND m.role = 'parent' AND (? IS NULL OR h.id = ?) ORDER BY h.id LIMIT 1
  `).get(session.user.id, selected, selected) as { id: string; name: string } | undefined;
  if (!household) error(403, 'No household administration access');
  return { ...services, actor: session.user.id, household };
}
