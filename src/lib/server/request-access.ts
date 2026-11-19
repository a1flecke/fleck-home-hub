import { getIdentityServices } from './runtime';
import type { createAuth } from './identity';

type Auth = ReturnType<typeof createAuth>;
type Session = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>;

export type RequestAccess =
  | { status: 'unavailable' }
  | { status: 'anonymous' }
  | { status: 'forbidden' }
  | {
      status: 'member';
      db: ReturnType<typeof getIdentityServices>['db'];
      auth: Auth;
      origin: string;
      session: Session;
      userId: string;
      name: string;
      householdId: string;
      role: 'parent' | 'kid';
    };

/**
 * Resolve the caller's session and primary active household for a page request.
 * Routes translate the result into their own redirect or HTTP error response.
 */
export async function requestAccess(request: Request): Promise<RequestAccess> {
  let services: ReturnType<typeof getIdentityServices>;
  try { services = getIdentityServices(); } catch { return { status: 'unavailable' }; }
  const session = await services.auth.api.getSession({ headers: request.headers });
  if (!session) return { status: 'anonymous' };
  const membership = services.db.prepare('SELECT household_id AS householdId, role FROM active_membership WHERE user_id = ? ORDER BY household_id LIMIT 1').get(session.user.id) as { householdId: string; role: 'parent' | 'kid' } | undefined;
  if (!membership) return { status: 'forbidden' };
  return { status: 'member', ...services, session, userId: session.user.id, name: session.user.name, ...membership };
}
