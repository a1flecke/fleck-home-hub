import type { RequestHandler } from './$types';
import { getIdentityServices } from '../../../../../lib/server/runtime';
import { parentAction } from '../../../../../lib/server/identity';

export const POST: RequestHandler = async ({ request, params }) => {
  try {
    const { auth, db, origin } = getIdentityServices();
    return await parentAction(auth, db, request, params.householdId, origin);
  } catch {
    return new Response('Identity service unavailable', { status: 503 });
  }
};
