import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getIdentityServices } from '../../lib/server/runtime';
import { changeChore, createChore } from '../../lib/server/chores';
import type { ChoreAction } from '../../lib/chores/domain';
import { localDate } from '../../lib/chores/recurrence';
import { createSeries, generateOccurrences, setHouseholdTimezone, setSeriesState, skipOccurrence, updateSeries } from '../../lib/server/recurring';

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
  const settings = db.prepare('SELECT timezone FROM household_settings WHERE household_id = ?').get(householdId) as { timezone: string } | undefined;
  const timezone = settings?.timezone ?? 'America/Chicago';
  const today = localDate(new Date(), timezone);
  const end = new Date(`${today}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 7);
  generateOccurrences(db, session.user.id, householdId, today, end.toISOString().slice(0, 10));
  const chores = db.prepare(`SELECT c.id, c.title, c.description, c.due_date AS dueDate, CASE WHEN c.status = 'verified' THEN (SELECT e.amount_cents FROM earning e WHERE e.chore_id = c.id) ELSE c.reward_cents END AS rewardCents, c.status, c.rework_reason AS reworkReason, c.assignee_id AS assigneeId, u.name AS childName, o.series_id AS seriesId, o.scheduled_date AS scheduledDate FROM chore c JOIN user u ON u.id = c.assignee_id LEFT JOIN recurring_occurrence o ON o.chore_id = c.id LEFT JOIN recurring_series r ON r.id = o.series_id WHERE c.household_id = ? AND (? = 'parent' OR c.assignee_id = ?) AND NOT EXISTS (SELECT 1 FROM recurring_skip s WHERE s.series_id = o.series_id AND s.scheduled_date = o.scheduled_date) AND NOT (r.state IS NOT NULL AND r.state != 'active' AND c.status = 'todo' AND o.scheduled_date >= ?) ORDER BY CASE c.status WHEN 'pending_verification' THEN 0 WHEN 'needs_rework' THEN 1 WHEN 'todo' THEN 2 ELSE 3 END, CASE WHEN c.status != 'verified' THEN c.due_date END ASC, CASE WHEN c.status = 'verified' THEN c.updated_at END DESC, c.created_at DESC, c.id`).all(householdId, role, session.user.id, today) as { id: string; title: string; description: string | null; dueDate: string; rewardCents: number | null; status: string; reworkReason: string | null; childName: string; seriesId: string | null; scheduledDate: string | null }[];
  const children = (role === 'parent' ? db.prepare("SELECT u.id, u.name FROM membership m JOIN user u ON u.id = m.user_id WHERE m.household_id = ? AND m.role = 'kid' ORDER BY u.name").all(householdId) : []) as { id: string; name: string }[];
  const balances = db.prepare(`SELECT u.id, u.name, COALESCE((SELECT SUM(c.reward_cents) FROM chore c WHERE c.household_id = m.household_id AND c.assignee_id = u.id AND c.status = 'pending_verification'), 0) AS pending, COALESCE((SELECT SUM(e.amount_cents) FROM earning e WHERE e.household_id = m.household_id AND e.child_id = u.id), 0) AS earned FROM membership m JOIN user u ON u.id = m.user_id WHERE m.household_id = ? AND m.role = 'kid' AND (? = 'parent' OR u.id = ?) ORDER BY u.name`).all(householdId, role, session.user.id) as { id: string; name: string; pending: number; earned: number }[];
  const rows = role === 'parent' ? db.prepare('SELECT id, title, description, assignee_id AS assigneeId, reward_cents AS rewardCents, start_date AS startDate, end_date AS endDate, weekdays, state FROM recurring_series WHERE household_id = ? ORDER BY created_at DESC').all(householdId) as { id: string; title: string; description: string | null; assigneeId: string; rewardCents: number | null; startDate: string; endDate: string | null; weekdays: string; state: string }[] : [];
  const series = rows.map(item => ({ ...item,
    next: item.state === 'active' ? (db.prepare("SELECT o.scheduled_date AS date FROM recurring_occurrence o JOIN chore c ON c.id = o.chore_id WHERE o.series_id = ? AND o.scheduled_date >= ? AND c.status = 'todo' AND NOT EXISTS (SELECT 1 FROM recurring_skip s WHERE s.series_id = o.series_id AND s.scheduled_date = o.scheduled_date) ORDER BY o.scheduled_date LIMIT 1").get(item.id, today) as { date: string } | undefined)?.date : undefined,
    skips: (db.prepare('SELECT scheduled_date AS date FROM recurring_skip WHERE series_id = ? ORDER BY scheduled_date DESC').all(item.id) as { date: string }[]).map(skip => skip.date)
  }));
  return { name: session.user.name, ...membership, chores, children, balances, series, today, timezone };
};

export const actions: Actions = {
  timezone: async ({ request }) => {
    const { db, session, membership, origin } = await principal(request);
    if (request.headers.get('origin') !== origin) return fail(403, { message: 'Request not authorized.' });
    const form = await request.formData();
    try { setHouseholdTimezone(db, session.user.id, membership.householdId, String(form.get('timezone') ?? '').trim()); }
    catch { return fail(400, { message: 'Enter a valid household time zone.' }); }
    return { message: 'Household time zone saved.' };
  },
  series: async ({ request }) => {
    const { db, session, membership, origin } = await principal(request);
    if (request.headers.get('origin') !== origin) return fail(403, { message: 'Request not authorized.' });
    const form = await request.formData();
    const reward = String(form.get('reward') ?? '').trim();
    if (reward && !/^\d{1,7}(?:\.\d{1,2})?$/.test(reward)) return fail(400, { message: 'Enter a valid reward amount.' });
    const input = { title: String(form.get('title') ?? ''), description: String(form.get('description') ?? ''), assigneeId: String(form.get('assignee') ?? ''), startDate: String(form.get('startDate') ?? ''), endDate: String(form.get('endDate') ?? ''), weekdays: form.getAll('weekday').map(value => Number(value)), rewardCents: reward ? Math.round(Number(reward) * 100) : null };
    try {
      const id = String(form.get('id') ?? '');
      if (id) updateSeries(db, session.user.id, membership.householdId, id, input);
      else createSeries(db, session.user.id, membership.householdId, input);
    } catch { return fail(400, { message: 'Unable to save recurring chore. Check the details and try again.' }); }
    return { message: 'Recurring chore saved.' };
  },
  seriesControl: async ({ request }) => {
    const { db, session, membership, origin } = await principal(request);
    if (request.headers.get('origin') !== origin) return fail(403, { message: 'Request not authorized.' });
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    const action = String(form.get('action') ?? '');
    try {
      if (action === 'skip') skipOccurrence(db, session.user.id, membership.householdId, id, String(form.get('date') ?? ''));
      else if (action === 'active' || action === 'paused' || action === 'ended') setSeriesState(db, session.user.id, membership.householdId, id, action);
      else throw new Error('Invalid action');
    } catch { return fail(400, { message: 'Unable to update recurring chore.' }); }
    return { message: 'Recurring chore updated.' };
  },
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
