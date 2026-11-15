import { randomUUID } from 'node:crypto';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createInvitation } from '../../lib/server/invitations';
import { listManagedChildren } from '../../lib/server/managed-children';
import { handleChildForm } from '../../lib/server/child-forms';
import { parentHousehold } from '../../lib/server/parent-household';
import { advanceOnboarding, onboardingStep } from '../../lib/server/onboarding';

export const load: PageServerLoad = async ({ request }) => {
  const { db, actor, household } = await parentHousehold(request);
  const step = onboardingStep(db, household.id);
  if (!step || step === 'complete') redirect(303, '/dashboard');
  const invitations = db.prepare(`
    SELECT id, CASE WHEN consumed_at IS NOT NULL THEN 'Accepted'
      WHEN revoked_at IS NOT NULL THEN 'Replaced or revoked'
      WHEN expires_at <= ? THEN 'Expired' ELSE 'Pending' END AS status
    FROM household_invitation WHERE household_id = ? AND role = 'parent'
    ORDER BY (consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?) DESC, expires_at DESC, id LIMIT 10
  `).all(Date.now(), household.id, Date.now()) as { id: string; status: string }[];
  return { household, step, invitations, children: listManagedChildren(db, actor, household.id), requestId: randomUUID() };
};

export const actions = {
  invite: async ({ request }) => {
    const { db, actor, household, origin } = await parentHousehold(request);
    if (request.headers.get('origin') !== origin) return fail(403, { message: 'Open this form from your home hub.' });
    const form = await request.formData();
    const replace = String(form.get('replace') ?? '');
    try {
      const token = createInvitation(db, actor, household.id, 'parent', replace || null);
      return { invitationLink: origin + '/accept-invitation#' + token };
    } catch {
      return fail(400, { message: 'We couldn’t create the invite. Check the current status and try again.' });
    }
  },
  advance: async ({ request }) => {
    const { db, actor, household, origin } = await parentHousehold(request);
    if (request.headers.get('origin') !== origin) return fail(403, { message: 'Open this form from your home hub.' });
    const form = await request.formData();
    const move = form.get('move');
    if (move !== 'next' && move !== 'back' && move !== 'finish') return fail(400, { message: 'Choose how to continue.' });
    let completed: boolean;
    try {
      completed = advanceOnboarding(db, actor, household.id, String(form.get('step') ?? ''), move);
    } catch {
      return fail(403, { message: 'Setup couldn’t be updated. Open your dashboard and try again.' });
    }
    if (completed) redirect(303, '/dashboard?welcome=1');
    redirect(303, '/onboarding');
  },
  add: ({ request }) => handleChildForm(request, 'add'),
  rename: ({ request }) => handleChildForm(request, 'rename'),
  credentials: ({ request }) => handleChildForm(request, 'credentials')
} satisfies Actions;
