import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getIdentityServices } from '../../lib/server/runtime';
import { localDate, occurrenceDates } from '../../lib/chores/recurrence';
import { addUnscheduled, archiveUnscheduled, cancelEvent, cancelOccurrence, createEvent, listEvents, listUnscheduled, scheduleUnscheduled, updateEvent, updateUnscheduled, type EventInput } from '../../lib/server/calendar';

async function principal(request: Request) {
  let services;
  try { services = getIdentityServices(); } catch { error(503, 'Identity service unavailable'); }
  const session = await services.auth.api.getSession({ headers: request.headers });
  if (!session) redirect(303, '/sign-in');
  const member = services.db.prepare('SELECT household_id AS householdId, role FROM membership WHERE user_id = ? ORDER BY household_id LIMIT 1').get(session.user.id) as { householdId: string; role: 'parent' | 'kid' } | undefined;
  if (!member) error(403, 'No household access');
  return { ...services, actor: session.user.id, ...member };
}

function parseEvent(form: FormData): EventInput {
  return { title: String(form.get('title') ?? ''), date: String(form.get('date') ?? ''), endDate: String(form.get('endDate') ?? ''), startTime: String(form.get('startTime') ?? ''), endTime: String(form.get('endTime') ?? ''), allDay: form.has('allDay'), weekdays: form.getAll('weekday').map(Number), participants: form.getAll('participant').map(String), description: String(form.get('description') ?? ''), location: String(form.get('location') ?? '') };
}

export const load: PageServerLoad = async ({ request, url }) => {
  const { db, actor, householdId, role } = await principal(request);
  const settings = db.prepare('SELECT timezone FROM household_settings WHERE household_id = ?').get(householdId) as { timezone: string } | undefined;
  const timezone = settings?.timezone ?? 'America/Chicago';
  const date = url.searchParams.get('date') || localDate(new Date(), timezone);
  try { occurrenceDates(date, date, [0]); } catch { error(400, 'Invalid calendar date'); }
  const view = ['day', 'week', 'month'].includes(url.searchParams.get('view') ?? '') ? url.searchParams.get('view')! : 'week';
  const first = new Date(`${date}T00:00:00Z`), last = new Date(first);
  if (view === 'week') { first.setUTCDate(first.getUTCDate() - first.getUTCDay()); last.setTime(first.getTime()); last.setUTCDate(last.getUTCDate() + 6); }
  if (view === 'month') { first.setUTCDate(1); last.setUTCMonth(last.getUTCMonth() + 1, 0); }
  const start = first.toISOString().slice(0, 10), end = last.toISOString().slice(0, 10);
  const events = listEvents(db, actor, householdId, start, end);
  const members = db.prepare('SELECT u.id, u.name FROM membership m JOIN user u ON u.id = m.user_id WHERE m.household_id = ? ORDER BY u.name').all(householdId) as { id: string; name: string }[];
  return { date, view, start, end, timezone, role, events, members, inbox: listUnscheduled(db, actor, householdId) };
};

export const actions = {
  saveEvent: async ({ request }) => {
    const { db, actor, householdId, origin, role } = await principal(request);
    if (request.headers.get('origin') !== origin || role !== 'parent') return fail(403, { message: 'Request not authorized.' });
    const form = await request.formData(), input = parseEvent(form), id = String(form.get('id') ?? ''), inbox = String(form.get('inbox') ?? '');
    try { if (id) updateEvent(db, actor, householdId, id, input); else if (inbox) scheduleUnscheduled(db, actor, householdId, inbox, input); else createEvent(db, actor, householdId, input); }
    catch { return fail(400, { message: 'Unable to save event. Check the date, times and details and try again.', eventError: { id, inbox, input } }); }
    return { message: 'Event saved.' };
  },
  cancel: async ({ request }) => {
    const { db, actor, householdId, origin, role } = await principal(request);
    if (request.headers.get('origin') !== origin || role !== 'parent') return fail(403, { message: 'Request not authorized.' });
    const form = await request.formData();
    try { if (form.get('occurrence')) cancelOccurrence(db, actor, householdId, String(form.get('id') ?? ''), String(form.get('occurrence'))); else cancelEvent(db, actor, householdId, String(form.get('id') ?? '')); }
    catch { return fail(400, { message: 'Unable to cancel event.' }); }
    return { message: 'Event cancelled.' };
  },
  addInbox: async ({ request }) => {
    const { db, actor, householdId, origin, role } = await principal(request);
    if (request.headers.get('origin') !== origin || role !== 'parent') return fail(403, { message: 'Request not authorized.' });
    const form = await request.formData();
    const input = { title: String(form.get('title') ?? ''), description: String(form.get('description') ?? ''), ownerId: String(form.get('owner') ?? '') }; const id = String(form.get('id') ?? '');
    try { if (id) updateUnscheduled(db, actor, householdId, id, input); else addUnscheduled(db, actor, householdId, input); }
    catch { return fail(400, { message: 'Unable to save item. Check the details and try again.', inboxError: { id, input } }); }
    return { message: 'Item added.' };
  },
  archive: async ({ request }) => {
    const { db, actor, householdId, origin, role } = await principal(request);
    if (request.headers.get('origin') !== origin || role !== 'parent') return fail(403, { message: 'Request not authorized.' });
    const form = await request.formData();
    try { archiveUnscheduled(db, actor, householdId, String(form.get('id') ?? '')); }
    catch { return fail(400, { message: 'Unable to archive item.' }); }
    return { message: 'Item archived.' };
  }
} satisfies Actions;
