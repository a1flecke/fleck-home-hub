import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { ChecklistConflict, getChecklistTemplate, removeChecklistTemplate, updateChecklistTemplate } from '../../../../lib/server/checklists';
import { checklistParent } from '../../parent-access.server';

export const load: PageServerLoad = async ({ request, params }) => {
  const { db, userId, householdId } = await checklistParent(request);
  return { template: getChecklistTemplate(db, userId, householdId, params.id) };
};

export const actions = {
  update: async ({ request, params }) => {
    const { db, userId, householdId } = await checklistParent(request);
    const fields = await request.formData();
    const draft = {
      name: String(fields.get('name') ?? ''),
      description: String(fields.get('description') ?? ''),
      items: String(fields.get('items') ?? ''),
      version: Number(fields.get('version'))
    };
    try {
      updateChecklistTemplate(db, userId, householdId, params.id, draft.version, draft);
    } catch (err) {
      const conflict = err instanceof ChecklistConflict;
      return fail(conflict ? 409 : 400, {
        draft,
        conflict,
        message: conflict ? 'This template changed or was removed. Reload the template before saving.' : 'Enter a template name and keep each item to 120 characters or fewer.'
      });
    }
    redirect(303, '/lists/templates');
  },
  remove: async ({ request, params }) => {
    const { db, userId, householdId } = await checklistParent(request);
    const fields = await request.formData();
    const removeVersion = Number(fields.get('version'));
    try {
      removeChecklistTemplate(db, userId, householdId, params.id, removeVersion);
    } catch {
      return fail(409, { removeVersion, conflict: true, message: 'This template changed or was removed. Reload the template before trying again.' });
    }
    redirect(303, '/lists/templates');
  }
} satisfies Actions;
