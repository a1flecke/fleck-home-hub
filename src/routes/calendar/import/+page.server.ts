import { error, fail, redirect } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import type { Actions, PageServerLoad } from './$types';
import { localDate, occurrenceDates } from '../../../lib/chores/recurrence';
import { parseView, type CalendarView } from '../../../lib/calendar/navigation';
import {
  importActions,
  MAX_ICS_BYTES,
  MAX_ICS_EVENTS,
  WARNING_LABELS,
  type IcsParseError,
  type ImportAction,
  type ImportDecision,
  type ImportWarningCode
} from '../../../lib/calendar/ics';
import {
  CalendarImportConflictError,
  CalendarImportKeyConflictError,
  CalendarImportValidationError,
  confirmCalendarImport,
  reviewCalendarImport,
  reviewCalendarImportDecisions
} from '../../../lib/server/calendar-import';
import { getIdentityServices } from '../../../lib/server/runtime';

const MAX_REVIEW_BODY_BYTES = 320 * 1024;
const MAX_CONFIRM_BODY_BYTES = 384 * 1024;
const VALID_WARNINGS = new Set<string>(Object.keys(WARNING_LABELS));

async function boundedForm(request: Request, maxBytes: number): Promise<FormData | null> {
  const declared = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!request.body) return request.formData();
  const reader = request.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel(); return null; }
      chunks.push(new Uint8Array(value));
    }
  } catch { return null; }
  const contentType = request.headers.get('content-type') ?? '';
  try {
    return await new Request(request.url, {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: new Blob(chunks, { type: contentType })
    }).formData();
  } catch { return null; }
}

async function parentPrincipal(request: Request) {
  let services;
  try { services = getIdentityServices(); } catch { error(503, 'Identity service unavailable'); }
  const session = await services.auth.api.getSession({ headers: request.headers });
  if (!session) redirect(303, '/sign-in');
  const member = services.db.prepare(
    'SELECT household_id AS householdId, role FROM active_membership WHERE user_id = ? ORDER BY household_id LIMIT 1'
  ).get(session.user.id) as { householdId: string; role: 'parent' | 'kid' } | undefined;
  if (!member || member.role !== 'parent') error(403, 'Only a parent can import calendar events');
  return { ...services, actor: session.user.id, householdId: member.householdId };
}

function readContext(url: URL, today: string): { date: string; view: CalendarView } {
  const rawDate = url.searchParams.get('date');
  const date = rawDate || today;
  try { occurrenceDates(date, date, [0]); } catch { error(400, 'Invalid calendar date'); }
  return { date, view: parseView(url.searchParams.get('view')) };
}

function parseErrorMessage(code: IcsParseError): { status: 400 | 413; message: string } {
  if (code === 'too_large') {
    return { status: 413, message: 'The calendar file is too large (maximum 256 KB). Export a smaller date range and try again.' };
  }
  if (code === 'too_many') {
    return { status: 400, message: `Import at most ${MAX_ICS_EVENTS} events at a time. Split the file into smaller date ranges and try again.` };
  }
  if (code === 'no_events') {
    return { status: 400, message: 'No calendar events (VEVENT entries) were found. Check the file or pasted text and try again.' };
  }
  return { status: 400, message: 'Choose a .ics calendar file or paste iCalendar text to review.' };
}

function decisionsFrom(form: FormData): { decisions: ImportDecision[]; importKey: string } | null {
  const importKey = String(form.get('importKey') ?? '').trim();
  const rowCount = Number(form.get('rowCount'));
  if (!importKey || importKey.length > 100 || !Number.isInteger(rowCount) || rowCount < 1 || rowCount > MAX_ICS_EVENTS) return null;
  const decisions: ImportDecision[] = [];
  for (let index = 0; index < rowCount; index += 1) {
    const action = String(form.get(`action-${index}`) ?? '');
    if (!importActions.includes(action as ImportAction)) return null;
    const rawWeekdays = form.getAll(`weekday-${index}`).map(value => Number(value));
    if (rawWeekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6)) return null;
    const warnings = form.getAll(`warning-${index}`)
      .map(String)
      .filter(code => VALID_WARNINGS.has(code)) as ImportWarningCode[];
    const uid = String(form.get(`uid-${index}`) ?? '').trim();
    decisions.push({
      key: String(form.get(`key-${index}`) ?? ''),
      sourceUid: uid || null,
      originalSummary: String(form.get(`summary-${index}`) ?? ''),
      action: action as ImportAction,
      title: String(form.get(`title-${index}`) ?? ''),
      date: String(form.get(`date-${index}`) ?? ''),
      endDate: String(form.get(`endDate-${index}`) ?? ''),
      allDay: form.has(`allDay-${index}`),
      startTime: String(form.get(`startTime-${index}`) ?? ''),
      endTime: String(form.get(`endTime-${index}`) ?? ''),
      weekdays: rawWeekdays,
      location: String(form.get(`location-${index}`) ?? ''),
      description: String(form.get(`description-${index}`) ?? ''),
      participants: form.getAll(`participant-${index}`).map(String).filter(Boolean),
      warnings
    });
  }
  return { decisions, importKey };
}

export const load: PageServerLoad = async ({ request, url, setHeaders }) => {
  setHeaders({ 'cache-control': 'no-store' });
  const { db, householdId } = await parentPrincipal(request);
  const settings = db.prepare('SELECT timezone FROM household_settings WHERE household_id = ?').get(householdId) as { timezone: string } | undefined;
  const timezone = settings?.timezone ?? 'America/Chicago';
  const today = localDate(new Date(), timezone);
  const { date, view } = readContext(url, today);
  const members = db.prepare(
    'SELECT u.id, u.name FROM active_membership m JOIN user u ON u.id = m.user_id WHERE m.household_id = ? ORDER BY u.name, u.id'
  ).all(householdId) as { id: string; name: string }[];
  return { date, view, today, timezone, members };
};

export const actions = {
  review: async ({ request }) => {
    const { db, actor, householdId, origin } = await parentPrincipal(request);
    if (request.headers.get('origin') !== origin) return fail(403, { message: 'Request not authorized.' });

    const form = await boundedForm(request, MAX_REVIEW_BODY_BYTES);
    if (!form) {
      return fail(413, { message: 'The calendar file is too large (maximum 256 KB). Export a smaller date range and try again.' });
    }

    const pasted = String(form.get('ics') ?? '');
    const uploaded = form.get('file');
    let icsText = pasted;
    let sourceName = '';

    if (uploaded instanceof File && uploaded.size > 0) {
      if (uploaded.size > MAX_ICS_BYTES) {
        return fail(413, { message: 'The calendar file is too large (maximum 256 KB). Export a smaller date range and try again.', ics: pasted });
      }
      sourceName = uploaded.name.slice(0, 120);
      icsText = await uploaded.text();
    }

    try {
      const outcome = reviewCalendarImport(db, actor, householdId, icsText);
      if ('error' in outcome) {
        const mapped = parseErrorMessage(outcome.error);
        return fail(mapped.status, { message: mapped.message, ics: pasted });
      }
      return { review: outcome.review, importKey: randomUUID(), sourceName };
    } catch (err) {
      if (err instanceof Error && err.message === 'Not authorized') return fail(403, { message: 'Request not authorized.' });
      throw err;
    }
  },
  confirm: async ({ request, url }) => {
    const { db, actor, householdId, origin } = await parentPrincipal(request);
    if (request.headers.get('origin') !== origin) return fail(403, { message: 'Request not authorized.' });

    const form = await boundedForm(request, MAX_CONFIRM_BODY_BYTES);
    if (!form) {
      return fail(413, { message: 'The submitted import review was too large. Import fewer events at a time.' });
    }

    const parsed = decisionsFrom(form);
    if (!parsed) {
      return fail(400, { message: 'The submitted import review was not valid. Upload or paste the calendar again.' });
    }

    const settings = db.prepare('SELECT timezone FROM household_settings WHERE household_id = ?').get(householdId) as { timezone: string } | undefined;
    const today = localDate(new Date(), settings?.timezone ?? 'America/Chicago');
    const context = readContext(url, today);

    try {
      const result = confirmCalendarImport(db, actor, householdId, parsed.decisions, parsed.importKey);
      const targetDate = result.firstDate ?? context.date;
      redirect(303, `/calendar?date=${encodeURIComponent(targetDate)}&view=${context.view}&added=${result.added}&skipped=${result.skipped}`);
    } catch (err) {
      if (err instanceof CalendarImportKeyConflictError) {
        try {
          const review = reviewCalendarImportDecisions(db, actor, householdId, parsed.decisions);
          return fail(409, {
            message: 'This import confirmation was already used for different events. Review the events below and confirm again.',
            review,
            importKey: randomUUID()
          });
        } catch {
          return fail(409, { message: 'This import confirmation was already used. Upload the calendar again.' });
        }
      }
      if (err instanceof CalendarImportConflictError) {
        try {
          const review = reviewCalendarImportDecisions(db, actor, householdId, parsed.decisions);
          return fail(409, {
            message: 'The calendar changed or duplicate events were selected. Nothing was imported. Review the highlighted events and choose Import as separate event or Skip, then confirm again.',
            review,
            importKey: parsed.importKey
          });
        } catch {
          return fail(409, { message: 'The calendar changed. Nothing was imported. Upload the calendar again.' });
        }
      }
      if (err instanceof CalendarImportValidationError) {
        try {
          const review = reviewCalendarImportDecisions(db, actor, householdId, parsed.decisions);
          return fail(400, {
            message: 'Check the title, date, times, and repeat schedule on each imported event, then confirm again.',
            review,
            importKey: parsed.importKey
          });
        } catch {
          return fail(400, { message: 'Check each imported event and try again.' });
        }
      }
      if (err instanceof Error && err.message === 'Not authorized') {
        return fail(403, { message: 'Request not authorized.' });
      }
      throw err;
    }
  }
} satisfies Actions;
