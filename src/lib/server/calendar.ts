import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { occurrenceDates } from '../chores/recurrence';

export type EventInput = { title: string; date: string; endDate?: string; startTime?: string; endTime?: string; allDay: boolean; weekdays?: number[]; participants?: string[]; description?: string; location?: string };
type Row = { id: string; title: string; start_date: string; end_date: string | null; start_time: string | null; end_time: string | null; all_day: number; weekdays: string | null; description: string | null; location: string | null };

function requireMember(db: Database.Database, actor: string, household: string, parent = false) {
  const member = db.prepare('SELECT role FROM membership WHERE user_id = ? AND household_id = ?').get(actor, household) as { role: string } | undefined;
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
  if (input.weekdays?.length) occurrenceDates(input.date, input.date, input.weekdays);
  if (input.endDate && !input.weekdays?.length) throw new Error('End date requires recurrence');
  return { title, description, location };
}

export function createEvent(db: Database.Database, actor: string, household: string, input: EventInput): string {
  const values = validate(input);
  return db.transaction(() => {
    requireMember(db, actor, household, true);
    const participants = [...new Set(input.participants ?? [])];
    if (participants.length > 100 || participants.some(id => !db.prepare('SELECT 1 FROM membership WHERE user_id = ? AND household_id = ?').get(id, household))) throw new Error('Invalid participants');
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO calendar_event (id, household_id, creator_id, title, description, location, start_date, end_date, start_time, end_time, all_day, weekdays, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, household, actor, values.title, values.description, values.location, input.date, input.endDate || null, input.allDay ? null : input.startTime, input.allDay ? null : input.endTime, Number(input.allDay), input.weekdays?.length ? JSON.stringify([...new Set(input.weekdays)].sort()) : null, now, now);
    for (const user of participants) db.prepare('INSERT INTO calendar_participant VALUES (?, ?, ?)').run(id, household, user);
    return id;
  }).immediate();
}

export function listEvents(db: Database.Database, actor: string, household: string, from: string, through: string) {
  requireMember(db, actor, household);
  occurrenceDates(from, through, [0]);
  const rows = db.prepare('SELECT * FROM calendar_event WHERE household_id = ? AND cancelled = 0 AND start_date <= ? AND (end_date IS NULL OR end_date >= ?)').all(household, through, from) as Row[];
  return rows.flatMap(row => {
    const start = from > row.start_date ? from : row.start_date;
    const end = row.end_date && row.end_date < through ? row.end_date : through;
    const dates = row.weekdays ? occurrenceDates(start, end, JSON.parse(row.weekdays)) : row.start_date >= from && row.start_date <= through ? [row.start_date] : [];
    const participants = (db.prepare('SELECT user_id FROM calendar_participant WHERE event_id = ?').all(row.id) as { user_id: string }[]).map(item => item.user_id);
    return dates.filter(date => !db.prepare('SELECT 1 FROM calendar_exception WHERE event_id = ? AND occurrence_date = ?').get(row.id, date)).map(date => ({ id: row.id, title: row.title, date, seriesDate: row.start_date, endDate: row.end_date, startTime: row.start_time, endTime: row.end_time, allDay: !!row.all_day, weekdays: row.weekdays ? JSON.parse(row.weekdays) as number[] : [], participants, description: row.description, location: row.location }));
  }).sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? '').localeCompare(b.startTime ?? '') || a.title.localeCompare(b.title));
}

export function cancelOccurrence(db: Database.Database, actor: string, household: string, id: string, date: string): void {
  db.transaction(() => {
    requireMember(db, actor, household, true);
    if (!listEvents(db, actor, household, date, date).some(event => event.id === id)) throw new Error('Event occurrence not found');
    db.prepare('INSERT INTO calendar_exception VALUES (?, ?)').run(id, date);
  }).immediate();
}

export function updateEvent(db: Database.Database, actor: string, household: string, id: string, input: EventInput): void {
  const values = validate(input);
  db.transaction(() => {
    requireMember(db, actor, household, true);
    const participants = [...new Set(input.participants ?? [])];
    if (participants.length > 100 || participants.some(user => !db.prepare('SELECT 1 FROM membership WHERE user_id = ? AND household_id = ?').get(user, household))) throw new Error('Invalid participants');
    const changed = db.prepare('UPDATE calendar_event SET title = ?, description = ?, location = ?, start_date = ?, end_date = ?, start_time = ?, end_time = ?, all_day = ?, weekdays = ?, updated_at = ? WHERE id = ? AND household_id = ? AND cancelled = 0').run(values.title, values.description, values.location, input.date, input.endDate || null, input.allDay ? null : input.startTime, input.allDay ? null : input.endTime, Number(input.allDay), input.weekdays?.length ? JSON.stringify([...new Set(input.weekdays)].sort()) : null, new Date().toISOString(), id, household);
    if (!changed.changes) throw new Error('Event not found');
    db.prepare('DELETE FROM calendar_participant WHERE event_id = ?').run(id);
    for (const user of participants) db.prepare('INSERT INTO calendar_participant VALUES (?, ?, ?)').run(id, household, user);
  }).immediate();
}

export function cancelEvent(db: Database.Database, actor: string, household: string, id: string): void {
  requireMember(db, actor, household, true);
  if (!db.prepare('UPDATE calendar_event SET cancelled = 1, updated_at = ? WHERE id = ? AND household_id = ? AND cancelled = 0').run(new Date().toISOString(), id, household).changes) throw new Error('Event not found');
}

type InboxInput = { title: string; description?: string; ownerId?: string };
function validateInbox(db: Database.Database, household: string, input: InboxInput) {
  const title = input.title.trim();
  const description = input.description?.trim() || null;
  if (!title || title.length > 120 || (description && description.length > 1000) || (input.ownerId && !db.prepare('SELECT 1 FROM membership WHERE user_id = ? AND household_id = ?').get(input.ownerId, household))) throw new Error('Invalid item');
  return { title, description };
}
export function addUnscheduled(db: Database.Database, actor: string, household: string, input: InboxInput): string {
  requireMember(db, actor, household, true);
  const values = validateInbox(db, household, input);
  const id = randomUUID(), now = new Date().toISOString();
  db.prepare('INSERT INTO calendar_inbox (id, household_id, creator_id, title, description, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, household, actor, values.title, values.description, input.ownerId || null, now, now);
  return id;
}
export function listUnscheduled(db: Database.Database, actor: string, household: string) {
  requireMember(db, actor, household);
  return db.prepare("SELECT id, title, description, owner_id AS ownerId FROM calendar_inbox WHERE household_id = ? AND state = 'open' ORDER BY created_at, id").all(household) as { id: string; title: string; description: string | null; ownerId: string | null }[];
}
export function updateUnscheduled(db: Database.Database, actor: string, household: string, id: string, input: InboxInput): void {
  requireMember(db, actor, household, true);
  const values = validateInbox(db, household, input);
  if (!db.prepare("UPDATE calendar_inbox SET title = ?, description = ?, owner_id = ?, updated_at = ? WHERE id = ? AND household_id = ? AND state = 'open'").run(values.title, values.description, input.ownerId || null, new Date().toISOString(), id, household).changes) throw new Error('Item not found');
}
export function archiveUnscheduled(db: Database.Database, actor: string, household: string, id: string): void {
  requireMember(db, actor, household, true);
  if (!db.prepare("UPDATE calendar_inbox SET state = 'archived', updated_at = ? WHERE id = ? AND household_id = ? AND state = 'open'").run(new Date().toISOString(), id, household).changes) throw new Error('Item not found');
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
