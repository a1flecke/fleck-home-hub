import { randomUUID } from 'node:crypto';
import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requestAccess } from '../../lib/server/request-access';
import { createChecklist, listChecklists } from '../../lib/server/checklists';

async function principal(request: Request) {
  const access = await requestAccess(request);
  if (access.status === 'anonymous') redirect(303, '/sign-in');
  if (access.status === 'unavailable') error(503, 'Identity service unavailable');
  if (access.status === 'forbidden') error(403, 'No household access');
  return access;
}

export const load: PageServerLoad = async ({ request }) => {
  const { db, userId, householdId, role } = await principal(request);
  return { role, requestId: role === 'parent' ? randomUUID() : null, lists: listChecklists(db, userId, householdId) };
};

export const actions = {
  create: async ({ request }) => {
    const { db, userId, householdId, role, origin } = await principal(request);
    if (role !== 'parent' || request.headers.get('origin') !== origin) return fail(403, { message: 'Request not authorized.' });
    const form = await request.formData();
    const input = { name: String(form.get('name') ?? ''), description: String(form.get('description') ?? ''), targetDate: String(form.get('targetDate') ?? ''), shared: form.get('shared') === 'yes' };
    const requestId = String(form.get('requestId') ?? '');
    let id: string;
    try { id = createChecklist(db, userId, householdId, input, requestId); }
    catch { return fail(400, { message: 'Check the list name, date and details, then try again.', input, requestId }); }
    redirect(303, `/lists/${id}`);
  }
} satisfies Actions;
