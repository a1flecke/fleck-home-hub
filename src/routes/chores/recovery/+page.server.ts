import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { primaryActiveMembership } from '../../../lib/server/household-access';
import { hasRecoverySeries, listRecoveryGaps, resolveRecoveryGap } from '../../../lib/server/recovery';
import { getIdentityServices } from '../../../lib/server/runtime';

async function parentAccess(request: Request) {
  const services = getIdentityServices();
  const session = await services.auth.api.getSession({ headers: request.headers });
  if (!session) redirect(303, '/sign-in');
  const member = primaryActiveMembership(services.db, session.user.id);
  if (member?.role !== 'parent') error(403, 'Recovery is available to household parents.');
  return { ...services, actor: session.user.id, household: member.householdId };
}

function pageOffset(url: URL) {
  const raw = url.searchParams.get('page') ?? '0';
  return /^\d{1,5}$/.test(raw) ? Number(raw) : 0;
}

export const load: PageServerLoad = async ({ request, url }) => {
  const { db, actor, household } = await parentAccess(request);
  const page = pageOffset(url);
  return { gaps: listRecoveryGaps(db, actor, household, page), page, hasNext: hasRecoverySeries(db, actor, household, page + 1), notice: url.searchParams.get('notice') };
};

export const actions: Actions = {
  decide: async ({ request, url }) => {
    const { db, actor, household, origin } = await parentAccess(request);
    if (request.headers.get('origin') !== origin) error(403, 'Request not authorized.');
    const data = await request.formData();
    const field = (name: string) => typeof data.get(name) === 'string' ? String(data.get(name)) : '';
    const seriesId = field('seriesId');
    const date = field('date');
    const reviewed = field('reviewed');
    const decision = field('decision');
    const reward = field('reward').trim();
    const draft = { seriesId, date, reward, confirmed: field('confirmed') === 'yes' };
    if (decision !== 'create' && decision !== 'skip') return fail(400, { message: 'Choose a valid decision.', draft });
    if (decision === 'create' && (!draft.confirmed || !/^\d{1,7}(?:\.\d{1,2})?$/.test(reward) || Number(reward) > 1000000)) return fail(400, { message: 'Enter a reward from $0 to $1,000,000 and confirm the late chore.', draft });
    try {
      if (decision === 'create') {
        const [whole, fraction = ''] = reward.split('.');
        const rewardCents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
        resolveRecoveryGap(db, actor, household, { seriesId, date, reviewed, decision, assigneeId: field('assigneeId'), rewardCents });
      } else resolveRecoveryGap(db, actor, household, { seriesId, date, reviewed, decision });
    } catch { return fail(409, { message: 'This date or chore changed. Refresh and review it before trying again.', draft }); }
    redirect(303, '/chores/recovery?page=' + pageOffset(url) + '&notice=' + (decision === 'create' ? 'created' : 'skipped'));
  }
};
