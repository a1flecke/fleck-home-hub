import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { DisplayPairingError, createPairing, listDisplays, revokeDisplay, revokePairing } from '../../../lib/server/display-pairing';
import { getIdentityServices } from '../../../lib/server/runtime';

async function parent(request: Request, url: URL) {
  let services;
  try { services = getIdentityServices(); } catch { error(503, 'Identity service unavailable'); }
  const session = await services.auth.api.getSession({ headers: request.headers });
  if (!session) redirect(303, '/sign-in');
  const households = services.db.prepare("SELECT household.id, household.name FROM household JOIN active_membership ON active_membership.household_id = household.id WHERE active_membership.user_id = ? AND active_membership.role = 'parent' ORDER BY household.name, household.id").all(session.user.id) as { id: string; name: string }[];
  const householdId = url.searchParams.get('household') ?? households[0]?.id;
  if (!householdId || !households.some(item => item.id === householdId)) error(403, 'No household administration access');
  return { ...services, actor: session.user.id, households, householdId };
}

export const load: PageServerLoad = async ({ request, url }) => {
  const { db, actor, households, householdId } = await parent(request, url);
  const zone = (db.prepare('SELECT timezone FROM household_settings WHERE household_id = ?').get(householdId) as { timezone: string } | undefined)?.timezone ?? 'America/Chicago';
  const format = new Intl.DateTimeFormat('en-US', { timeZone: zone, dateStyle: 'medium', timeStyle: 'short' });
  const label = (at: number | null) => at === null ? null : format.format(new Date(at));
  const { devices, pending } = listDisplays(db, actor, householdId);
  return {
    households, householdId,
    devices: devices.map(device => ({ id: device.id, label: device.label, status: device.status, pairedAt: label(device.pairedAt), lastSeenAt: label(device.lastSeenAt), expiresAt: label(device.expiresAt), revokedAt: label(device.revokedAt) })),
    pending: pending.map(item => ({ id: item.id, label: item.label, expiresAt: label(item.expiresAt) }))
  };
};

const messages = { 'not-authorized': 'Request not authorized.', 'invalid-label': 'Enter a name of 1 to 60 characters without control characters.', 'too-many': 'Too many unused pairing codes. Cancel one or wait for it to expire.', invalid: 'Request could not be completed.', unavailable: 'That display is no longer available. Reload and try again.' } as const;

export const actions = {
  create: async ({ request, url }) => {
    const { db, actor, householdId, origin } = await parent(request, url);
    if (request.headers.get('origin') !== origin) return fail(403, { message: 'Request not authorized.' });
    const name = String((await request.formData()).get('label') ?? '');
    try {
      const pairing = createPairing(db, actor, householdId, name);
      // The only time the code exists in plaintext; it is not stored and not placed in a URL.
      return { code: pairing.secret, codeLabel: name.trim(), message: 'Pairing code created.' };
    } catch (cause) {
      if (!(cause instanceof DisplayPairingError)) throw cause;
      return fail(cause.code === 'not-authorized' ? 403 : 400, { label: name, message: messages[cause.code] });
    }
  },
  revoke: async ({ request, url }) => {
    const { db, actor, householdId, origin } = await parent(request, url);
    if (request.headers.get('origin') !== origin) return fail(403, { message: 'Request not authorized.' });
    try {
      const { changed } = revokeDisplay(db, actor, householdId, String((await request.formData()).get('id') ?? ''));
      return { message: changed ? 'Display revoked. It stops receiving information on its next request.' : 'That display was already revoked.' };
    } catch (cause) {
      return fail(cause instanceof DisplayPairingError && cause.code === 'not-authorized' ? 403 : 400, { message: messages[cause instanceof DisplayPairingError ? cause.code : 'unavailable'] });
    }
  },
  cancel: async ({ request, url }) => {
    const { db, actor, householdId, origin } = await parent(request, url);
    if (request.headers.get('origin') !== origin) return fail(403, { message: 'Request not authorized.' });
    try { revokePairing(db, actor, householdId, String((await request.formData()).get('id') ?? '')); }
    catch { return fail(400, { message: messages.unavailable }); }
    return { message: 'Pairing code cancelled.' };
  }
} satisfies Actions;
