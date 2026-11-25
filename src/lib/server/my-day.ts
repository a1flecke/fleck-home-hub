import type Database from 'better-sqlite3';
import { balance } from './payouts';

export const DASHBOARD_SECTION_LIMIT = 10;
export const HISTORY_PAGE_SIZE = 25;
export const PAYOUT_PAGE_SIZE = 20;

export const CHORE_SCOPES = ['review', 'overdue', 'today', 'upcoming', 'later', 'rework', 'verified'] as const;
export type ChoreScope = (typeof CHORE_SCOPES)[number];
export type ChoreRole = 'parent' | 'kid';

export type ChoreAudience = {
  householdId: string;
  role: ChoreRole;
  actorId: string;
  today: string;
  childId?: string;
};

export type ChoreRow = {
  id: string;
  title: string;
  description: string | null;
  dueDate: string;
  rewardCents: number | null;
  status: string;
  reworkReason: string | null;
  assigneeId: string;
  childName: string;
  seriesId: string | null;
  scheduledDate: string | null;
  submittedAt: string | null;
};

export type PayoutRow = {
  id: string;
  amountCents: number;
  paidDate: string;
  note: string | null;
  reversalReason: string | null;
};

export type ChoreCounts = Record<ChoreScope, number>;
export type PageResult<T> = { items: T[]; total: number; page: number; pageSize: number; pageCount: number };

export type ChildEarningSummary = {
  id: string;
  name: string;
  pendingCount: number;
  pendingCents: number;
  earned: number;
  paid: number;
  owed: number;
  payouts: PayoutRow[];
  payoutCount: number;
};

const FROM = `FROM chore c
  JOIN user u ON u.id = c.assignee_id
  LEFT JOIN recurring_occurrence o ON o.chore_id = c.id
  LEFT JOIN recurring_series r ON r.id = o.series_id`;

export function isChoreScope(value: string | null): value is ChoreScope {
  return value !== null && (CHORE_SCOPES as readonly string[]).includes(value);
}

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Household and role visibility shared by every chore read. A child filter never widens a child's audience. */
export function choreVisibility(audience: ChoreAudience) {
  const clauses = ['c.household_id = ?'];
  const parameters: unknown[] = [audience.householdId];
  clauses.push('c.cancelled_at IS NULL');
  if (audience.role === 'kid') {
    clauses.push('c.assignee_id = ?');
    parameters.push(audience.actorId);
  } else if (audience.childId) {
    clauses.push('c.assignee_id = ?');
    parameters.push(audience.childId);
  }
  clauses.push('NOT EXISTS (SELECT 1 FROM recurring_skip s WHERE s.series_id = o.series_id AND s.scheduled_date = o.scheduled_date)');
  clauses.push("NOT (r.state IS NOT NULL AND r.state != 'active' AND c.status = 'todo' AND o.scheduled_date >= COALESCE(r.paused_on, ?))");
  parameters.push(audience.today);
  return { sql: clauses.join(' AND '), parameters };
}

function scopeFilter(scope: ChoreScope, today: string) {
  const horizon = addDays(today, 7);
  switch (scope) {
    case 'review': return { sql: "c.status = 'pending_verification'", parameters: [] as unknown[] };
    case 'overdue': return { sql: "c.status = 'todo' AND c.due_date < ?", parameters: [today] };
    case 'today': return { sql: "c.status = 'todo' AND c.due_date = ?", parameters: [today] };
    case 'upcoming': return { sql: "c.status = 'todo' AND c.due_date > ? AND c.due_date <= ?", parameters: [today, horizon] };
    case 'later': return { sql: "c.status = 'todo' AND c.due_date > ?", parameters: [horizon] };
    case 'rework': return { sql: "c.status = 'needs_rework'", parameters: [] as unknown[] };
    case 'verified': return { sql: "c.status = 'verified'", parameters: [] as unknown[] };
  }
}

function whereClause(audience: ChoreAudience, scope: ChoreScope) {
  const visible = choreVisibility(audience);
  const filtered = scopeFilter(scope, audience.today);
  return { sql: `${visible.sql} AND (${filtered.sql})`, parameters: [...visible.parameters, ...filtered.parameters] };
}

export function choreScopeCounts(db: Database.Database, audience: ChoreAudience): ChoreCounts {
  const visible = choreVisibility(audience);
  const horizon = addDays(audience.today, 7);
  const row = db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN c.status = 'pending_verification' THEN 1 ELSE 0 END), 0) AS review,
    COALESCE(SUM(CASE WHEN c.status = 'todo' AND c.due_date < ? THEN 1 ELSE 0 END), 0) AS overdue,
    COALESCE(SUM(CASE WHEN c.status = 'todo' AND c.due_date = ? THEN 1 ELSE 0 END), 0) AS today,
    COALESCE(SUM(CASE WHEN c.status = 'todo' AND c.due_date > ? AND c.due_date <= ? THEN 1 ELSE 0 END), 0) AS upcoming,
    COALESCE(SUM(CASE WHEN c.status = 'todo' AND c.due_date > ? THEN 1 ELSE 0 END), 0) AS later,
    COALESCE(SUM(CASE WHEN c.status = 'needs_rework' THEN 1 ELSE 0 END), 0) AS rework,
    COALESCE(SUM(CASE WHEN c.status = 'verified' THEN 1 ELSE 0 END), 0) AS verified
    ${FROM} WHERE ${visible.sql}`).get(
      audience.today,
      audience.today,
      audience.today,
      horizon,
      horizon,
      ...visible.parameters
    ) as ChoreCounts;
  return row;
}

export function pendingRewardTotal(db: Database.Database, audience: ChoreAudience): number {
  const visible = choreVisibility(audience);
  return (db.prepare(`SELECT COALESCE(SUM(c.reward_cents), 0) AS cents ${FROM} WHERE ${visible.sql} AND c.status = 'pending_verification'`).get(...visible.parameters) as { cents: number }).cents;
}

function queryChoreItems(db: Database.Database, audience: ChoreAudience, scope: ChoreScope, limit: number, offset: number): ChoreRow[] {
  const where = whereClause(audience, scope);
  const order = scope === 'review'
    ? 'submittedAt DESC, c.due_date ASC, c.id DESC'
    : scope === 'verified'
      ? 'c.updated_at DESC, c.id DESC'
      : 'c.due_date ASC, c.created_at ASC, c.id ASC';
  return db.prepare(`SELECT c.id, c.title, c.description, c.due_date AS dueDate,
    CASE WHEN c.status = 'verified' THEN COALESCE((SELECT e.amount_cents FROM earning e WHERE e.chore_id = c.id), c.reward_cents) ELSE c.reward_cents END AS rewardCents,
    c.status, c.rework_reason AS reworkReason, c.assignee_id AS assigneeId, u.name AS childName,
    o.series_id AS seriesId, o.scheduled_date AS scheduledDate,
    (SELECT ct.created_at FROM chore_transition ct WHERE ct.chore_id = c.id AND ct.to_status = 'pending_verification' ORDER BY ct.id DESC LIMIT 1) AS submittedAt
    ${FROM} WHERE ${where.sql} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...where.parameters, limit, offset) as ChoreRow[];
}

export function listChoreScope(db: Database.Database, input: ChoreAudience & { scope: ChoreScope; page?: number; pageSize?: number }): PageResult<ChoreRow> {
  const pageSize = Math.max(1, Math.min(100, Math.trunc(input.pageSize ?? HISTORY_PAGE_SIZE)));
  const where = whereClause(input, input.scope);
  const total = (db.prepare(`SELECT COUNT(*) AS total ${FROM} WHERE ${where.sql}`).get(...where.parameters) as { total: number }).total;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const requested = Number.isSafeInteger(input.page) ? input.page! : 1;
  const page = Math.min(Math.max(1, requested), pageCount);
  return { items: queryChoreItems(db, input, input.scope, pageSize, (page - 1) * pageSize), total, page, pageSize, pageCount };
}

export function dashboardChoreSections(db: Database.Database, audience: ChoreAudience) {
  const counts = choreScopeCounts(db, audience);
  const sections = Object.fromEntries(CHORE_SCOPES.map(scope => {
    const items = counts[scope] === 0 ? [] : queryChoreItems(db, audience, scope, DASHBOARD_SECTION_LIMIT, 0);
    return [scope, { items, total: counts[scope], page: 1, pageSize: DASHBOARD_SECTION_LIMIT, pageCount: Math.max(1, Math.ceil(counts[scope] / DASHBOARD_SECTION_LIMIT)) }];
  })) as Record<ChoreScope, PageResult<ChoreRow>>;
  return { counts, sections };
}

function childrenFor(db: Database.Database, audience: ChoreAudience) {
  return db.prepare(`SELECT u.id, u.name FROM active_membership m JOIN user u ON u.id = m.user_id
    WHERE m.household_id = ? AND m.role = 'kid' AND (? = 'parent' OR u.id = ?)
    ORDER BY u.name, u.id`).all(audience.householdId, audience.role, audience.actorId) as { id: string; name: string }[];
}

function recentPayouts(db: Database.Database, householdId: string, childId: string, limit: number) {
  return db.prepare(`SELECT p.id, p.amount_cents AS amountCents, p.paid_date AS paidDate, p.note, r.reason AS reversalReason
    FROM payout p LEFT JOIN payout_reversal r ON r.payout_id = p.id
    WHERE p.household_id = ? AND p.child_id = ?
    ORDER BY p.paid_date DESC, p.created_at DESC, p.id DESC LIMIT ?`).all(householdId, childId, limit) as PayoutRow[];
}

export function childEarningSummaries(db: Database.Database, audience: ChoreAudience): ChildEarningSummary[] {
  const visible = choreVisibility(audience);
  const pendingRows = db.prepare(`SELECT c.assignee_id AS id, COUNT(*) AS count, COALESCE(SUM(c.reward_cents), 0) AS cents
    ${FROM} WHERE ${visible.sql} AND c.status = 'pending_verification' GROUP BY c.assignee_id`).all(...visible.parameters) as { id: string; count: number; cents: number }[];
  const pending = new Map(pendingRows.map(row => [row.id, row]));
  return childrenFor(db, audience).map(child => {
    const amounts = balance(db, audience.householdId, child.id);
    const payoutCount = (db.prepare('SELECT COUNT(*) AS count FROM payout WHERE household_id = ? AND child_id = ?').get(audience.householdId, child.id) as { count: number }).count;
    return {
      ...child,
      pendingCount: pending.get(child.id)?.count ?? 0,
      pendingCents: pending.get(child.id)?.cents ?? 0,
      ...amounts,
      payouts: recentPayouts(db, audience.householdId, child.id, 3),
      payoutCount
    };
  });
}

export function listPayoutHistory(db: Database.Database, input: ChoreAudience & { childId: string; page?: number; pageSize?: number }) {
  if (input.role === 'kid' && input.childId !== input.actorId) throw new Error('Not authorized');
  const child = db.prepare(`SELECT u.id, u.name FROM active_membership m JOIN user u ON u.id = m.user_id
    WHERE m.household_id = ? AND m.role = 'kid' AND u.id = ?`).get(input.householdId, input.childId) as { id: string; name: string } | undefined;
  if (!child) throw new Error('Not authorized');
  const audience = { ...input, childId: input.childId };
  const summary = childEarningSummaries(db, audience).find(item => item.id === input.childId);
  if (!summary) throw new Error('Not authorized');
  const pageSize = Math.max(1, Math.min(100, Math.trunc(input.pageSize ?? PAYOUT_PAGE_SIZE)));
  const total = summary.payoutCount;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const requested = Number.isSafeInteger(input.page) ? input.page! : 1;
  const page = Math.min(Math.max(1, requested), pageCount);
  const pageItems = db.prepare(`SELECT p.id, p.amount_cents AS amountCents, p.paid_date AS paidDate, p.note, r.reason AS reversalReason
    FROM payout p LEFT JOIN payout_reversal r ON r.payout_id = p.id
    WHERE p.household_id = ? AND p.child_id = ?
    ORDER BY p.paid_date DESC, p.created_at DESC, p.id DESC LIMIT ? OFFSET ?`).all(input.householdId, input.childId, pageSize, (page - 1) * pageSize) as PayoutRow[];
  return { child, balance: { earned: summary.earned, paid: summary.paid, owed: summary.owed }, pendingCount: summary.pendingCount, pendingCents: summary.pendingCents, items: pageItems, total, page, pageSize, pageCount };
}
