import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getIdentityServices } from '../../lib/server/runtime';
import { localDate, occurrenceDates } from '../../lib/chores/recurrence';
import { parseView, viewHeading, viewRange } from '../../lib/calendar/navigation';
import { addCalendarDays } from '../../lib/calendar/dates';
import { addUnscheduled, archiveUnscheduled, cancelEvent, cancelOccurrence, createEvent, listEvents, listUnscheduled, scheduleUnscheduled, updateEvent, updateUnscheduled, type EventInput } from '../../lib/server/calendar';

type Services = ReturnType<typeof getIdentityServices>;

/**
 * Saving keeps the parent on the view they submitted from. When none of the saved event's
 * occurrences fall in that view, return its first date so the confirmation can link there.
 */
function savedElsewhere(db: Services['db'], actor: string, household: string, url: URL, id: string, start: string): string | null {
  try {
    const range = viewRange(url.searchParams.get('date') ?? '', parseView(url.searchParams.get('view')));
    if (listEvents(db, actor, household, range.start, range.end).some(event => event.id === id)) return null;
  } catch { /* No valid view in the action URL: fall through to the event's own dates. */ }
  try { return listEvents(db, actor, household, start, addCalendarDays(start, 365)).find(event => event.id === id)?.date ?? null; }
  catch { return null; }
}

async function principal(request: Request) {
  let services;
  try { services = getIdentityServices(); } catch { error(503, 'Identity service unavailable'); }
  const session = await services.auth.api.getSession({ headers: request.headers });
  if (!session) redirect(303, '/sign-in');
  const member = services.db.prepare('SELECT household_id AS householdId, role FROM active_membership WHERE user_id = ? ORDER BY household_id LIMIT 1').get(session.user.id) as { householdId: string; role: 'parent' | 'kid' } | undefined;
  if (!member) error(403, 'No household access');
  return { ...services, actor: session.user.id, ...member };
}

function parseEvent(form: FormData): EventInput {
  return { title: String(form.get('title') ?? ''), date: String(form.get('date') ?? ''), endDate: String(form.get('endDate') ?? ''), startTime: String(form.get('startTime') ?? ''), endTime: String(form.get('endTime') ?? ''), allDay: form.has('allDay'), weekdays: form.getAll('weekday').map(Number), participants: form.getAll('participant').map(String), description: String(form.get('description') ?? ''), location: String(form.get('location') ?? '') };
}

function readImportSummary(url: URL): { added: number; skipped: number } | null {
  const rawAdded = url.searchParams.get('added');
  if (rawAdded === null) return null;
  const added = Number(rawAdded);
  const skipped = Number(url.searchParams.get('skipped') ?? '0');
  if (!Number.isInteger(added) || added < 0 || added > 100 || !Number.isInteger(skipped) || skipped < 0 || skipped > 100) return null;
  return { added, skipped };
}

export const load: PageServerLoad = async ({ request, url }) => {
  const { db, actor, householdId, role } = await principal(request);
  const settings = db.prepare('SELECT timezone FROM household_settings WHERE household_id = ?').get(householdId) as { timezone: string } | undefined;
  const timezone = settings?.timezone ?? 'America/Chicago';
  const today = localDate(new Date(), timezone);
  const date = url.searchParams.get('date') || today;
  try { occurrenceDates(date, date, [0]); } catch { error(400, 'Invalid calendar date'); }
  const view = parseView(url.searchParams.get('view'));
  const { start, end } = viewRange(date, view);
  const events = listEvents(db, actor, householdId, start, end);
  const members = db.prepare('SELECT u.id, u.name FROM active_membership m JOIN user u ON u.id = m.user_id WHERE m.household_id = ? ORDER BY u.name').all(householdId) as { id: string; name: string }[];
  return { date, view, start, end, heading: viewHeading(date, view), today, timezone, role, events, members, inbox: listUnscheduled(db, actor, householdId), importSummary: readImportSummary(url) };
};

export const actions = {
  saveEvent: async ({ request, url }) => {
    const { db, actor, householdId, origin, role } = await principal(request);
    if (request.headers.get('origin') !== origin || role !== 'parent') return fail(403, { message: 'Request not authorized.' });
    const form = await request.formData(), input = parseEvent(form), id = String(form.get('id') ?? ''), inbox = String(form.get('inbox') ?? '');
    let saved: string;
    try {
      if (id) { updateEvent(db, actor, householdId, id, input); saved = id; }
      else if (inbox) saved = scheduleUnscheduled(db, actor, householdId, inbox, input);
      else saved = createEvent(db, actor, householdId, input);
    }
    catch { return fail(400, { message: 'Unable to save event. Check the date, times and details and try again.', eventError: { id, inbox, input } }); }
    return { message: 'Event saved.', savedElsewhere: savedElsewhere(db, actor, householdId, url, saved, input.date) };
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
