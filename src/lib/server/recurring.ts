import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { localDate, occurrenceDates } from '../chores/recurrence';
import { createChore } from './chores';

type SeriesInput = { title: string; description?: string; assigneeId: string; startDate: string; endDate?: string; weekdays: number[]; rewardCents?: number | null };
type Series = { id: string; creator_id: string; assignee_id: string; title: string; description: string | null; reward_cents: number | null; start_date: string; end_date: string | null; weekdays: string };

export function setHouseholdTimezone(db: Database.Database, actor: string, household: string, timezone: string): void {
  if (!db.prepare("SELECT 1 FROM membership WHERE user_id = ? AND household_id = ? AND role = 'parent'").get(actor, household)) throw new Error('Not authorized');
  if (timezone.length > 100 || !timezone.includes('/')) throw new Error('Invalid timezone');
  localDate(new Date(), timezone);
  db.prepare('INSERT INTO household_settings (household_id, timezone) VALUES (?, ?) ON CONFLICT(household_id) DO UPDATE SET timezone = excluded.timezone').run(household, timezone);
}

function validateSeries(db: Database.Database, actor: string, household: string, input: SeriesInput) {
  if (!db.prepare("SELECT 1 FROM membership WHERE user_id = ? AND household_id = ? AND role = 'parent'").get(actor, household) ||
      !db.prepare("SELECT 1 FROM membership WHERE user_id = ? AND household_id = ? AND role = 'kid'").get(input.assigneeId, household)) throw new Error('Not authorized');
  const title = input.title.trim();
  const description = input.description?.trim() || null;
  occurrenceDates(input.startDate, input.startDate, input.weekdays);
  if (input.endDate) occurrenceDates(input.endDate, input.endDate, input.weekdays);
  if (!title || title.length > 120 || (description && description.length > 1000) || (input.endDate && input.endDate < input.startDate) || (input.rewardCents != null && (!Number.isSafeInteger(input.rewardCents) || input.rewardCents < 0 || input.rewardCents > 100000000))) throw new Error('Invalid series');
  return { title, description, weekdays: JSON.stringify([...new Set(input.weekdays)].sort()) };
}

export function createSeries(db: Database.Database, actor: string, household: string, input: SeriesInput): string {
  const { title, description, weekdays } = validateSeries(db, actor, household, input);
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO recurring_series (id, household_id, creator_id, assignee_id, title, description, reward_cents, start_date, end_date, weekdays, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, household, actor, input.assigneeId, title, description, input.rewardCents ?? null, input.startDate, input.endDate || null, weekdays, now, now);
  return id;
}

export function generateOccurrences(db: Database.Database, actor: string, household: string, from: string, through: string): void {
  const member = db.prepare('SELECT role FROM membership WHERE user_id = ? AND household_id = ?').get(actor, household) as { role: string } | undefined;
  if (!member) throw new Error('Not authorized');
  occurrenceDates(from, through, [0]);
  db.transaction(() => {
    const series = db.prepare("SELECT * FROM recurring_series WHERE household_id = ? AND state = 'active' AND (? = 'parent' OR assignee_id = ?)").all(household, member.role, actor) as Series[];
    for (const item of series) {
      const start = from > item.start_date ? from : item.start_date;
      const end = item.end_date && item.end_date < through ? item.end_date : through;
      if (start > end) continue;
      for (const date of occurrenceDates(start, end, JSON.parse(item.weekdays))) {
        if (db.prepare('SELECT 1 FROM recurring_occurrence WHERE series_id = ? AND scheduled_date = ?').get(item.id, date) || db.prepare('SELECT 1 FROM recurring_skip WHERE series_id = ? AND scheduled_date = ?').get(item.id, date)) continue;
        const chore = createChore(db, item.creator_id, household, { title: item.title, description: item.description ?? undefined, assigneeId: item.assignee_id, dueDate: date, rewardCents: item.reward_cents });
        db.prepare('INSERT INTO recurring_occurrence (series_id, household_id, scheduled_date, chore_id) VALUES (?, ?, ?, ?)').run(item.id, household, date, chore);
      }
    }
  }).immediate();
}

function requireParent(db: Database.Database, actor: string, household: string, id: string): void {
  if (!db.prepare("SELECT 1 FROM membership m JOIN recurring_series s ON s.household_id = m.household_id WHERE m.user_id = ? AND m.household_id = ? AND m.role = 'parent' AND s.id = ?").get(actor, household, id)) throw new Error('Not authorized');
}

export function setSeriesState(db: Database.Database, actor: string, household: string, id: string, state: 'active' | 'paused' | 'ended'): void {
  if (!['active', 'paused', 'ended'].includes(state)) throw new Error('Invalid state');
  db.transaction(() => {
    requireParent(db, actor, household, id);
    const existing = db.prepare('SELECT state, paused_on FROM recurring_series WHERE id = ? AND household_id = ?').get(id, household) as { state: string; paused_on: string | null };
    const settings = db.prepare('SELECT timezone FROM household_settings WHERE household_id = ?').get(household) as { timezone: string } | undefined;
    const today = localDate(new Date(), settings?.timezone ?? 'America/Chicago');
    if (existing.state === 'paused' && state !== 'paused' && existing.paused_on) {
      db.prepare(`INSERT OR IGNORE INTO recurring_skip (series_id, scheduled_date) SELECT o.series_id, o.scheduled_date FROM recurring_occurrence o JOIN chore c ON c.id = o.chore_id WHERE o.series_id = ? AND o.scheduled_date >= ? AND o.scheduled_date < ? AND c.status = 'todo'`).run(id, existing.paused_on, today);
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
    const existing = db.prepare('SELECT c.status FROM recurring_occurrence o JOIN chore c ON c.id = o.chore_id WHERE o.series_id = ? AND o.scheduled_date = ?').get(id, date) as { status: string } | undefined;
    if (existing && existing.status !== 'todo') throw new Error('Occurrence already submitted');
    db.prepare('INSERT OR IGNORE INTO recurring_skip (series_id, scheduled_date) VALUES (?, ?)').run(id, date);
  }).immediate();
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
    db.prepare(`UPDATE chore SET assignee_id = ?, title = ?, description = ?, reward_cents = ?, updated_at = ? WHERE household_id = ? AND status = 'todo' AND id IN (SELECT o.chore_id FROM recurring_occurrence o WHERE o.series_id = ? AND o.scheduled_date > ? AND NOT EXISTS (SELECT 1 FROM recurring_skip s WHERE s.series_id = o.series_id AND s.scheduled_date = o.scheduled_date))`).run(input.assigneeId, title, description, input.rewardCents ?? null, new Date().toISOString(), household, id, today);
  }).immediate();
}
