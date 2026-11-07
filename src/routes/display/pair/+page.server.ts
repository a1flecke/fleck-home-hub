import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { DisplayPairingError, createFailureLimiter, redeemPairing } from '../../../lib/server/display-pairing';
import { displayCookieName, displayCookieOptions } from '../../../lib/server/display-session';
import { getIdentityServices } from '../../../lib/server/runtime';

// Process-wide: unauthenticated callers cannot be told apart without trusting proxy headers.
const failures = createFailureLimiter(10, 60_000);

function services() {
  try { return getIdentityServices(); } catch { error(503, 'Identity service unavailable'); }
}

/** A device that is signed in as a person must end that session before it can become a display. */
async function hasMemberSession(request: Request) {
  const { auth } = services();
  return (await auth.api.getSession({ headers: request.headers })) !== null;
}

export const load: PageServerLoad = async ({ request }) => ({ signedIn: await hasMemberSession(request) });

export const actions = {
  default: async ({ request, cookies }) => {
    const { db, origin } = services();
    if (request.headers.get('origin') !== origin) return fail(403, { signedIn: false, message: 'Request not authorized.' });
    if (await hasMemberSession(request)) return fail(409, { signedIn: true, message: 'Sign out of this account before pairing it as a display.' });
    if (failures.blocked()) return fail(429, { signedIn: false, message: 'Too many attempts. Wait a minute and try again.' });
    const code = String((await request.formData()).get('code') ?? '').slice(0, 64);
    try {
      const device = redeemPairing(db, code);
      cookies.set(displayCookieName(origin), device.token, displayCookieOptions(origin, device.expiresAt));
    } catch (cause) {
      if (!(cause instanceof DisplayPairingError)) throw cause;
      failures.failure();
      // One message for every failure; the submitted code is never echoed back.
      return fail(400, { signedIn: false, message: 'That pairing code is not valid. Ask a parent for a new one.' });
    }
    redirect(303, '/display');
  }
} satisfies Actions;
