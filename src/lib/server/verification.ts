import type Database from 'better-sqlite3';
import { localDate } from '../chores/recurrence';
import { balance } from './payouts';
import { listMembers } from './household-access';
import { choreVisibility, type ChoreRow } from './my-day';

export const REVIEW_PAGE_SIZE = 20;

export type ReviewItem = ChoreRow & { submittedAt: string; updatedAt: string };
export type ReviewChildSummary = { id: string; name: string; pendingCount: number; pendingCents: number; owed: number };

const FROM = `FROM chore c
  JOIN user u ON u.id = c.assignee_id
  LEFT JOIN recurring_occurrence o ON o.chore_id = c.id
  LEFT JOIN recurring_series r ON r.id = o.series_id`;

function requireParent(db: Database.Database, actor: string, household: string) {
  if (!db.prepare("SELECT 1 FROM active_membership WHERE user_id = ? AND household_id = ? AND role = 'parent'").get(actor, household)) throw new Error('Not authorized');
}

function validChild(db: Database.Database, actor: string, household: string, childId: string | undefined) {
  if (!childId) return;
  if (!listMembers(db, actor, household).some(member => member.role === 'kid' && member.id === childId)) throw new Error('Invalid child');
}

function queuePage(db: Database.Database, actor: string, household: string, input: { today: string; page?: number; pageSize?: number; childId?: string }) {
  requireParent(db, actor, household);
  validChild(db, actor, household, input.childId);
  const visible = choreVisibility({ householdId: household, role: 'parent', actorId: actor, today: input.today });
  const clauses = [`${visible.sql} AND c.status = 'pending_verification'`];
  const parameters = [...visible.parameters];
  if (input.childId) {
    clauses.push('c.assignee_id = ?');
    parameters.push(input.childId);
  }
  const pageSize = Math.max(1, Math.min(100, Math.trunc(input.pageSize ?? REVIEW_PAGE_SIZE)));
  const total = (db.prepare(`SELECT COUNT(*) AS total ${FROM} WHERE ${clauses.join(' AND ')}`).get(...parameters) as { total: number }).total;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const requested = Number.isSafeInteger(input.page) ? input.page! : 1;
  const page = Math.min(Math.max(1, requested), pageCount);
  const items = db.prepare(`SELECT c.id, c.title, c.description, c.due_date AS dueDate, c.reward_cents AS rewardCents,
    c.status, c.rework_reason AS reworkReason, c.assignee_id AS assigneeId, u.name AS childName,
    o.series_id AS seriesId, o.scheduled_date AS scheduledDate,
    COALESCE((SELECT ct.created_at FROM chore_transition ct WHERE ct.chore_id = c.id AND ct.to_status = 'pending_verification' ORDER BY ct.id DESC LIMIT 1), c.updated_at) AS submittedAt,
    c.updated_at AS updatedAt
    ${FROM} WHERE ${clauses.join(' AND ')}
    ORDER BY u.name COLLATE NOCASE, submittedAt DESC, c.id DESC LIMIT ? OFFSET ?`).all(...parameters, pageSize, (page - 1) * pageSize) as ReviewItem[];
  return { items, total, page, pageSize, pageCount };
}

export function listReviewQueue(db: Database.Database, actor: string, household: string, input: { today: string; page?: number; pageSize?: number; childId?: string }) {
  return queuePage(db, actor, household, input);
}

export function reviewChildSummaries(db: Database.Database, actor: string, household: string, today?: string): ReviewChildSummary[] {
  requireParent(db, actor, household);
  const settings = db.prepare('SELECT timezone FROM household_settings WHERE household_id = ?').get(household) as { timezone: string } | undefined;
  const visible = choreVisibility({ householdId: household, role: 'parent', actorId: actor, today: today ?? localDate(new Date(), settings?.timezone ?? 'America/Chicago') });
  const pendingRows = db.prepare(`SELECT c.assignee_id AS id, u.name, COUNT(*) AS pendingCount, COALESCE(SUM(c.reward_cents), 0) AS pendingCents
    ${FROM} WHERE ${visible.sql} AND c.status = 'pending_verification'
    GROUP BY c.assignee_id, u.name`).all(...visible.parameters) as Omit<ReviewChildSummary, 'owed'>[];
  const pendingById = new Map(pendingRows.map(row => [row.id, row]));
  const activeKids = db.prepare(`SELECT u.id, u.name FROM active_membership m JOIN user u ON u.id = m.user_id
    WHERE m.household_id = ? AND m.role = 'kid'`).all(household) as { id: string; name: string }[];
  const childrenById = new Map<string, { id: string; name: string }>();
  for (const kid of activeKids) childrenById.set(kid.id, kid);
  for (const row of pendingRows) if (!childrenById.has(row.id)) childrenById.set(row.id, { id: row.id, name: row.name });
  return [...childrenById.values()]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id))
    .map(child => {
      const pending = pendingById.get(child.id);
      return {
        id: child.id,
        name: child.name,
        pendingCount: pending?.pendingCount ?? 0,
        pendingCents: pending?.pendingCents ?? 0,
        owed: balance(db, household, child.id).owed
      };
    });
}
