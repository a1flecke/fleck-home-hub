import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { addCalendarDays } from '../calendar/dates';
import { localDate, occurrenceDates } from '../chores/recurrence';
import { previewScheduleChange, schedulePatternLabel, validateEffectiveDate, type ScheduleOccurrence, type SchedulePreview } from '../chores/schedule';
import { createChore } from './chores';

type SeriesInput = { title: string; description?: string; assigneeId: string; startDate: string; endDate?: string; weekdays: number[]; rewardCents?: number | null };
type Series = { id: string; creator_id: string; assignee_id: string; title: string; description: string | null; reward_cents: number | null; start_date: string; end_date: string | null; weekdays: string; state: string; updated_at: string };

export type SeriesChangeCode = 'not-authorized' | 'not-found' | 'ended' | 'stale' | 'invalid';
export class SeriesChangeError extends Error {
  constructor(readonly code: SeriesChangeCode) { super(code); }
}

function nextTimestamp(previous: string): string {
  const prior = Date.parse(previous);
  return new Date(Number.isFinite(prior) ? Math.max(Date.now(), prior + 1) : Date.now()).toISOString();
}

export function setHouseholdTimezone(db: Database.Database, actor: string, household: string, timezone: string): void {
  db.transaction(() => {
    if (!db.prepare("SELECT 1 FROM active_membership WHERE user_id = ? AND household_id = ? AND role = 'parent'").get(actor, household)) throw new Error('Not authorized');
    if (timezone.length > 100 || !timezone.includes('/')) throw new Error('Invalid timezone');
    localDate(new Date(), timezone);
    db.prepare('INSERT INTO household_settings (household_id, timezone) VALUES (?, ?) ON CONFLICT(household_id) DO UPDATE SET timezone = excluded.timezone').run(household, timezone);
  }).immediate();
}

function validateSeries(db: Database.Database, actor: string, household: string, input: SeriesInput) {
  if (!db.prepare("SELECT 1 FROM active_membership WHERE user_id = ? AND household_id = ? AND role = 'parent'").get(actor, household) ||
      !db.prepare("SELECT 1 FROM active_membership WHERE user_id = ? AND household_id = ? AND role = 'kid'").get(input.assigneeId, household)) throw new Error('Not authorized');
  const title = input.title.trim();
  const description = input.description?.trim() || null;
  occurrenceDates(input.startDate, input.startDate, input.weekdays);
  if (input.endDate) occurrenceDates(input.endDate, input.endDate, input.weekdays);
  if (!title || title.length > 120 || (description && description.length > 1000) || (input.endDate && input.endDate < input.startDate) || (input.rewardCents != null && (!Number.isSafeInteger(input.rewardCents) || input.rewardCents < 0 || input.rewardCents > 100000000))) throw new Error('Invalid series');
  return { title, description, weekdays: JSON.stringify([...new Set(input.weekdays)].sort()) };
}

export function createSeries(db: Database.Database, actor: string, household: string, input: SeriesInput): string {
  return db.transaction(() => {
    const { title, description, weekdays } = validateSeries(db, actor, household, input);
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO recurring_series (id, household_id, creator_id, assignee_id, title, description, reward_cents, start_date, end_date, weekdays, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, household, actor, input.assigneeId, title, description, input.rewardCents ?? null, input.startDate, input.endDate || null, weekdays, now, now);
    return id;
  }).immediate();
}

function generateOccurrencesForSeries(db: Database.Database, actor: string, household: string, item: Series, from: string, through: string): string[] {
  const start = from > item.start_date ? from : item.start_date;
  const end = item.end_date && item.end_date < through ? item.end_date : through;
  if (start > end) return [];
  const created: string[] = [];
  for (const date of occurrenceDates(start, end, JSON.parse(item.weekdays))) {
    if (db.prepare('SELECT 1 FROM recurring_occurrence WHERE series_id = ? AND scheduled_date = ?').get(item.id, date) || db.prepare('SELECT 1 FROM recurring_skip WHERE series_id = ? AND scheduled_date = ?').get(item.id, date)) continue;
    const chore = createChore(db, actor, household, { title: item.title, description: item.description ?? undefined, assigneeId: item.assignee_id, dueDate: date, rewardCents: item.reward_cents });
    db.prepare('INSERT INTO recurring_occurrence (series_id, household_id, scheduled_date, chore_id) VALUES (?, ?, ?, ?)').run(item.id, household, date, chore);
    created.push(date);
  }
  return created;
}

export function generateOccurrences(db: Database.Database, actor: string, household: string, from: string, through: string): void {
  db.transaction(() => {
    const member = db.prepare('SELECT role FROM active_membership WHERE user_id = ? AND household_id = ?').get(actor, household) as { role: string } | undefined;
    if (!member) throw new Error('Not authorized');
    occurrenceDates(from, through, [0]);
    const series = db.prepare(`SELECT s.* FROM recurring_series s
      JOIN active_membership creator ON creator.household_id = s.household_id AND creator.user_id = s.creator_id AND creator.role = 'parent'
      JOIN active_membership assignee ON assignee.household_id = s.household_id AND assignee.user_id = s.assignee_id AND assignee.role = 'kid'
      WHERE s.household_id = ? AND s.state = 'active' AND (? = 'parent' OR s.assignee_id = ?)`).all(household, member.role, actor) as Series[];
    for (const item of series) generateOccurrencesForSeries(db, item.creator_id, household, item, from, through);
  }).immediate();
}

function requireParent(db: Database.Database, actor: string, household: string, id: string): void {
  if (!db.prepare("SELECT 1 FROM active_membership m JOIN recurring_series s ON s.household_id = m.household_id WHERE m.user_id = ? AND m.household_id = ? AND m.role = 'parent' AND s.id = ?").get(actor, household, id)) throw new Error('Not authorized');
}

export function setSeriesState(db: Database.Database, actor: string, household: string, id: string, state: 'active' | 'paused' | 'ended'): void {
  if (!['active', 'paused', 'ended'].includes(state)) throw new Error('Invalid state');
  db.transaction(() => {
    requireParent(db, actor, household, id);
    const existing = db.prepare('SELECT state, paused_on FROM recurring_series WHERE id = ? AND household_id = ?').get(id, household) as { state: string; paused_on: string | null };
    const settings = db.prepare('SELECT timezone FROM household_settings WHERE household_id = ?').get(household) as { timezone: string } | undefined;
    const today = localDate(new Date(), settings?.timezone ?? 'America/Chicago');
    if (existing.state === 'paused' && state !== 'paused' && existing.paused_on) {
      db.prepare(`INSERT OR IGNORE INTO recurring_skip (series_id, scheduled_date) SELECT o.series_id, o.scheduled_date FROM recurring_occurrence o JOIN chore c ON c.id = o.chore_id WHERE o.series_id = ? AND o.scheduled_date >= ? AND o.scheduled_date < ? AND c.status = 'todo' AND c.cancelled_at IS NULL`).run(id, existing.paused_on, today);
    }
    if (existing.state === 'active' && state === 'paused') {
      db.prepare('INSERT INTO recurring_pause_interval (series_id, started_on, actor_id, created_at) VALUES (?, ?, ?, ?)').run(id, today, actor, new Date().toISOString());
    }
    if (existing.state === 'paused' && state !== 'paused' && existing.paused_on) {
      const closed = db.prepare('UPDATE recurring_pause_interval SET ended_on = ? WHERE series_id = ? AND ended_on IS NULL').run(today, id);
      if (!closed.changes) db.prepare('INSERT INTO recurring_pause_interval (series_id, started_on, ended_on, actor_id, created_at) VALUES (?, ?, ?, ?, ?)').run(id, existing.paused_on, today, actor, new Date().toISOString());
    }
    const pausedOn = state === 'paused' ? (existing.paused_on ?? today) : null;
    const changed = db.prepare("UPDATE recurring_series SET state = ?, paused_on = ?, updated_at = ? WHERE id = ? AND household_id = ? AND state != 'ended'").run(state, pausedOn, new Date().toISOString(), id, household);
    if (!changed.changes) throw new Error('Series ended');
  }).immediate();
}

export function skipOccurrence(db: Database.Database, actor: string, household: string, id: string, date: string): void {
  occurrenceDates(date, date, [0]);
  db.transaction(() => {
    requireParent(db, actor, household, id);
    const series = db.prepare('SELECT start_date, end_date, weekdays, state FROM recurring_series WHERE id = ? AND household_id = ?').get(id, household) as { start_date: string; end_date: string | null; weekdays: string; state: string };
    if (series.state === 'ended' || date < series.start_date || (series.end_date && date > series.end_date) || !occurrenceDates(date, date, JSON.parse(series.weekdays)).length) throw new Error('Not a scheduled occurrence');
    const existing = db.prepare('SELECT c.status, c.cancelled_at FROM recurring_occurrence o JOIN chore c ON c.id = o.chore_id WHERE o.series_id = ? AND o.scheduled_date = ?').get(id, date) as { status: string; cancelled_at: string | null } | undefined;
    if (existing && existing.status !== 'todo' && !existing.cancelled_at) throw new Error('Occurrence already submitted');
    db.prepare('INSERT OR IGNORE INTO recurring_skip (series_id, scheduled_date) VALUES (?, ?)').run(id, date);
  }).immediate();
}

export type SeriesPageItem = {
  id: string;
  title: string;
  description: string | null;
  assigneeId: string;
  childName: string;
  rewardCents: number | null;
  startDate: string;
  endDate: string | null;
  weekdays: string;
  state: string;
  updatedAt: string;
  next?: string;
  skips: string[];
  skipCount: number;
};

export function activeSeriesCount(db: Database.Database, household: string): number {
  return (db.prepare("SELECT COUNT(*) AS count FROM recurring_series WHERE household_id = ? AND state = 'active'").get(household) as { count: number }).count;
}

/** Bounded parent-only schedule management. Next occurrence and skip previews are capped per series. */
export function listSeriesPage(db: Database.Database, actor: string, household: string, page = 1, pageSize = 10, focus?: string) {
  if (!db.prepare("SELECT 1 FROM active_membership WHERE user_id = ? AND household_id = ? AND role = 'parent'").get(actor, household)) throw new Error('Not authorized');
  const size = Math.max(1, Math.min(50, Math.trunc(pageSize)));
  const requested = Number.isSafeInteger(page) ? page : 1;
  const total = (db.prepare('SELECT COUNT(*) AS count FROM recurring_series WHERE household_id = ?').get(household) as { count: number }).count;
  const pageCount = Math.max(1, Math.ceil(total / size));
  let current = Math.min(Math.max(1, requested), pageCount);
  if (focus) {
    const target = db.prepare('SELECT created_at, id FROM recurring_series WHERE household_id = ? AND id = ?').get(household, focus) as { created_at: string; id: string } | undefined;
    if (target) {
      const newer = (db.prepare('SELECT COUNT(*) AS count FROM recurring_series WHERE household_id = ? AND (created_at > ? OR (created_at = ? AND id > ?))').get(household, target.created_at, target.created_at, target.id) as { count: number }).count;
      current = Math.min(pageCount, Math.floor(newer / size) + 1);
    }
  }
  const settings = db.prepare('SELECT timezone FROM household_settings WHERE household_id = ?').get(household) as { timezone: string } | undefined;
  const today = localDate(new Date(), settings?.timezone ?? 'America/Chicago');
  const rows = db.prepare(`SELECT s.id, s.title, s.description, s.assignee_id AS assigneeId, u.name AS childName,
    s.reward_cents AS rewardCents, s.start_date AS startDate, s.end_date AS endDate, s.weekdays, s.state, s.updated_at AS updatedAt
    FROM recurring_series s JOIN user u ON u.id = s.assignee_id
    WHERE s.household_id = ? ORDER BY s.created_at DESC, s.id DESC LIMIT ? OFFSET ?`).all(household, size, (current - 1) * size) as Omit<SeriesPageItem, 'next' | 'skips' | 'skipCount'>[];
  const items = rows.map(item => {
    const next = item.state === 'active'
      ? (db.prepare(`SELECT o.scheduled_date AS date FROM recurring_occurrence o JOIN chore c ON c.id = o.chore_id
        WHERE o.series_id = ? AND o.scheduled_date >= ? AND c.status = 'todo' AND c.cancelled_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM recurring_skip s WHERE s.series_id = o.series_id AND s.scheduled_date = o.scheduled_date)
        ORDER BY o.scheduled_date LIMIT 1`).get(item.id, today) as { date: string } | undefined)?.date
      : undefined;
    const skips = (db.prepare('SELECT scheduled_date AS date FROM recurring_skip WHERE series_id = ? ORDER BY scheduled_date DESC LIMIT 5').all(item.id) as { date: string }[]).map(skip => skip.date);
    const skipCount = (db.prepare('SELECT COUNT(*) AS count FROM recurring_skip WHERE series_id = ?').get(item.id) as { count: number }).count;
    return { ...item, next, skips, skipCount };
  });
  return { items, total, page: current, pageSize: size, pageCount, today };
}

export function updateSeries(db: Database.Database, actor: string, household: string, id: string, input: SeriesInput): void {
  db.transaction(() => {
    requireParent(db, actor, household, id);
    const { title, description, weekdays } = validateSeries(db, actor, household, input);
    const current = db.prepare('SELECT start_date, end_date, weekdays FROM recurring_series WHERE id = ? AND household_id = ?').get(id, household) as { start_date: string; end_date: string | null; weekdays: string };
    if (current.start_date !== input.startDate || current.end_date !== (input.endDate || null) || current.weekdays !== weekdays) throw new Error('Schedule cannot be changed');
    const settings = db.prepare('SELECT timezone FROM household_settings WHERE household_id = ?').get(household) as { timezone: string } | undefined;
    const today = localDate(new Date(), settings?.timezone ?? 'America/Chicago');
    const result = db.prepare("UPDATE recurring_series SET assignee_id = ?, title = ?, description = ?, reward_cents = ?, start_date = ?, end_date = ?, weekdays = ?, updated_at = ? WHERE id = ? AND household_id = ? AND state != 'ended'").run(input.assigneeId, title, description, input.rewardCents ?? null, input.startDate, input.endDate || null, weekdays, new Date().toISOString(), id, household);
    if (!result.changes) throw new Error('Series ended');
    db.prepare(`UPDATE chore SET assignee_id = ?, title = ?, description = ?, reward_cents = ?, updated_at = ? WHERE household_id = ? AND status = 'todo' AND cancelled_at IS NULL AND id IN (SELECT o.chore_id FROM recurring_occurrence o WHERE o.series_id = ? AND o.scheduled_date > ? AND NOT EXISTS (SELECT 1 FROM recurring_skip s WHERE s.series_id = o.series_id AND s.scheduled_date = o.scheduled_date))`).run(input.assigneeId, title, description, input.rewardCents ?? null, new Date().toISOString(), household, id, today);
  }).immediate();
}

export type ScheduleRevisionInput = SeriesInput & { effectiveDate: string };

export type SeriesSchedulePreview = SchedulePreview & {
  seriesId: string;
  title: string;
  state: string;
  updatedAt: string;
  today: string;
  timezone: string;
  oldStartDate: string;
  oldEndDate: string | null;
  oldWeekdays: number[];
  newStartDate: string;
  newEndDate: string | null;
  newWeekdays: number[];
  oldPattern: string;
  newPattern: string;
};

function timezone(db: Database.Database, household: string) {
  return (db.prepare('SELECT timezone FROM household_settings WHERE household_id = ?').get(household) as { timezone: string } | undefined)?.timezone ?? 'America/Chicago';
}

function scheduleSeries(db: Database.Database, id: string, household: string): Series | undefined {
  return db.prepare('SELECT * FROM recurring_series WHERE id = ? AND household_id = ?').get(id, household) as Series | undefined;
}

function scheduleOccurrences(db: Database.Database, id: string, from: string, through: string) {
  return db.prepare(`SELECT o.scheduled_date AS date, c.status, c.cancelled_at AS cancelledAt
    FROM recurring_occurrence o JOIN chore c ON c.id = o.chore_id
    WHERE o.series_id = ? AND o.scheduled_date >= ? AND o.scheduled_date <= ?
    ORDER BY o.scheduled_date, c.id LIMIT 500`).all(id, from, through) as { date: string; status: ScheduleOccurrence['status']; cancelledAt: string | null }[];
}

function scheduleSkips(db: Database.Database, id: string, from: string, through: string) {
  return (db.prepare('SELECT scheduled_date AS date FROM recurring_skip WHERE series_id = ? AND scheduled_date >= ? AND scheduled_date <= ? ORDER BY scheduled_date LIMIT 500').all(id, from, through) as { date: string }[]).map(row => row.date);
}

/** Read-only preview for a proposed effective-date schedule revision. */
export function previewSeriesSchedule(db: Database.Database, actor: string, household: string, id: string, expectedUpdatedAt: string, input: ScheduleRevisionInput): SeriesSchedulePreview {
  requireParent(db, actor, household, id);
  const series = scheduleSeries(db, id, household);
  if (!series) throw new SeriesChangeError('not-found');
  if (series.state === 'ended') throw new SeriesChangeError('ended');
  if (series.updated_at !== expectedUpdatedAt) throw new SeriesChangeError('stale');
  const today = localDate(new Date(), timezone(db, household));
  let normalized: { title: string; description: string | null; weekdays: string };
  try {
    validateEffectiveDate(input.effectiveDate, today);
    if (input.effectiveDate < series.start_date) throw new Error('Effective date cannot be before the current start');
    normalized = validateSeries(db, actor, household, { ...input, startDate: input.effectiveDate });
  } catch { throw new SeriesChangeError('invalid'); }
  const oldWeekdays = JSON.parse(series.weekdays) as number[];
  const newWeekdays = JSON.parse(normalized.weekdays) as number[];
  const end = input.endDate || null;
  const scanThrough = addCalendarDays(input.effectiveDate, 366);
  const occurrences = scheduleOccurrences(db, id, input.effectiveDate, scanThrough).map(row => ({ date: row.date, status: row.status, cancelled: row.cancelledAt !== null }));
  const preview = previewScheduleChange({
    today,
    effectiveDate: input.effectiveDate,
    oldWeekdays,
    oldEndDate: series.end_date,
    newWeekdays,
    newEndDate: end,
    occurrences,
    skips: scheduleSkips(db, id, input.effectiveDate, scanThrough)
  });
  return {
    ...preview,
    seriesId: id,
    title: series.title,
    state: series.state,
    updatedAt: series.updated_at,
    today,
    timezone: timezone(db, household),
    oldStartDate: series.start_date,
    oldEndDate: series.end_date,
    oldWeekdays,
    newStartDate: input.effectiveDate,
    newEndDate: end,
    newWeekdays,
    oldPattern: schedulePatternLabel(oldWeekdays, series.end_date),
    newPattern: schedulePatternLabel(newWeekdays, end)
  };
}

/**
 * Apply a future schedule revision. Today and earlier occurrences keep their values. Future unstarted
 * occurrences that no longer match are archived with the cancellation marker, while submitted, rework
 * and verified work is preserved. New matching dates are generated once inside this transaction.
 */
export function reviseSeriesSchedule(db: Database.Database, actor: string, household: string, id: string, expectedUpdatedAt: string, input: ScheduleRevisionInput): void {
  db.transaction(() => {
    requireParent(db, actor, household, id);
    const series = scheduleSeries(db, id, household);
    if (!series) throw new SeriesChangeError('not-found');
    if (series.state === 'ended') throw new SeriesChangeError('ended');
    if (series.updated_at !== expectedUpdatedAt) throw new SeriesChangeError('stale');
    const today = localDate(new Date(), timezone(db, household));
    let normalized: { title: string; description: string | null; weekdays: string };
    try {
      validateEffectiveDate(input.effectiveDate, today);
      if (input.effectiveDate < series.start_date) throw new Error('Effective date cannot be before the current start');
      normalized = validateSeries(db, actor, household, { ...input, startDate: input.effectiveDate });
    } catch { throw new SeriesChangeError('invalid'); }
    const newWeekdays = JSON.parse(normalized.weekdays) as number[];
    const end = input.endDate || null;
    const now = nextTimestamp(series.updated_at);
    const scanThrough = addCalendarDays(input.effectiveDate, 366);
    const recurrenceEnd = end && end < scanThrough ? end : scanThrough;
    const newDates = new Set(occurrenceDates(input.effectiveDate, recurrenceEnd, newWeekdays));
    const cancelledDates: string[] = [];
    for (const occurrence of scheduleOccurrences(db, id, input.effectiveDate, scanThrough)) {
      if (occurrence.status !== 'todo' || occurrence.cancelledAt || newDates.has(occurrence.date)) continue;
      const changed = db.prepare('UPDATE chore SET cancelled_at = ?, cancelled_by = ?, updated_at = ? WHERE id = (SELECT chore_id FROM recurring_occurrence WHERE series_id = ? AND scheduled_date = ?) AND cancelled_at IS NULL')
        .run(now, actor, now, id, occurrence.date);
      if (!changed.changes) continue;
      const chore = db.prepare('SELECT chore_id FROM recurring_occurrence WHERE series_id = ? AND scheduled_date = ?').get(id, occurrence.date) as { chore_id: string };
      db.prepare('INSERT INTO chore_revision (chore_id, actor_id, changed_at, changes) VALUES (?, ?, ?, ?)')
        .run(chore.chore_id, actor, now, JSON.stringify({ cancelled: { from: null, to: now, reason: 'schedule_revision' } }));
      cancelledDates.push(occurrence.date);
    }
    const updated = db.prepare(`UPDATE recurring_series SET assignee_id = ?, title = ?, description = ?, reward_cents = ?, start_date = ?, end_date = ?, weekdays = ?, updated_at = ?
      WHERE id = ? AND household_id = ? AND state != 'ended' AND updated_at = ?`)
      .run(input.assigneeId, normalized.title, normalized.description, input.rewardCents ?? null, input.effectiveDate, end, normalized.weekdays, now, id, household, expectedUpdatedAt);
    if (!updated.changes) throw new SeriesChangeError('stale');
    db.prepare(`UPDATE chore SET assignee_id = ?, title = ?, description = ?, reward_cents = ?, updated_at = ?
      WHERE household_id = ? AND status = 'todo' AND cancelled_at IS NULL AND id IN (
        SELECT o.chore_id FROM recurring_occurrence o WHERE o.series_id = ? AND o.scheduled_date >= ?
        AND NOT EXISTS (SELECT 1 FROM recurring_skip s WHERE s.series_id = o.series_id AND s.scheduled_date = o.scheduled_date)
      )`).run(input.assigneeId, normalized.title, normalized.description, input.rewardCents ?? null, now, household, id, input.effectiveDate);
    let createdDates: string[] = [];
    if (series.state === 'active') {
      const generateEnd = end && end < addCalendarDays(input.effectiveDate, 60) ? end : addCalendarDays(input.effectiveDate, 60);
      createdDates = generateOccurrencesForSeries(db, actor, household, {
        ...series,
        assignee_id: input.assigneeId,
        title: normalized.title,
        description: normalized.description,
        reward_cents: input.rewardCents ?? null,
        start_date: input.effectiveDate,
        end_date: end,
        weekdays: normalized.weekdays,
        updated_at: now
      }, input.effectiveDate, generateEnd);
    }
    db.prepare(`INSERT INTO recurring_schedule_revision
      (id, series_id, household_id, actor_id, effective_date, old_start_date, old_end_date, old_weekdays, new_start_date, new_end_date, new_weekdays, cancelled_dates, created_dates, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), id, household, actor, input.effectiveDate, series.start_date, series.end_date, series.weekdays, input.effectiveDate, end, normalized.weekdays, JSON.stringify(cancelledDates), JSON.stringify(createdDates), now);
  }).immediate();
}
