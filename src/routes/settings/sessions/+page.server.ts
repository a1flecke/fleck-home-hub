import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getIdentityServices } from '../../../lib/server/runtime';
import { SessionManagementError, listAccountSessions, revokeAccountSession, revokeOtherAccountSessions } from '../../../lib/server/sessions';

function services() { return getIdentityServices(); }
const failure = (error: unknown) => {
  if (error instanceof SessionManagementError && error.code === 'signed-out') redirect(303, '/sign-in');
  if (error instanceof SessionManagementError && error.code === 'reauthenticate') return fail(403, { message: 'For your security, sign in again before managing sessions.' });
  return fail(400, { message: 'That could not be completed. Reload and try again.' });
};

export const load: PageServerLoad = async ({ request }) => {
  const { auth } = services();
  try { return { sessions: await listAccountSessions(auth, request.headers), reauthenticate: false }; }
  catch (error) {
    if (error instanceof SessionManagementError && error.code === 'reauthenticate') return { sessions: [], reauthenticate: true };
    return failure(error) as never;
  }
};

export const actions = {
  revoke: async ({ request }) => {
    const { auth, origin } = services();
    if (request.headers.get('origin') !== origin) return fail(403, { message: 'Request not authorized.' });
    const form = await request.formData();
    try {
      const { revoked } = await revokeAccountSession(auth, request.headers, String(form.get('id') ?? ''));
      return { message: revoked ? 'That device was signed out.' : 'That session is already gone.' };
    } catch (error) { return failure(error); }
  },
  revokeOthers: async ({ request }) => {
    const { auth, origin } = services();
    if (request.headers.get('origin') !== origin) return fail(403, { message: 'Request not authorized.' });
    try { await revokeOtherAccountSessions(auth, request.headers); }
    catch (error) { return failure(error); }
    return { message: 'All other devices were signed out.' };
  }
} satisfies Actions;
