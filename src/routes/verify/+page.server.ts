import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { localDate } from '../../lib/chores/recurrence';
import { reviewReason, type ReviewAction } from '../../lib/chores/review';
import { changeChore } from '../../lib/server/chores';
import { listMembers } from '../../lib/server/household-access';
import { listReviewQueue, reviewChildSummaries } from '../../lib/server/verification';
import { requestAccess } from '../../lib/server/request-access';

async function parent(request: Request) {
  const access = await requestAccess(request);
  if (access.status === 'unavailable') error(503, 'Identity service unavailable');
  if (access.status === 'anonymous') redirect(303, '/sign-in');
  if (access.status === 'forbidden' || access.role !== 'parent') error(403, 'Reviewing chores is available to household parents.');
  return access;
}

function pageNumber(url: URL) {
  const raw = url.searchParams.get('page') ?? '1';
  return /^\d{1,6}$/.test(raw) ? Math.max(1, Number(raw)) : 1;
}

export const load: PageServerLoad = async ({ request, url }) => {
  const { db, userId, householdId } = await parent(request);
  const settings = db.prepare('SELECT timezone FROM household_settings WHERE household_id = ?').get(householdId) as { timezone: string } | undefined;
  const today = localDate(new Date(), settings?.timezone ?? 'America/Chicago');
  const children = listMembers(db, userId, householdId).filter(member => member.role === 'kid').map(member => ({ id: member.id, name: member.name }));
  const childId = url.searchParams.get('child') ?? '';
  try {
    const queue = listReviewQueue(db, userId, householdId, { today, page: pageNumber(url), childId: childId || undefined });
    const summaries = reviewChildSummaries(db, userId, householdId, today);
    return {
      ...queue,
      childId,
      children,
      summaries,
      timezone: settings?.timezone ?? 'America/Chicago',
      today,
      pendingCount: summaries.reduce((total, child) => total + child.pendingCount, 0),
      pendingCents: summaries.reduce((total, child) => total + child.pendingCents, 0),
      verifiedOwed: summaries.reduce((total, child) => total + child.owed, 0),
      notice: url.searchParams.get('notice')
    };
  } catch (cause) {
    if (cause instanceof Error && cause.message === 'Invalid child') error(400, 'Choose a child in your household.');
    throw cause;
  }
};

export const actions: Actions = {
  review: async ({ request, url }) => {
    const { db, userId, householdId, origin } = await parent(request);
    if (request.headers.get('origin') !== origin) return fail(403, { message: 'Request not authorized.' });
    const form = await request.formData();
    const action = String(form.get('action') ?? '');
    const id = String(form.get('id') ?? '');
    const reason = String(form.get('reason') ?? '');
    const reviewError = { id, action, reason };
    if (action !== 'verify' && action !== 'rework') return fail(400, { message: 'Choose verify or return for rework.', reviewError });
    let explanation: string | null;
    try { explanation = reviewReason(action as ReviewAction, reason); }
    catch (cause) { return fail(400, { message: cause instanceof Error ? cause.message : 'Enter a valid reason.', reviewError }); }
    const child = url.searchParams.get('child') ?? '';
    const destination = `/verify?page=${pageNumber(url)}${child ? `&child=${encodeURIComponent(child)}` : ''}`;
    try { changeChore(db, userId, householdId, id, action, explanation ?? undefined); }
    catch { return fail(409, { message: 'This submission changed or is no longer waiting for review. Refresh the queue and try again.', reviewError }); }
    redirect(303, `${destination}&notice=${action === 'verify' ? 'verified' : 'rework'}`);
  }
};
