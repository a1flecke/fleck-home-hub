import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { hasRecurrenceOccurrence, occurrenceDates } from '../chores/recurrence';
import {
  batchEventSignature,
  buildImportReview,
  buildReviewFromDecisions,
  findDuplicateMatch,
  importActions,
  MAX_DESCRIPTION_LENGTH,
  MAX_ICS_EVENTS,
  MAX_LOCATION_LENGTH,
  MAX_TITLE_LENGTH,
  normalizeWeekdays,
  parseIcsCalendar,
  type ExistingCalendarEvent,
  type IcsParseError,
  type ImportAction,
  type ImportDecision,
  type ImportOverrides,
  type ImportReview
} from '../calendar/ics';

export class CalendarImportValidationError extends Error {
  constructor(message = 'Invalid calendar import event') { super(message); }
}

export class CalendarImportConflictError extends Error {
  constructor(message = 'Calendar import conflicts with existing or duplicate events') { super(message); }
}

export class CalendarImportKeyConflictError extends Error {
  constructor(message = 'Import confirmation key reused with different events') { super(message); }
}

export type CalendarImportResult = {
  added: number;
  skipped: number;
  firstDate: string | null;
  replayed: boolean;
};

type ExistingRow = {
  id: string;
  title: string;
  start_date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  all_day: number;
  weekdays: string | null;
  source_uid: string | null;
};

function requireParent(db: Database.Database, actor: string, household: string): void {
  const member = db.prepare("SELECT 1 FROM active_membership WHERE user_id = ? AND household_id = ? AND role = 'parent'").get(actor, household);
  if (!member) throw new Error('Not authorized');
}

function householdTimezone(db: Database.Database, household: string): string {
  const row = db.prepare('SELECT timezone FROM household_settings WHERE household_id = ?').get(household) as { timezone: string } | undefined;
  return row?.timezone ?? 'America/Chicago';
}

function existingHouseholdEvents(db: Database.Database, household: string): ExistingCalendarEvent[] {
  const rows = db.prepare(`SELECT e.id, e.title, e.start_date, e.end_date, e.start_time, e.end_time, e.all_day, e.weekdays,
    (SELECT i.source_uid FROM calendar_import_item i WHERE i.event_id = e.id AND i.household_id = e.household_id AND i.source_uid IS NOT NULL LIMIT 1) AS source_uid
    FROM calendar_event e
    WHERE e.household_id = ? AND e.cancelled = 0`).all(household) as ExistingRow[];
  return rows.map(row => ({
    id: row.id,
    title: row.title,
    date: row.start_date,
    endDate: row.end_date,
    startTime: row.start_time,
    endTime: row.end_time,
    allDay: Boolean(row.all_day),
    weekdays: row.weekdays ? JSON.parse(row.weekdays) as number[] : [],
    sourceUid: row.source_uid
  }));
}

type NormalizedDecision = {
  key: string;
  sourceUid: string | null;
  action: ImportAction;
  title: string;
  date: string;
  endDate: string | null;
  allDay: boolean;
  startTime: string | null;
  endTime: string | null;
  weekdays: number[];
  location: string | null;
  description: string | null;
  participants: string[];
};

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function normalizeDecisions(decisions: readonly ImportDecision[], importKey: string): NormalizedDecision[] {
  const key = importKey.trim();
  if (!key || key.length > 100 || !Array.isArray(decisions) || decisions.length < 1 || decisions.length > MAX_ICS_EVENTS) {
    throw new CalendarImportValidationError('Invalid import batch');
  }
  const seenKeys = new Set<string>();
  return decisions.map((decision: ImportDecision): NormalizedDecision => {
    const itemKey = String(decision.key ?? '').trim();
    if (!itemKey || itemKey.length > 80 || seenKeys.has(itemKey)) {
      throw new CalendarImportValidationError('Duplicate or missing row key');
    }
    seenKeys.add(itemKey);

    if (!importActions.includes(decision.action)) {
      throw new CalendarImportValidationError('Invalid action');
    }
    const sourceUid = decision.sourceUid?.trim() ? decision.sourceUid.trim().slice(0, 255) : null;

    if (decision.action === 'skip') {
      return {
        key: itemKey,
        sourceUid,
        action: 'skip',
        title: '',
        date: '',
        endDate: null,
        allDay: false,
        startTime: null,
        endTime: null,
        weekdays: [],
        location: null,
        description: null,
        participants: []
      };
    }

    const title = decision.title.trim();
    const location = decision.location.trim() || null;
    const description = decision.description.trim() || null;
    const date = decision.date.trim();
    const endDate = decision.endDate.trim() || null;
    const allDay = Boolean(decision.allDay);
    const startTime = allDay ? null : decision.startTime.trim();
    const endTime = allDay ? null : decision.endTime.trim();
    const rawWeekdays: number[] = Array.isArray(decision.weekdays) ? decision.weekdays : [];
    if (rawWeekdays.some((day: number) => !Number.isInteger(day) || day < 0 || day > 6)) {
      throw new CalendarImportValidationError('Invalid weekdays');
    }
    const weekdays = normalizeWeekdays(rawWeekdays);
    const rawParticipants: string[] = Array.isArray(decision.participants) ? decision.participants : [];
    const participants: string[] = [...new Set(rawParticipants.map((id: string) => String(id).trim()).filter(Boolean))].sort();

    try {
      occurrenceDates(date, date, [0]);
      if (endDate) occurrenceDates(endDate, endDate, [0]);
    } catch {
      throw new CalendarImportValidationError('Invalid event date');
    }

    if (
      !title
      || title.length > MAX_TITLE_LENGTH
      || (location && location.length > MAX_LOCATION_LENGTH)
      || (description && description.length > MAX_DESCRIPTION_LENGTH)
      || (endDate && endDate < date)
      || participants.length > 100
    ) {
      throw new CalendarImportValidationError('Invalid event details');
    }

    if (!allDay) {
      if (!startTime || !endTime || !TIME_PATTERN.test(startTime) || !TIME_PATTERN.test(endTime) || endTime <= startTime) {
        throw new CalendarImportValidationError('Invalid event time');
      }
    }

    if (weekdays.length) {
      try { occurrenceDates(date, date, weekdays); } catch { throw new CalendarImportValidationError('Invalid weekdays'); }
      if (!hasRecurrenceOccurrence(date, endDate, weekdays)) {
        throw new CalendarImportValidationError('Recurrence has no occurrences');
      }
    } else if (endDate) {
      throw new CalendarImportValidationError('End date requires recurrence');
    }

    return {
      key: itemKey,
      sourceUid,
      action: decision.action,
      title,
      date,
      endDate,
      allDay,
      startTime,
      endTime,
      weekdays,
      location,
      description,
      participants
    };
  });
}

function hashPayload(normalized: readonly NormalizedDecision[]): string {
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

export function reviewCalendarImport(
  db: Database.Database,
  actor: string,
  household: string,
  icsText: string,
  overrides: ImportOverrides = {}
): { review: ImportReview } | { error: IcsParseError } {
  requireParent(db, actor, household);
  const timezone = householdTimezone(db, household);
  const parsed = parseIcsCalendar(icsText, timezone);
  if (parsed.error) return { error: parsed.error };
  const existing = existingHouseholdEvents(db, household);
  return { review: buildImportReview(parsed.events, existing, timezone, overrides) };
}

export function reviewCalendarImportDecisions(
  db: Database.Database,
  actor: string,
  household: string,
  decisions: readonly ImportDecision[]
): ImportReview {
  requireParent(db, actor, household);
  const timezone = householdTimezone(db, household);
  const existing = existingHouseholdEvents(db, household);
  return buildReviewFromDecisions(decisions, existing, timezone);
}

export function confirmCalendarImport(
  db: Database.Database,
  actor: string,
  household: string,
  decisions: readonly ImportDecision[],
  importKey: string
): CalendarImportResult {
  const normalized = normalizeDecisions(decisions, importKey);
  const key = importKey.trim();
  const payloadHash = hashPayload(normalized);

  return db.transaction(() => {
    requireParent(db, actor, household);

    // Check participant memberships for active rows before checking idempotency so forged participants are always rejected.
    const activeRows = normalized.filter(row => row.action !== 'skip');
    const checkParticipant = db.prepare('SELECT 1 FROM active_membership WHERE user_id = ? AND household_id = ?');
    for (const row of activeRows) {
      for (const participantId of row.participants) {
        if (!checkParticipant.get(participantId, household)) {
          throw new CalendarImportValidationError('Invalid participant');
        }
      }
    }

    const prior = db.prepare(
      'SELECT payload_hash, added_count, skipped_count, first_date FROM calendar_import_batch WHERE household_id = ? AND import_key = ?'
    ).get(household, key) as { payload_hash: string; added_count: number; skipped_count: number; first_date: string | null } | undefined;

    if (prior) {
      if (prior.payload_hash !== payloadHash) {
        throw new CalendarImportKeyConflictError();
      }
      return {
        added: prior.added_count,
        skipped: prior.skipped_count,
        firstDate: prior.first_date,
        replayed: true
      };
    }

    const existing = existingHouseholdEvents(db, household);
    const seenUids = new Set<string>();
    const seenSignatures = new Set<string>();

    for (const row of activeRows) {
      const existingMatch = findDuplicateMatch({
        sourceUid: row.sourceUid,
        title: row.title,
        date: row.date,
        allDay: row.allDay,
        startTime: row.startTime ?? '',
        weekdays: row.weekdays
      }, existing);
      const sig = batchEventSignature({
        title: row.title,
        date: row.date,
        allDay: row.allDay,
        startTime: row.startTime ?? '',
        weekdays: row.weekdays
      });
      const batchDup = Boolean(
        (row.sourceUid && seenUids.has(row.sourceUid))
        || (sig && seenSignatures.has(sig))
      );

      if (row.action === 'import' && (existingMatch || batchDup)) {
        throw new CalendarImportConflictError();
      }

      if (row.sourceUid) seenUids.add(row.sourceUid);
      if (sig) seenSignatures.add(sig);
    }

    const batchId = randomUUID();
    const now = new Date().toISOString();
    const skipped = normalized.length - activeRows.length;
    const firstDate = activeRows.length ? activeRows.map(row => row.date).sort()[0] : null;

    db.prepare(
      'INSERT INTO calendar_import_batch (id, household_id, actor_id, import_key, payload_hash, added_count, skipped_count, first_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(batchId, household, actor, key, payloadHash, activeRows.length, skipped, firstDate, now);

    const insertEvent = db.prepare(
      'INSERT INTO calendar_event (id, household_id, creator_id, title, description, location, start_date, end_date, start_time, end_time, all_day, weekdays, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const insertParticipant = db.prepare('INSERT INTO calendar_participant VALUES (?, ?, ?)');
    const insertImportItem = db.prepare(
      'INSERT INTO calendar_import_item (batch_id, event_id, household_id, source_uid) VALUES (?, ?, ?, ?)'
    );

    for (const row of activeRows) {
      const eventId = randomUUID();
      insertEvent.run(
        eventId,
        household,
        actor,
        row.title,
        row.description,
        row.location,
        row.date,
        row.endDate,
        row.allDay ? null : row.startTime,
        row.allDay ? null : row.endTime,
        Number(row.allDay),
        row.weekdays.length ? JSON.stringify(row.weekdays) : null,
        now,
        now
      );
      for (const participantId of row.participants) {
        insertParticipant.run(eventId, household, participantId);
      }
      insertImportItem.run(batchId, eventId, household, row.sourceUid);
    }

    return { added: activeRows.length, skipped, firstDate, replayed: false };
  }).immediate();
}
