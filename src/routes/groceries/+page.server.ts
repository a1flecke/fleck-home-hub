import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { addGrocery, changeGrocery, listGroceries, removeGrocery } from '../../lib/server/groceries';
import { getIdentityServices } from '../../lib/server/runtime';

async function principal(request: Request) {
  let services;
  try { services = getIdentityServices(); } catch { error(503, 'Identity service unavailable'); }
  const session = await services.auth.api.getSession({ headers: request.headers });
  if (!session) redirect(303, '/sign-in');
  const member = services.db.prepare('SELECT household_id AS householdId FROM membership WHERE user_id = ? ORDER BY household_id LIMIT 1').get(session.user.id) as { householdId: string } | undefined;
  if (!member) error(403, 'No household access');
  return { ...services, actor: session.user.id, householdId: member.householdId };
}

export const load: PageServerLoad = async ({ request }) => {
  const { db, actor, householdId } = await principal(request);
  return { items: listGroceries(db, actor, householdId) };
};

export const actions = {
  add: async ({ request }) => {
    const { db, actor, householdId, origin } = await principal(request);
    if (request.headers.get('origin') !== origin) return fail(403, { message: 'Request not authorized.' });
    const form = await request.formData();
    const item = { name: String(form.get('name') ?? ''), quantity: String(form.get('quantity') ?? ''), unit: String(form.get('unit') ?? '') };
    try { addGrocery(db, actor, householdId, item, form.get('allowDuplicate') === 'yes'); }
    catch (err) { return fail(400, { message: err instanceof Error && err.message === 'Item already on list' ? 'A matching item is already on the list. Confirm if you want another.' : 'Check the item name and details.', item, duplicate: err instanceof Error && err.message === 'Item already on list' }); }
    redirect(303, '/groceries');
  },
  change: async ({ request }) => {
    const { db, actor, householdId, origin } = await principal(request);
    if (request.headers.get('origin') !== origin) return fail(403, { message: 'Request not authorized.' });
    const form = await request.formData();
    const item = { name: String(form.get('name') ?? ''), quantity: String(form.get('quantity') ?? ''), unit: String(form.get('unit') ?? ''), completed: form.get('completed') === 'yes' };
    const id = String(form.get('id') ?? ''), version = Number(form.get('version'));
    try { changeGrocery(db, actor, householdId, id, version, item); }
    catch { return fail(400, { message: 'This item could not be saved. It may have changed; reload and try again.', edit: { id, version, ...item } }); }
    redirect(303, '/groceries');
  },
  remove: async ({ request }) => {
    const { db, actor, householdId, origin } = await principal(request);
    if (request.headers.get('origin') !== origin) return fail(403, { message: 'Request not authorized.' });
    const form = await request.formData();
    try { removeGrocery(db, actor, householdId, String(form.get('id') ?? ''), Number(form.get('version'))); }
    catch { return fail(400, { message: 'This item changed or was removed. Reload and try again.' }); }
    redirect(303, '/groceries');
  }
} satisfies Actions;
