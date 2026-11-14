import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { recoveryDates } from '../chores/recovery';
import { localDate } from '../chores/recurrence';
import { createChore } from './chores';

type Series = { id: string; creator_id: string; assignee_id: string; child_name: string; title: string; description: string | null; reward_cents: number | null; start_date: string; end_date: string | null; weekdays: string; state: string; paused_on: string | null };
type Decision = { seriesId: string; date: string; reviewed: string; decision: 'skip' } | { seriesId: string; date: string; reviewed: string; decision: 'create'; assigneeId: string; rewardCents: number | null };

function fingerprint(series: Series) {
  return createHash('sha256').update(JSON.stringify([series.id, series.creator_id, series.assignee_id, series.title, series.description, series.reward_cents, series.start_date, series.end_date, series.weekdays, series.state, series.paused_on])).digest('hex');
}

function parent(db: Database.Database, actor: string, household: string) {
  if (!db.prepare("SELECT 1 FROM active_membership WHERE user_id = ? AND household_id = ? AND role = 'parent'").get(actor, household)) throw new Error('Not authorized');
}

function today(db: Database.Database, household: string) {
  const settings = db.prepare('SELECT timezone FROM household_settings WHERE household_id = ?').get(household) as { timezone: string } | undefined;
  return localDate(new Date(), settings?.timezone ?? 'America/Chicago');
}

function dates(db: Database.Database, series: Series, day: string) {
  const occurrences = db.prepare('SELECT scheduled_date AS date FROM recurring_occurrence WHERE series_id = ? AND scheduled_date >= date(?, \'-30 days\') AND scheduled_date < ?').all(series.id, day, day) as { date: string }[];
  const skips = db.prepare('SELECT scheduled_date AS date FROM recurring_skip WHERE series_id = ? AND scheduled_date >= date(?, \'-30 days\') AND scheduled_date < ?').all(series.id, day, day) as { date: string }[];
  const pauses = db.prepare('SELECT started_on AS start, ended_on AS end FROM recurring_pause_interval WHERE series_id = ? AND started_on < ? AND (ended_on IS NULL OR ended_on > date(?, \'-30 days\'))').all(series.id, day, day) as { start: string; end: string | null }[];
  if (series.paused_on) pauses.push({ start: series.paused_on, end: null });
  return recoveryDates({ today: day, startDate: series.start_date, endDate: series.end_date, weekdays: JSON.parse(series.weekdays), occurrences: occurrences.map(row => row.date), skips: skips.map(row => row.date), pauses });
}

function eligible(db: Database.Database, household: string, offset: number, id: string | null = null) {
  return db.prepare(`SELECT s.*, u.name AS child_name FROM recurring_series s
    JOIN active_membership creator ON creator.household_id = s.household_id AND creator.user_id = s.creator_id AND creator.role = 'parent'
    JOIN active_membership child ON child.household_id = s.household_id AND child.user_id = s.assignee_id AND child.role = 'kid'
    JOIN user u ON u.id = s.assignee_id
    WHERE s.household_id = ? AND s.state = 'active' AND (? IS NULL OR s.id = ?) ORDER BY s.title, s.id LIMIT 1 OFFSET ?`).all(household, id, id, offset) as Series[];
}

export function listRecoveryGaps(db: Database.Database, actor: string, household: string, offset = 0) {
  parent(db, actor, household);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw new Error('Invalid page');
  const day = today(db, household);
  return eligible(db, household, offset).flatMap(series => dates(db, series, day).map(date => ({ seriesId: series.id, date, title: series.title, childName: series.child_name, assigneeId: series.assignee_id, rewardCents: series.reward_cents, uncertain: true, reviewed: fingerprint(series) })));
}

export function hasRecoverySeries(db: Database.Database, actor: string, household: string, offset: number): boolean {
  parent(db, actor, household);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) return false;
  return eligible(db, household, offset).length > 0;
}

export function resolveRecoveryGap(db: Database.Database, actor: string, household: string, input: Decision): void {
  db.transaction(() => {
    parent(db, actor, household);
    const series = eligible(db, household, 0, input.seriesId)[0];
    if (!series || input.reviewed !== fingerprint(series) || !dates(db, series, today(db, household)).includes(input.date)) throw new Error('Recovery date changed');
    if (input.decision !== 'skip' && input.decision !== 'create') throw new Error('Invalid decision');
    let chore: string | null = null;
    if (input.decision === 'create') {
      if (input.assigneeId !== series.assignee_id || (input.rewardCents !== null && (!Number.isSafeInteger(input.rewardCents) || input.rewardCents < 0 || input.rewardCents > 100000000))) throw new Error('Invalid confirmation');
      chore = createChore(db, actor, household, { title: series.title, description: series.description ?? undefined, assigneeId: series.assignee_id, dueDate: input.date, rewardCents: input.rewardCents });
      db.prepare('INSERT INTO recurring_occurrence (series_id, household_id, scheduled_date, chore_id) VALUES (?, ?, ?, ?)').run(series.id, household, input.date, chore);
    } else db.prepare('INSERT INTO recurring_skip (series_id, scheduled_date) VALUES (?, ?)').run(series.id, input.date);
    db.prepare('INSERT INTO recurring_recovery_decision (series_id, household_id, scheduled_date, decision, chore_id, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(series.id, household, input.date, input.decision, chore, actor, new Date().toISOString());
  }).immediate();
}
