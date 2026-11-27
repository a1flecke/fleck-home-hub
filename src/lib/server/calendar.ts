import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { addCalendarDays } from '../calendar/dates';
import { hasRecurrenceOccurrence, occurrenceDates } from '../chores/recurrence';

const QUERY_CHUNK_SIZE = 500;

export type EventInput = { title: string; date: string; endDate?: string; startTime?: string; endTime?: string; allDay: boolean; weekdays?: number[]; participants?: string[]; description?: string; location?: string };
type Row = { id: string; title: string; start_date: string; end_date: string | null; start_time: string | null; end_time: string | null; all_day: number; weekdays: string | null; description: string | null; location: string | null };

function requireMember(db: Database.Database, actor: string, household: string, parent = false) {
  const member = db.prepare('SELECT role FROM active_membership WHERE user_id = ? AND household_id = ?').get(actor, household) as { role: string } | undefined;
  if (!member || (parent && member.role !== 'parent')) throw new Error('Not authorized');
}

function validate(input: EventInput) {
  const title = input.title.trim();
  const description = input.description?.trim() || null;
  const location = input.location?.trim() || null;
  occurrenceDates(input.date, input.date, [0]);
  if (input.endDate) occurrenceDates(input.endDate, input.endDate, [0]);
  if (!title || title.length > 120 || (description && description.length > 1000) || (location && location.length > 200) || (input.endDate && input.endDate < input.date)) throw new Error('Invalid event');
  if (!input.allDay && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.startTime ?? '') || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.endTime ?? '') || input.endTime! <= input.startTime!)) throw new Error('Invalid event time');
  if (input.weekdays?.length) {
    occurrenceDates(input.date, input.date, input.weekdays);
    if (!hasRecurrenceOccurrence(input.date, input.endDate, input.weekdays)) throw new Error('Recurrence has no occurrences');
  }
  if (input.endDate && !input.weekdays?.length) throw new Error('End date requires recurrence');
  return { title, description, location };
}

export function createEvent(db: Database.Database, actor: string, household: string, input: EventInput): string {
  const values = validate(input);
  return db.transaction(() => {
    requireMember(db, actor, household, true);
    const participants = [...new Set(input.participants ?? [])];
    if (participants.length > 100 || participants.some(id => !db.prepare('SELECT 1 FROM active_membership WHERE user_id = ? AND household_id = ?').get(id, household))) throw new Error('Invalid participants');
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO calendar_event (id, household_id, creator_id, title, description, location, start_date, end_date, start_time, end_time, all_day, weekdays, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, household, actor, values.title, values.description, values.location, input.date, input.endDate || null, input.allDay ? null : input.startTime, input.allDay ? null : input.endTime, Number(input.allDay), input.weekdays?.length ? JSON.stringify([...new Set(input.weekdays)].sort()) : null, now, now);
    for (const user of participants) db.prepare('INSERT INTO calendar_participant VALUES (?, ?, ?)').run(id, household, user);
    return id;
  }).immediate();
}

export function listEvents(db: Database.Database, actor: string, household: string, from: string, through: string) {
  requireMember(db, actor, household);
  return householdEventOccurrences(db, household, from, through);
}

export type UpcomingEvent = { id: string; date: string; title: string; startTime: string | null; endTime: string | null; allDay: boolean };

/** Projects a bounded range to the fields a dashboard card needs; no descriptions, locations or participants. */
export function listUpcomingEvents(db: Database.Database, actor: string, household: string, from: string, through: string): UpcomingEvent[] {
  requireMember(db, actor, household);
  return householdEventOccurrences(db, household, from, through, { includeParticipants: false })
    .map(({ id, date, title, startTime, endTime, allDay }) => ({ id, date, title, startTime, endTime, allDay }));
}

function batchExceptions(db: Database.Database, eventIds: string[], from: string, through: string): Map<string, Set<string>> {
  const byEvent = new Map<string, Set<string>>();
  for (let offset = 0; offset < eventIds.length; offset += QUERY_CHUNK_SIZE) {
    const chunk = eventIds.slice(offset, offset + QUERY_CHUNK_SIZE);
    const placeholders = chunk.map(() => '?').join(', ');
    const rows = db.prepare(`SELECT event_id, occurrence_date FROM calendar_exception WHERE occurrence_date BETWEEN ? AND ? AND event_id IN (${placeholders})`)
      .all(from, through, ...chunk) as { event_id: string; occurrence_date: string }[];
    for (const row of rows) {
      let dates = byEvent.get(row.event_id);
      if (!dates) { dates = new Set(); byEvent.set(row.event_id, dates); }
      dates.add(row.occurrence_date);
    }
  }
  return byEvent;
}

function batchParticipants(db: Database.Database, eventIds: string[]): Map<string, string[]> {
  const byEvent = new Map<string, string[]>();
  for (let offset = 0; offset < eventIds.length; offset += QUERY_CHUNK_SIZE) {
    const chunk = eventIds.slice(offset, offset + QUERY_CHUNK_SIZE);
    const placeholders = chunk.map(() => '?').join(', ');
    const rows = db.prepare(`SELECT event_id, user_id FROM calendar_participant WHERE event_id IN (${placeholders})`)
      .all(...chunk) as { event_id: string; user_id: string }[];
    for (const row of rows) {
      let users = byEvent.get(row.event_id);
      if (!users) { users = []; byEvent.set(row.event_id, users); }
      users.push(row.user_id);
    }
  }
  return byEvent;
}

/**
 * Performs NO caller authorization: it trusts that `household` came from a verified member session
 * or a verified display credential. Only display.ts and listEvents may call it (architecture-tested).
 */
export function householdEventOccurrences(
  db: Database.Database,
  household: string,
  from: string,
  through: string,
  options?: { includeParticipants?: boolean }
) {
  occurrenceDates(from, through, [0]);
  const includeParticipants = options?.includeParticipants ?? true;
  const rows = db.prepare(
    'SELECT * FROM calendar_event WHERE household_id = ? AND cancelled = 0 AND start_date <= ? AND ((weekdays IS NULL AND start_date >= ?) OR (weekdays IS NOT NULL AND (end_date IS NULL OR end_date >= ?)))'
  ).all(household, through, from, from) as Row[];

  const candidates = rows.flatMap(row => {
    const weekdays = row.weekdays ? JSON.parse(row.weekdays) as number[] : [];
    const start = from > row.start_date ? from : row.start_date;
    const end = row.end_date && row.end_date < through ? row.end_date : through;
    const dates = row.weekdays ? occurrenceDates(start, end, weekdays) : row.start_date >= from && row.start_date <= through ? [row.start_date] : [];
    return dates.length ? [{ row, weekdays, dates }] : [];
  });
  if (!candidates.length) return [];

  const recurringIds = candidates.filter(item => item.row.weekdays !== null).map(item => item.row.id);
  const exceptions = recurringIds.length ? batchExceptions(db, recurringIds, from, through) : new Map<string, Set<string>>();

  const active = candidates.flatMap(item => {
    const skipped = exceptions.get(item.row.id);
    const dates = skipped ? item.dates.filter(date => !skipped.has(date)) : item.dates;
    return dates.length ? [{ ...item, dates }] : [];
  });
  if (!active.length) return [];

  const participantsByEvent = includeParticipants
    ? batchParticipants(db, active.map(item => item.row.id))
    : new Map<string, string[]>();

  return active.flatMap(({ row, weekdays, dates }) => {
    const participants = participantsByEvent.get(row.id) ?? [];
    return dates.map(date => ({ id: row.id, title: row.title, date, seriesDate: row.start_date, endDate: row.end_date, startTime: row.start_time, endTime: row.end_time, allDay: !!row.all_day, weekdays, participants, description: row.description, location: row.location }));
  }).sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? '').localeCompare(b.startTime ?? '') || a.title.localeCompare(b.title));
}

function eventOccursOnDate(db: Database.Database, household: string, id: string, date: string): boolean {
  occurrenceDates(date, date, [0]);
  const row = db.prepare('SELECT start_date, end_date, weekdays FROM calendar_event WHERE id = ? AND household_id = ? AND cancelled = 0')
    .get(id, household) as Pick<Row, 'start_date' | 'end_date' | 'weekdays'> | undefined;
  if (!row || date < row.start_date || (row.end_date && date > row.end_date)) return false;
  if (row.weekdays) {
    if (!occurrenceDates(date, date, JSON.parse(row.weekdays) as number[]).length) return false;
  } else if (row.start_date !== date) {
    return false;
  }
  return !db.prepare('SELECT 1 FROM calendar_exception WHERE event_id = ? AND occurrence_date = ?').get(id, date);
}

export function hasEventOccurrence(db: Database.Database, actor: string, household: string, id: string, date: string): boolean {
  requireMember(db, actor, household);
  return eventOccursOnDate(db, household, id, date);
}

/**
 * Returns a date to link to when a saved event has no occurrence in the viewed range, or null if
 * it already appears in that view (or does not exist). For recurring series, searches forward from
 * the viewed range before falling back to earlier occurrences.
 */
export function findSavedEventElsewhere(
  db: Database.Database,
  actor: string,
  household: string,
  id: string,
  viewedRange: { start: string; end: string } | null
): string | null {
  requireMember(db, actor, household);
  const row = db.prepare('SELECT id, start_date, end_date, weekdays FROM calendar_event WHERE id = ? AND household_id = ? AND cancelled = 0')
    .get(id, household) as Pick<Row, 'id' | 'start_date' | 'end_date' | 'weekdays'> | undefined;
  if (!row) return null;
  if (!row.weekdays) {
    if (viewedRange && row.start_date >= viewedRange.start && row.start_date <= viewedRange.end) return null;
    return row.start_date;
  }

  const weekdays = JSON.parse(row.weekdays) as number[];
  const exceptions = new Set(db.prepare('SELECT occurrence_date FROM calendar_exception WHERE event_id = ?').pluck().all(row.id) as string[]);
  const uncancelledIn = (from: string, through: string): string[] => {
    const start = from > row.start_date ? from : row.start_date;
    const end = row.end_date && row.end_date < through ? row.end_date : through;
    if (start > end) return [];
    return occurrenceDates(start, end, weekdays).filter(date => !exceptions.has(date));
  };

  if (viewedRange && uncancelledIn(viewedRange.start, viewedRange.end).length > 0) return null;
  const forwardFrom = viewedRange && viewedRange.start > row.start_date ? viewedRange.start : row.start_date;
  const upcoming = uncancelledIn(forwardFrom, addCalendarDays(forwardFrom, 365));
  if (upcoming.length > 0) return upcoming[0];

  if (viewedRange && viewedRange.start > row.start_date) {
    const recentPast = uncancelledIn(addCalendarDays(viewedRange.start, -365), addCalendarDays(viewedRange.start, -1));
    if (recentPast.length > 0) return recentPast[recentPast.length - 1];
  }
  return uncancelledIn(row.start_date, addCalendarDays(row.start_date, 365))[0] ?? null;
}

export function cancelOccurrence(db: Database.Database, actor: string, household: string, id: string, date: string): void {
  occurrenceDates(date, date, [0]);
  db.transaction(() => {
    requireMember(db, actor, household, true);
    const event = db.prepare('SELECT start_date, end_date, weekdays FROM calendar_event WHERE id = ? AND household_id = ? AND cancelled = 0')
      .get(id, household) as Pick<Row, 'start_date' | 'end_date' | 'weekdays'> | undefined;
    if (!event || !event.weekdays) throw new Error('Only repeating event occurrences can be cancelled');
    const inRange = date >= event.start_date && (!event.end_date || date <= event.end_date);
    if (!inRange || !occurrenceDates(date, date, JSON.parse(event.weekdays) as number[]).length) throw new Error('Event occurrence not found');
    if (db.prepare('SELECT 1 FROM calendar_exception WHERE event_id = ? AND occurrence_date = ?').get(id, date)) throw new Error('Event occurrence not found');
    db.prepare('INSERT INTO calendar_exception VALUES (?, ?)').run(id, date);
  }).immediate();
}

export function updateEvent(db: Database.Database, actor: string, household: string, id: string, input: EventInput): void {
  const values = validate(input);
  db.transaction(() => {
    requireMember(db, actor, household, true);
    const participants = [...new Set(input.participants ?? [])];
    if (participants.length > 100 || participants.some(user => !db.prepare('SELECT 1 FROM active_membership WHERE user_id = ? AND household_id = ?').get(user, household))) throw new Error('Invalid participants');
    const changed = db.prepare('UPDATE calendar_event SET title = ?, description = ?, location = ?, start_date = ?, end_date = ?, start_time = ?, end_time = ?, all_day = ?, weekdays = ?, updated_at = ? WHERE id = ? AND household_id = ? AND cancelled = 0').run(values.title, values.description, values.location, input.date, input.endDate || null, input.allDay ? null : input.startTime, input.allDay ? null : input.endTime, Number(input.allDay), input.weekdays?.length ? JSON.stringify([...new Set(input.weekdays)].sort()) : null, new Date().toISOString(), id, household);
    if (!changed.changes) throw new Error('Event not found');
    db.prepare('DELETE FROM calendar_participant WHERE event_id = ?').run(id);
    for (const user of participants) db.prepare('INSERT INTO calendar_participant VALUES (?, ?, ?)').run(id, household, user);
  }).immediate();
}

export function cancelEvent(db: Database.Database, actor: string, household: string, id: string): void {
  db.transaction(() => {
    requireMember(db, actor, household, true);
    if (!db.prepare('UPDATE calendar_event SET cancelled = 1, updated_at = ? WHERE id = ? AND household_id = ? AND cancelled = 0').run(new Date().toISOString(), id, household).changes) throw new Error('Event not found');
  }).immediate();
}

type InboxInput = { title: string; description?: string; ownerId?: string };
function validateInbox(db: Database.Database, household: string, input: InboxInput) {
  const title = input.title.trim();
  const description = input.description?.trim() || null;
  if (!title || title.length > 120 || (description && description.length > 1000) || (input.ownerId && !db.prepare('SELECT 1 FROM active_membership WHERE user_id = ? AND household_id = ?').get(input.ownerId, household))) throw new Error('Invalid item');
  return { title, description };
}
export function addUnscheduled(db: Database.Database, actor: string, household: string, input: InboxInput): string {
  return db.transaction(() => {
    requireMember(db, actor, household, true);
    const values = validateInbox(db, household, input);
    const id = randomUUID(), now = new Date().toISOString();
    db.prepare('INSERT INTO calendar_inbox (id, household_id, creator_id, title, description, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, household, actor, values.title, values.description, input.ownerId || null, now, now);
    return id;
  }).immediate();
}
export function listUnscheduled(db: Database.Database, actor: string, household: string) {
  requireMember(db, actor, household);
  return db.prepare("SELECT id, title, description, owner_id AS ownerId FROM calendar_inbox WHERE household_id = ? AND state = 'open' ORDER BY created_at, id").all(household) as { id: string; title: string; description: string | null; ownerId: string | null }[];
}
export function updateUnscheduled(db: Database.Database, actor: string, household: string, id: string, input: InboxInput): void {
  db.transaction(() => {
    requireMember(db, actor, household, true);
    const values = validateInbox(db, household, input);
    if (!db.prepare("UPDATE calendar_inbox SET title = ?, description = ?, owner_id = ?, updated_at = ? WHERE id = ? AND household_id = ? AND state = 'open'").run(values.title, values.description, input.ownerId || null, new Date().toISOString(), id, household).changes) throw new Error('Item not found');
  }).immediate();
}
export function archiveUnscheduled(db: Database.Database, actor: string, household: string, id: string): void {
  db.transaction(() => {
    requireMember(db, actor, household, true);
    if (!db.prepare("UPDATE calendar_inbox SET state = 'archived', updated_at = ? WHERE id = ? AND household_id = ? AND state = 'open'").run(new Date().toISOString(), id, household).changes) throw new Error('Item not found');
  }).immediate();
}
export function scheduleUnscheduled(db: Database.Database, actor: string, household: string, id: string, input: EventInput): string {
  return db.transaction(() => {
    requireMember(db, actor, household, true);
    if (!db.prepare("SELECT 1 FROM calendar_inbox WHERE id = ? AND household_id = ? AND state = 'open'").get(id, household)) throw new Error('Item not found');
    const eventId = createEvent(db, actor, household, input);
    db.prepare("UPDATE calendar_inbox SET state = 'scheduled', event_id = ?, updated_at = ? WHERE id = ? AND household_id = ?").run(eventId, new Date().toISOString(), id, household);
    return eventId;
  }).immediate();
}
