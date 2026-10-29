import type { RequestHandler } from './$types';
import { getIdentityServices } from '../../../../../lib/server/runtime';
import { parentAction } from '../../../../../lib/server/identity';

export const POST: RequestHandler = async ({ request, params }) => {
  try {
    const { auth, db } = getIdentityServices();
    return await parentAction(auth, db, request, params.householdId);
  } catch {
    return new Response('Identity service unavailable', { status: 503 });
  }
};
