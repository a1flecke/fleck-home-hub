import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getIdentityServices } from '../../../lib/server/runtime';
import { createInvitation, listHouseholdAccess, revokeInvitation } from '../../../lib/server/invitations';

async function parent(request: Request, url: URL) {
  const services = getIdentityServices();
  const session = await services.auth.api.getSession({ headers: request.headers });
  if (!session) redirect(303, '/sign-in');
  const households = services.db.prepare("SELECT household.id, household.name FROM household JOIN membership ON membership.household_id = household.id WHERE membership.user_id = ? AND membership.role = 'parent' ORDER BY household.name, household.id").all(session.user.id) as { id: string; name: string }[];
  const householdId = url.searchParams.get('household') ?? households[0]?.id;
  if (!householdId || !households.some((item) => item.id === householdId)) error(403, 'No household administration access');
  return { ...services, actor: session.user.id, households, householdId };
}

export const load: PageServerLoad = async ({ request, url }) => {
  const { db, actor, households, householdId } = await parent(request, url);
  return { households, householdId, ...listHouseholdAccess(db, actor, householdId) };
};

export const actions = {
  invite: async ({ request, url }) => {
    const { db, actor, householdId, origin } = await parent(request, url);
    if (request.headers.get('origin') !== origin) return fail(403, { message: 'Request not authorized.' });
    const form = await request.formData();
    const role = form.get('role');
    if (role !== 'parent' && role !== 'kid') return fail(400, { message: 'Choose a parent or child invitation.' });
    try { return { invitationLink: `${origin}/accept-invitation#${createInvitation(db, actor, householdId, role)}` }; }
    catch { return fail(400, { role, message: 'The invitation could not be created. Please try again.' }); }
  },
  revoke: async ({ request, url }) => {
    const { db, actor, householdId, origin } = await parent(request, url);
    if (request.headers.get('origin') !== origin) return fail(403, { message: 'Request not authorized.' });
    const form = await request.formData();
    try { revokeInvitation(db, actor, householdId, String(form.get('id') ?? '')); }
    catch { return fail(400, { message: 'That invitation is no longer available. Reload and try again.' }); }
    return { message: 'Invitation revoked.' };
  }
} satisfies Actions;
