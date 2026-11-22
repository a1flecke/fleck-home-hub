import type Database from 'better-sqlite3';
import type { ChoreState } from '../chores/domain';
import { choreDayLabel, choreWeekDates, choreWeekStart } from '../chores/week';
import { choreVisibility, type ChoreAudience } from './my-day';

export const CHORE_WEEK_ROW_LIMIT = 500;
export const CHORE_STATUS_FILTERS = ['all', 'todo', 'pending_verification', 'needs_rework', 'verified'] as const;
export type ChoreStatusFilter = (typeof CHORE_STATUS_FILTERS)[number];

export type WeekChore = {
  id: string;
  title: string;
  description: string | null;
  dueDate: string;
  rewardCents: number | null;
  status: ChoreState;
  reworkReason: string | null;
  assigneeId: string;
  childName: string;
  seriesId: string | null;
  scheduledDate: string | null;
  updatedAt: string;
  isRecurring: boolean;
};

export type WeekChildGroup = { id: string; name: string; chores: WeekChore[] };
export type WeekDay = { date: string; label: string; isToday: boolean; children: WeekChildGroup[] };
export type WeekChildSummary = { id: string; name: string; total: number };
export type ChoreWeek = {
  start: string;
  end: string;
  days: WeekDay[];
  total: number;
  counts: Record<ChoreState, number>;
  children: WeekChildSummary[];
  truncated: boolean;
};

export function isChoreStatusFilter(value: string | null): value is ChoreStatusFilter {
  return value !== null && (CHORE_STATUS_FILTERS as readonly string[]).includes(value);
}

type WeekRow = Omit<WeekChore, 'isRecurring'>;

function requireParent(db: Database.Database, audience: ChoreAudience) {
  if (audience.role !== 'parent') throw new Error('Not authorized');
  if (!db.prepare("SELECT 1 FROM active_membership WHERE user_id = ? AND household_id = ? AND role = 'parent'").get(audience.actorId, audience.householdId)) throw new Error('Not authorized');
}

function activeChildren(db: Database.Database, householdId: string) {
  return db.prepare(`SELECT u.id, u.name FROM active_membership m JOIN user u ON u.id = m.user_id
    WHERE m.household_id = ? AND m.role = 'kid' ORDER BY u.name COLLATE NOCASE, u.id`).all(householdId) as { id: string; name: string }[];
}

/**
 * A bounded parent-only view of one household-local week. Counts and child totals describe the
 * whole week; the status and child filters only narrow the rows returned for display.
 */
export function loadChoreWeek(db: Database.Database, audience: ChoreAudience, filters: { start: string; childId?: string; status?: ChoreStatusFilter }): ChoreWeek {
  requireParent(db, audience);
  const start = choreWeekStart(filters.start);
  const dates = choreWeekDates(start);
  const end = dates[6];
  const status = filters.status ?? 'all';
  if (!isChoreStatusFilter(status)) throw new Error('Invalid status filter');
  const children = activeChildren(db, audience.householdId);
  const childId = filters.childId ?? '';
  if (childId && !children.some(child => child.id === childId)) throw new Error('Invalid child');

  const visible = choreVisibility(audience);
  const rows = db.prepare(`SELECT c.id, c.title, c.description, c.due_date AS dueDate, c.reward_cents AS rewardCents,
    c.status, c.rework_reason AS reworkReason, c.assignee_id AS assigneeId, u.name AS childName,
    o.series_id AS seriesId, o.scheduled_date AS scheduledDate, c.updated_at AS updatedAt
    FROM chore c
    JOIN user u ON u.id = c.assignee_id
    LEFT JOIN recurring_occurrence o ON o.chore_id = c.id
    LEFT JOIN recurring_series r ON r.id = o.series_id
    WHERE ${visible.sql} AND c.due_date >= ? AND c.due_date <= ?
    ORDER BY c.due_date ASC, u.name COLLATE NOCASE, c.created_at ASC, c.id ASC
    LIMIT ?`).all(...visible.parameters, start, end, CHORE_WEEK_ROW_LIMIT + 1) as WeekRow[];
  const truncated = rows.length > CHORE_WEEK_ROW_LIMIT;
  const bounded = truncated ? rows.slice(0, CHORE_WEEK_ROW_LIMIT) : rows;

  const counts: Record<ChoreState, number> = { todo: 0, pending_verification: 0, needs_rework: 0, verified: 0 };
  const childTotals = new Map(children.map(child => [child.id, 0]));
  for (const row of bounded) {
    counts[row.status] += 1;
    childTotals.set(row.assigneeId, (childTotals.get(row.assigneeId) ?? 0) + 1);
  }

  const filtered = bounded
    .filter(row => (!childId || row.assigneeId === childId) && (status === 'all' || row.status === status))
    .map(row => ({ ...row, isRecurring: row.seriesId !== null }) as WeekChore);
  const byDay = new Map(dates.map(date => [date, [] as WeekChore[]]));
  for (const row of filtered) byDay.get(row.dueDate)?.push(row);

  const days: WeekDay[] = dates.map(date => {
    const groups = new Map<string, WeekChildGroup>();
    for (const chore of byDay.get(date) ?? []) {
      let group = groups.get(chore.assigneeId);
      if (!group) {
        group = { id: chore.assigneeId, name: chore.childName, chores: [] };
        groups.set(chore.assigneeId, group);
      }
      group.chores.push(chore);
    }
    return { date, label: choreDayLabel(date), isToday: date === audience.today, children: [...groups.values()] };
  });

  return {
    start,
    end,
    days,
    total: filtered.length,
    counts,
    children: children.map(child => ({ ...child, total: childTotals.get(child.id) ?? 0 })),
    truncated
  };
}
