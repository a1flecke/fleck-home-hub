import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getIdentityServices } from '../../lib/server/runtime';
import { changeChore, createChore } from '../../lib/server/chores';
import type { ChoreAction } from '../../lib/chores/domain';

async function principal(request: Request) {
  let services;
  try { services = getIdentityServices(); } catch { error(503, 'Identity service unavailable'); }
  const session = await services.auth.api.getSession({ headers: request.headers });
  if (!session) redirect(303, '/sign-in');
  const membership = services.db.prepare('SELECT household_id AS householdId, role FROM membership WHERE user_id = ? ORDER BY household_id LIMIT 1').get(session.user.id) as { householdId: string; role: 'parent' | 'kid' } | undefined;
  if (!membership) error(403, 'No household access');
  return { ...services, session, membership };
}

export const load: PageServerLoad = async ({ request }) => {
  const { db, session, membership } = await principal(request);
  const { householdId, role } = membership;
  const chores = db.prepare(`SELECT c.id, c.title, c.description, c.due_date AS dueDate, CASE WHEN c.status = 'verified' THEN (SELECT e.amount_cents FROM earning e WHERE e.chore_id = c.id) ELSE c.reward_cents END AS rewardCents, c.status, c.rework_reason AS reworkReason, c.assignee_id AS assigneeId, u.name AS childName FROM chore c JOIN user u ON u.id = c.assignee_id WHERE c.household_id = ? AND (? = 'parent' OR c.assignee_id = ?) ORDER BY CASE c.status WHEN 'pending_verification' THEN 0 WHEN 'needs_rework' THEN 1 WHEN 'todo' THEN 2 ELSE 3 END, c.created_at DESC, c.id`).all(householdId, role, session.user.id) as { id: string; title: string; description: string | null; dueDate: string; rewardCents: number | null; status: string; reworkReason: string | null; childName: string }[];
  const children = (role === 'parent' ? db.prepare("SELECT u.id, u.name FROM membership m JOIN user u ON u.id = m.user_id WHERE m.household_id = ? AND m.role = 'kid' ORDER BY u.name").all(householdId) : []) as { id: string; name: string }[];
  const balances = db.prepare(`SELECT u.id, u.name, COALESCE((SELECT SUM(c.reward_cents) FROM chore c WHERE c.household_id = m.household_id AND c.assignee_id = u.id AND c.status = 'pending_verification'), 0) AS pending, COALESCE((SELECT SUM(e.amount_cents) FROM earning e WHERE e.household_id = m.household_id AND e.child_id = u.id), 0) AS earned FROM membership m JOIN user u ON u.id = m.user_id WHERE m.household_id = ? AND m.role = 'kid' AND (? = 'parent' OR u.id = ?) ORDER BY u.name`).all(householdId, role, session.user.id) as { id: string; name: string; pending: number; earned: number }[];
  return { name: session.user.name, ...membership, chores, children, balances };
};

export const actions: Actions = {
  create: async ({ request }) => {
    const { db, session, membership, origin } = await principal(request);
    if (request.headers.get('origin') !== origin) return fail(403, { message: 'Request not authorized.' });
    const form = await request.formData();
    const reward = String(form.get('reward') ?? '').trim();
    if (reward && !/^\d{1,7}(?:\.\d{1,2})?$/.test(reward)) return fail(400, { message: 'Enter a valid reward amount.' });
    const cents = reward ? Math.round(Number(reward) * 100) : null;
    try {
      createChore(db, session.user.id, membership.householdId, { title: String(form.get('title') ?? ''), description: String(form.get('description') ?? ''), assigneeId: String(form.get('assignee') ?? ''), dueDate: String(form.get('dueDate') ?? ''), rewardCents: cents });
    } catch { return fail(400, { message: 'Unable to add chore. Check the details and try again.' }); }
    return { message: 'Chore added.' };
  },
  transition: async ({ request }) => {
    const { db, session, membership, origin } = await principal(request);
    if (request.headers.get('origin') !== origin) return fail(403, { message: 'Request not authorized.' });
    const form = await request.formData();
    const action = String(form.get('action'));
    if (!['submit', 'verify', 'rework'].includes(action)) return fail(400, { message: 'Invalid action.' });
    try { changeChore(db, session.user.id, membership.householdId, String(form.get('id') ?? ''), action as ChoreAction, String(form.get('reason') ?? '')); }
    catch { return fail(400, { message: 'Unable to update this chore. Refresh and try again.' }); }
    return { message: action === 'submit' ? 'Nice job! Waiting for a parent to check.' : 'Chore updated.' };
  }
};
