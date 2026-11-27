import { randomUUID } from 'node:crypto';
import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { parseCalendarDate } from '../../../../../lib/calendar/dates';
import { parseView } from '../../../../../lib/calendar/navigation';
import { ChecklistConflict, createPreparationChecklist, listCalendarPreparation, listUnlinkedChecklists, setChecklistEventLink } from '../../../../../lib/server/checklists';
import { checklistParent } from '../../../parent-access.server';

function validatedDate(date: string): string {
  try { parseCalendarDate(date); }
  catch { error(400, 'Invalid calendar date'); }
  return date;
}

function context(url: URL, occurrence: string) {
  const date = validatedDate(url.searchParams.get('date') || occurrence);
  const view = parseView(url.searchParams.get('view') ?? 'day');
  return { date, view };
}

function returnToCalendar(url: URL, occurrence: string): never {
  const { date, view } = context(url, occurrence);
  redirect(303, `/calendar?date=${date}&view=${view}`);
}

export const load: PageServerLoad = async ({ request, url, params }) => {
  const { db, userId, householdId } = await checklistParent(request);
  const occurrence = validatedDate(params.occurrence);
  const calendar = context(url, occurrence);
  const event = listCalendarPreparation(db, userId, householdId, occurrence, occurrence).find(row => row.id === params.eventId);
  return {
    calendar,
    occurrence,
    event: event ? { title: event.title, checklists: event.checklists } : null,
    choices: event ? listUnlinkedChecklists(db, userId, householdId) : [],
    requestId: event ? randomUUID() : null
  };
};

export const actions = {
  create: async ({ request, url, params }) => {
    const { db, userId, householdId } = await checklistParent(request);
    const occurrence = { eventId: params.eventId, date: validatedDate(params.occurrence) };
    context(url, occurrence.date);
    const form = await request.formData();
    const input = {
      name: String(form.get('name') ?? ''),
      description: String(form.get('description') ?? ''),
      targetDate: '',
      shared: form.get('shared') === 'yes'
    };
    const requestId = String(form.get('requestId') ?? '');
    try { createPreparationChecklist(db, userId, householdId, occurrence, input, requestId); }
    catch (err) {
      const conflict = err instanceof ChecklistConflict;
      return fail(conflict ? 409 : 400, {
        draft: { ...input, requestId },
        createError: conflict ? 'This event or request changed. Return to the calendar and check the date.' : 'Check the list name and description, then try again.'
      });
    }
    returnToCalendar(url, occurrence.date);
  },
  attach: async ({ request, url, params }) => {
    const { db, userId, householdId } = await checklistParent(request);
    const occurrence = { eventId: params.eventId, date: validatedDate(params.occurrence) };
    context(url, occurrence.date);
    const form = await request.formData();
    const selected = String(form.get('checklist') ?? '');
    try { setChecklistEventLink(db, userId, householdId, selected, '', occurrence); }
    catch {
      return fail(409, { selected, attachError: 'That list or event is no longer available. Choose another list or return to the calendar.' });
    }
    returnToCalendar(url, occurrence.date);
  }
} satisfies Actions;
