import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listGroceries } from '../../../lib/server/groceries';
import { getIdentityServices } from '../../../lib/server/runtime';

const noStore = { 'cache-control': 'no-store' };

export const GET: RequestHandler = async ({ request }) => {
  try {
    let services;
    try { services = getIdentityServices(); } catch { return json({ error: 'unavailable' }, { status: 503, headers: noStore }); }

    const session = await services.auth.api.getSession({ headers: request.headers });
    if (!session) return json({ error: 'unauthenticated' }, { status: 401, headers: noStore });

    const member = services.db.prepare('SELECT household_id AS householdId FROM active_membership WHERE user_id = ? ORDER BY household_id LIMIT 1').get(session.user.id) as { householdId: string } | undefined;
    if (!member) return json({ error: 'forbidden' }, { status: 403, headers: noStore });

    return json({ items: listGroceries(services.db, session.user.id, member.householdId) }, { headers: noStore });
  } catch (error) {
    // A membership race is still an authorization result. Anything else is a temporary
    // service failure and must keep the client retrying rather than hiding protected data.
    if (error instanceof Error && error.message === 'Not authorized') return json({ error: 'forbidden' }, { status: 403, headers: noStore });
    return json({ error: 'unavailable' }, { status: 503, headers: noStore });
  }
};
