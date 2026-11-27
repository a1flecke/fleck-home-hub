import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { addCalendarDays, parseCalendarDate } from '../../../../lib/calendar/dates';
import { localDate } from '../../../../lib/chores/recurrence';
import { listUpcomingEvents } from '../../../../lib/server/calendar';
import { getChecklist, getChecklistEventLink, setChecklistEventLink } from '../../../../lib/server/checklists';
import { checklistParent } from '../../parent-access.server';

export const load: PageServerLoad = async ({ request, url, params }) => {
  const { db, userId, householdId } = await checklistParent(request);
  const list = (() => {
    try { return getChecklist(db, userId, householdId, params.id); }
    catch { error(404, 'List not found'); }
  })();
  const settings = db.prepare('SELECT timezone FROM household_settings WHERE household_id = ?').get(householdId) as { timezone: string } | undefined;
  const date = url.searchParams.get('date') || localDate(new Date(), settings?.timezone ?? 'America/Chicago');
  try { parseCalendarDate(date); }
  catch { error(400, 'Invalid calendar date'); }
  const link = getChecklistEventLink(db, userId, householdId, params.id);
  const events = list.archived ? [] : listUpcomingEvents(db, userId, householdId, date, addCalendarDays(date, 13));
  return { list: { id: list.id, name: list.name, archived: list.archived }, date, link, events };
};

export const actions = {
  link: async ({ request, params }) => {
    const { db, userId, householdId } = await checklistParent(request);
    const fields = await request.formData();
    const selected = String(fields.get('occurrence') ?? ''), token = String(fields.get('token') ?? '');
    const [eventId, date, extra] = selected.split('/');
    if (!eventId || !date || extra !== undefined) return fail(400, { draft: { selected, token }, message: 'Choose a calendar event.' });
    try { setChecklistEventLink(db, userId, householdId, params.id, token, { eventId, date }); }
    catch { return fail(409, { draft: { selected, token }, message: 'This event or link changed. Reload this page and choose a current date.' }); }
    redirect(303, `/lists/${params.id}`);
  },
  remove: async ({ request, params }) => {
    const { db, userId, householdId } = await checklistParent(request);
    const fields = await request.formData();
    const removeToken = String(fields.get('token') ?? '');
    try { setChecklistEventLink(db, userId, householdId, params.id, removeToken, null); }
    catch { return fail(409, { removeToken, message: 'This link changed. Reload this page before removing it.' }); }
    redirect(303, `/lists/${params.id}`);
  }
} satisfies Actions;
