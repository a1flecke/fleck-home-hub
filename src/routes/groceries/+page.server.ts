import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { addGrocery, changeGrocery, clearBoughtGroceries, GroceryClearConflictError, GroceryClearValidationError, listGroceries, MAX_BOUGHT_CLEAR_ROWS, removeGrocery } from '../../lib/server/groceries';
import { getIdentityServices } from '../../lib/server/runtime';

const MAX_CLEAR_BODY_BYTES = 64 * 1024;

/** Reads a clear submission while refusing to buffer an unbounded body. */
async function boundedClearForm(request: Request): Promise<FormData | null> {
  const declared = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > MAX_CLEAR_BODY_BYTES) return null;
  if (!request.body) return request.formData();
  const reader = request.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_CLEAR_BODY_BYTES) { await reader.cancel(); return null; }
      chunks.push(new Uint8Array(value));
    }
  } catch { return null; }
  const contentType = request.headers.get('content-type') ?? '';
  try {
    return await new Request(request.url, { method: 'POST', headers: { 'content-type': contentType }, body: new Blob(chunks, { type: contentType }) }).formData();
  } catch { return null; }
}

async function principal(request: Request) {
  let services;
  try { services = getIdentityServices(); } catch { error(503, 'Identity service unavailable'); }
  const session = await services.auth.api.getSession({ headers: request.headers });
  if (!session) redirect(303, '/sign-in');
  const member = services.db.prepare('SELECT household_id AS householdId, role FROM active_membership WHERE user_id = ? ORDER BY household_id LIMIT 1').get(session.user.id) as { householdId: string; role: string } | undefined;
  if (!member) error(403, 'No household access');
  return { ...services, actor: session.user.id, householdId: member.householdId, role: member.role };
}

export const load: PageServerLoad = async ({ request, url }) => {
  const { db, actor, householdId, role } = await principal(request);
  const addedParam = url.searchParams.get('added'), skippedParam = url.searchParams.get('skipped');
  const added = Number(addedParam), skipped = Number(skippedParam);
  const summary = addedParam !== null && skippedParam !== null && Number.isInteger(added) && Number.isInteger(skipped) && added >= 0 && skipped >= 0 ? { added, skipped } : null;
  return { items: listGroceries(db, actor, householdId), summary, role };
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
  },
  clearBought: async ({ request }) => {
    const { db, actor, householdId, origin, role } = await principal(request);
    if (request.headers.get('origin') !== origin || role !== 'parent') return fail(403, { message: 'Request not authorized.' });

    const form = await boundedClearForm(request);
    if (!form) return fail(413, { clear: { ok: false, changed: false, message: 'The clear request was too large. Refresh the list and try again.' } });
    const ids = form.getAll('id').map(value => String(value));
    const versions = form.getAll('version').map(value => String(value));
    if (ids.length > MAX_BOUGHT_CLEAR_ROWS || ids.length !== versions.length) {
      return fail(400, { clear: { ok: false, changed: false, message: 'The selected bought items were not valid. Refresh the list and try again.' } });
    }

    const selection = ids.map((id, index) => ({ id, version: Number(versions[index]) }));
    try { return { clear: { ok: true, cleared: clearBoughtGroceries(db, actor, householdId, selection).cleared } }; }
    catch (err) {
      if (err instanceof GroceryClearConflictError) {
        return fail(409, { clear: { ok: false, changed: true, message: 'The bought list changed in another session. Nothing was cleared. Refresh the list and review the bought items again.' } });
      }
      if (err instanceof GroceryClearValidationError) {
        return fail(400, { clear: { ok: false, changed: false, message: 'The selected bought items were not valid. Refresh the list and try again.' } });
      }
      if (err instanceof Error && err.message === 'Not authorized') return fail(403, { message: 'Request not authorized.' });
      throw err;
    }
  }
} satisfies Actions;
