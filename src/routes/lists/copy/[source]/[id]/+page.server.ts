import { randomUUID } from 'node:crypto';
import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { ChecklistConflict, copyChecklist, getChecklistCopySource } from '../../../../../lib/server/checklists';
import { checklistParent } from '../../../parent-access.server';

function sourceFrom({ source, id }: { source: string; id: string }): { kind: 'list' | 'template'; id: string } {
  if (source !== 'list' && source !== 'template') error(404, 'List source not found');
  return { kind: source, id };
}

export const load: PageServerLoad = async ({ request, params }) => {
  const { db, userId, householdId } = await checklistParent(request);
  const source = sourceFrom(params);
  const preview = getChecklistCopySource(db, userId, householdId, source);
  return { source, preview, requestId: preview ? randomUUID() : null };
};

export const actions = {
  create: async ({ request, params }) => {
    const { db, userId, householdId } = await checklistParent(request);
    const source = sourceFrom(params);
    const fields = await request.formData();
    const input = {
      name: String(fields.get('name') ?? ''),
      description: String(fields.get('description') ?? ''),
      targetDate: String(fields.get('targetDate') ?? ''),
      shared: fields.get('shared') === 'yes'
    };
    const draft = { ...input, revision: String(fields.get('revision') ?? ''), requestId: String(fields.get('requestId') ?? '') };
    let id: string;
    try {
      id = copyChecklist(db, userId, householdId, source, draft.revision, input, draft.requestId);
    } catch (err) {
      const conflict = err instanceof ChecklistConflict;
      return fail(conflict ? 409 : 400, {
        draft,
        conflict,
        message: conflict ? 'The source changed, was removed, or this form was already used. Reload to review it before creating a list.' : 'Check the list name, date and details, then try again.'
      });
    }
    redirect(303, `/lists/${id}`);
  }
} satisfies Actions;
