import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { localDate } from '../../../lib/chores/recurrence';
import { createSeries, generateOccurrences, listSeriesPage, setSeriesState, skipOccurrence, updateSeries } from '../../../lib/server/recurring';
import { requestAccess } from '../../../lib/server/request-access';

async function parent(request: Request) {
  const access = await requestAccess(request);
  if (access.status === 'unavailable') error(503, 'Identity service unavailable');
  if (access.status === 'anonymous') redirect(303, '/sign-in');
  if (access.status === 'forbidden' || access.role !== 'parent') error(403, 'Recurring chores are available to household parents.');
  return access;
}

function pageNumber(url: URL) {
  const raw = url.searchParams.get('page') ?? '1';
  return /^\d{1,6}$/.test(raw) ? Math.max(1, Number(raw)) : 1;
}

export const load: PageServerLoad = async ({ request, url }) => {
  const { db, userId, householdId } = await parent(request);
  const settings = db.prepare('SELECT timezone FROM household_settings WHERE household_id = ?').get(householdId) as { timezone: string } | undefined;
  const timezone = settings?.timezone ?? 'America/Chicago';
  const today = localDate(new Date(), timezone);
  const end = new Date(`${today}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 7);
  generateOccurrences(db, userId, householdId, today, end.toISOString().slice(0, 10));
  const series = listSeriesPage(db, userId, householdId, pageNumber(url));
  const children = db.prepare("SELECT u.id, u.name FROM active_membership m JOIN user u ON u.id = m.user_id WHERE m.household_id = ? AND m.role = 'kid' ORDER BY u.name, u.id").all(householdId) as { id: string; name: string }[];
  return { ...series, timezone, children, today };
};

export const actions: Actions = {
  series: async ({ request }) => {
    const { db, userId, householdId, origin } = await parent(request);
    if (request.headers.get('origin') !== origin) return fail(403, { message: 'Request not authorized.' });
    const form = await request.formData();
    const reward = String(form.get('reward') ?? '').trim();
    const seriesError = { id: String(form.get('id') ?? ''), title: String(form.get('title') ?? ''), description: String(form.get('description') ?? ''), assignee: String(form.get('assignee') ?? ''), startDate: String(form.get('startDate') ?? ''), endDate: String(form.get('endDate') ?? ''), weekdays: form.getAll('weekday').map(Number), reward };
    if (reward && !/^\d{1,7}(?:\.\d{1,2})?$/.test(reward)) return fail(400, { message: 'Enter a valid reward amount.', seriesError });
    const input = { title: String(form.get('title') ?? ''), description: String(form.get('description') ?? ''), assigneeId: String(form.get('assignee') ?? ''), startDate: String(form.get('startDate') ?? ''), endDate: String(form.get('endDate') ?? ''), weekdays: form.getAll('weekday').map(value => Number(value)), rewardCents: reward ? Math.round(Number(reward) * 100) : null };
    try {
      const id = String(form.get('id') ?? '');
      if (id) updateSeries(db, userId, householdId, id, input);
      else createSeries(db, userId, householdId, input);
    } catch { return fail(400, { message: 'Unable to save recurring chore. Check the details and try again.', seriesError }); }
    return { message: 'Recurring chore saved.' };
  },
  seriesControl: async ({ request }) => {
    const { db, userId, householdId, origin } = await parent(request);
    if (request.headers.get('origin') !== origin) return fail(403, { message: 'Request not authorized.' });
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    const action = String(form.get('action') ?? '');
    try {
      if (action === 'skip') skipOccurrence(db, userId, householdId, id, String(form.get('date') ?? ''));
      else if (action === 'active' || action === 'paused' || action === 'ended') setSeriesState(db, userId, householdId, id, action);
      else throw new Error('Invalid action');
    } catch { return fail(400, { message: 'Unable to update recurring chore.' }); }
    return { message: 'Recurring chore updated.' };
  }
};
