import { randomUUID } from 'node:crypto';
import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requestAccess } from '../../../lib/server/request-access';
import { addChecklistItems, ChecklistConflict, getChecklist, removeChecklistItem, saveChecklistTemplate, setItemCompletion, updateChecklist, updateChecklistItem } from '../../../lib/server/checklists';

async function principal(request: Request) {
  const access = await requestAccess(request);
  if (access.status === 'anonymous') redirect(303, '/sign-in');
  if (access.status === 'unavailable') error(503, 'Identity service unavailable');
  if (access.status === 'forbidden') error(403, 'No household access');
  return access;
}

export const load: PageServerLoad = async ({ request, params }) => {
  const { db, userId, householdId, role } = await principal(request);
  try {
    const { items, ...list } = getChecklist(db, userId, householdId, params.id);
    return {
      role,
      addRequestId: role === 'parent' ? randomUUID() : null,
      list: { ...list, items: items.map(({ id, name, completed, completedByName, completedAt, version }) => ({ id, name, completed, completedByName, completedAt, version })) }
    };
  }
  catch { error(404, 'List not found'); }
};

export const actions = {
  saveTemplate: async ({ request, params }) => {
    const access = await principal(request);
    if (access.role !== 'parent' || request.headers.get('origin') !== access.origin) return fail(403, { message: 'Request not authorized.' });
    let id: string;
    try { id = saveChecklistTemplate(access.db, access.userId, access.householdId, params.id); }
    catch { return fail(400, { message: 'Could not save a template from this list. Refresh and try again.' }); }
    redirect(303, `/lists/templates/${id}`);
  },
  add: async ({ request, params }) => {
    const access = await principal(request);
    if (access.role !== 'parent' || request.headers.get('origin') !== access.origin) return fail(403, { message: 'Request not authorized.' });
    const form = await request.formData(), text = String(form.get('text') ?? '');
    const addRequestId = String(form.get('requestId') ?? '');
    try { addChecklistItems(access.db, access.userId, access.householdId, params.id, text, addRequestId); }
    catch { return fail(400, { message: 'Check your items and try again. Each item must be 120 characters or fewer.', addText: text, addRequestId }); }
    redirect(303, `/lists/${params.id}`);
  },
  completion: async ({ request, params }) => {
    const access = await principal(request);
    if (request.headers.get('origin') !== access.origin) return fail(403, { message: 'Request not authorized.' });
    const form = await request.formData(), state = form.get('completed');
    if (state !== 'yes' && state !== 'no') return fail(400, { message: 'Invalid update.' });
    try { setItemCompletion(access.db, access.userId, access.householdId, params.id, String(form.get('id') ?? ''), Number(form.get('version')), state === 'yes'); }
    catch { return fail(409, { message: 'This item changed or is no longer available. Refresh and try again.' }); }
    redirect(303, `/lists/${params.id}`);
  },
  update: async ({ request, params }) => {
    const access = await principal(request);
    if (access.role !== 'parent' || request.headers.get('origin') !== access.origin) return fail(403, { message: 'Request not authorized.' });
    const form = await request.formData();
    const input = { name: String(form.get('name') ?? ''), description: String(form.get('description') ?? ''), targetDate: String(form.get('targetDate') ?? ''), shared: form.get('shared') === 'yes', archived: form.get('archived') === 'yes' };
    const version = Number(form.get('version'));
    try { updateChecklist(access.db, access.userId, access.householdId, params.id, version, input); }
    catch (err) {
      const conflict = err instanceof ChecklistConflict;
      return fail(conflict ? 409 : 400, {
        message: conflict ? 'Someone changed this list. Reload to review the latest details before saving your draft.' : 'The list could not be saved. Check its name and date and try again.',
        editList: { ...input, version }
      });
    }
    redirect(303, `/lists/${params.id}`);
  },
  editItem: async ({ request, params }) => {
    const access = await principal(request);
    if (access.role !== 'parent' || request.headers.get('origin') !== access.origin) return fail(403, { message: 'Request not authorized.' });
    const form = await request.formData(), id = String(form.get('id') ?? ''), name = String(form.get('name') ?? '');
    const version = Number(form.get('version'));
    try { updateChecklistItem(access.db, access.userId, access.householdId, params.id, id, version, name); }
    catch (err) {
      const conflict = err instanceof ChecklistConflict;
      return fail(conflict ? 409 : 400, {
        message: conflict ? 'Someone changed this item. Reload to review the latest version before saving your draft.' : 'The item could not be saved. Check its name and try again.',
        editItem: { id, name, version }
      });
    }
    redirect(303, `/lists/${params.id}`);
  },
  remove: async ({ request, params }) => {
    const access = await principal(request);
    if (access.role !== 'parent' || request.headers.get('origin') !== access.origin) return fail(403, { message: 'Request not authorized.' });
    const form = await request.formData();
    try { removeChecklistItem(access.db, access.userId, access.householdId, params.id, String(form.get('id') ?? ''), Number(form.get('version'))); }
    catch { return fail(409, { message: 'This item changed or is already ready. Refresh and try again.' }); }
    redirect(303, `/lists/${params.id}`);
  }
} satisfies Actions;
