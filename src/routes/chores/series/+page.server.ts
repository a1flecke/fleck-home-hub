import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { addCalendarDays } from '../../../lib/calendar/dates';
import { localDate } from '../../../lib/chores/recurrence';
import { createSeries, generateOccurrences, listSeriesPage, previewSeriesSchedule, reviseSeriesSchedule, SeriesChangeError, setSeriesState, skipOccurrence, updateSeries } from '../../../lib/server/recurring';
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

type ScheduleFields = { id: string; updatedAt: string; title: string; description: string; assignee: string; effectiveDate: string; endDate: string; weekdays: number[]; reward: string };

function scheduleFields(form: FormData): ScheduleFields {
  return {
    id: String(form.get('id') ?? ''),
    updatedAt: String(form.get('updatedAt') ?? ''),
    title: String(form.get('title') ?? ''),
    description: String(form.get('description') ?? ''),
    assignee: String(form.get('assignee') ?? ''),
    effectiveDate: String(form.get('effectiveDate') ?? ''),
    endDate: String(form.get('endDate') ?? ''),
    weekdays: form.getAll('weekday').map(Number),
    reward: String(form.get('reward') ?? '').trim()
  };
}

function scheduleInput(fields: ScheduleFields) {
  return {
    title: fields.title,
    description: fields.description,
    assigneeId: fields.assignee,
    startDate: fields.effectiveDate,
    endDate: fields.endDate,
    weekdays: fields.weekdays,
    rewardCents: fields.reward ? Math.round(Number(fields.reward) * 100) : null
  };
}

function scheduleFailure(cause: unknown, fields: ScheduleFields) {
  if (cause instanceof SeriesChangeError) {
    if (cause.code === 'stale') return fail(409, { message: 'This schedule changed in another view. Refresh the page and try again.', scheduleError: fields });
    if (cause.code === 'ended') return fail(400, { message: 'Ended schedules cannot be changed.', scheduleError: fields });
    if (cause.code === 'not-found') return fail(400, { message: 'This schedule is no longer available.', scheduleError: fields });
  }
  return fail(400, { message: 'Unable to use this schedule. Check the effective date, end date and repeat days.', scheduleError: fields });
}

export const load: PageServerLoad = async ({ request, url }) => {
  const { db, userId, householdId } = await parent(request);
  const settings = db.prepare('SELECT timezone FROM household_settings WHERE household_id = ?').get(householdId) as { timezone: string } | undefined;
  const timezone = settings?.timezone ?? 'America/Chicago';
  const today = localDate(new Date(), timezone);
  const end = new Date(`${today}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 7);
  generateOccurrences(db, userId, householdId, today, end.toISOString().slice(0, 10));
  const focus = url.searchParams.get('focus') ?? '';
  const series = listSeriesPage(db, userId, householdId, pageNumber(url), 10, focus || undefined);
  const children = db.prepare("SELECT u.id, u.name FROM active_membership m JOIN user u ON u.id = m.user_id WHERE m.household_id = ? AND m.role = 'kid' ORDER BY u.name, u.id").all(householdId) as { id: string; name: string }[];
  return { ...series, timezone, children, today, tomorrow: addCalendarDays(today, 1), focus, notice: url.searchParams.get('notice') };
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
  previewSchedule: async ({ request }) => {
    const { db, userId, householdId, origin } = await parent(request);
    if (request.headers.get('origin') !== origin) return fail(403, { message: 'Request not authorized.' });
    const fields = scheduleFields(await request.formData());
    if (fields.reward && !/^\d{1,7}(?:\.\d{1,2})?$/.test(fields.reward)) return fail(400, { message: 'Enter a valid reward amount.', scheduleError: fields });
    try {
      const preview = previewSeriesSchedule(db, userId, householdId, fields.id, fields.updatedAt, { ...scheduleInput(fields), effectiveDate: fields.effectiveDate });
      return { schedulePreview: { ...preview, draft: fields } };
    } catch (cause) { return scheduleFailure(cause, fields); }
  },
  reviseSchedule: async ({ request, url }) => {
    const { db, userId, householdId, origin } = await parent(request);
    if (request.headers.get('origin') !== origin) return fail(403, { message: 'Request not authorized.' });
    const fields = scheduleFields(await request.formData());
    if (fields.reward && !/^\d{1,7}(?:\.\d{1,2})?$/.test(fields.reward)) return fail(400, { message: 'Enter a valid reward amount.', scheduleError: fields });
    try {
      reviseSeriesSchedule(db, userId, householdId, fields.id, fields.updatedAt, { ...scheduleInput(fields), effectiveDate: fields.effectiveDate });
    } catch (cause) { return scheduleFailure(cause, fields); }
    redirect(303, `/chores/series?page=${pageNumber(url)}&focus=${encodeURIComponent(fields.id)}&notice=revised`);
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
