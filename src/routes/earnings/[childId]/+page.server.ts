import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { localDate } from '../../../lib/chores/recurrence';
import { listPayoutHistory } from '../../../lib/server/my-day';
import { reversePayout } from '../../../lib/server/payouts';
import { requestAccess } from '../../../lib/server/request-access';

async function member(request: Request) {
  const access = await requestAccess(request);
  if (access.status === 'unavailable') error(503, 'Identity service unavailable');
  if (access.status === 'anonymous') redirect(303, '/sign-in');
  if (access.status === 'forbidden') error(403, 'No household access');
  return access;
}

function pageNumber(url: URL) {
  const raw = url.searchParams.get('page') ?? '1';
  return /^\d{1,6}$/.test(raw) ? Math.max(1, Number(raw)) : 1;
}

export const load: PageServerLoad = async ({ request, params, url }) => {
  const { db, userId, role, householdId } = await member(request);
  const settings = db.prepare('SELECT timezone FROM household_settings WHERE household_id = ?').get(householdId) as { timezone: string } | undefined;
  const today = localDate(new Date(), settings?.timezone ?? 'America/Chicago');
  try {
    return { role, today, ...listPayoutHistory(db, { householdId, role, actorId: userId, today, childId: params.childId, page: pageNumber(url) }), notice: url.searchParams.get('notice') };
  } catch { error(404, 'Child payment history was not found.'); }
};

export const actions: Actions = {
  reversePayout: async ({ request, params, url }) => {
    const { db, userId, role, householdId, origin } = await member(request);
    if (request.headers.get('origin') !== origin || role !== 'parent') return fail(403, { message: 'Request not authorized.' });
    const form = await request.formData();
    const correctionError = { id: String(form.get('id') ?? ''), reason: String(form.get('reason') ?? '') };
    const belongsToChild = db.prepare('SELECT 1 FROM payout WHERE id = ? AND household_id = ? AND child_id = ?').get(correctionError.id, householdId, params.childId);
    if (!belongsToChild) return fail(404, { message: 'Payment history was not found.' });
    try { reversePayout(db, userId, householdId, correctionError.id, correctionError.reason); }
    catch { return fail(400, { message: 'Unable to correct payment. Enter a reason and try again.', correctionError }); }
    redirect(303, `/earnings/${encodeURIComponent(params.childId)}?page=${pageNumber(url)}&notice=corrected`);
  }
};
