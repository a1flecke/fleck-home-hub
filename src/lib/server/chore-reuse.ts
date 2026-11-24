import type Database from 'better-sqlite3';
import { isValidReuseKey, normalizeReuseFields, reusePreviewRows, uniqueAssigneeIds, type ReuseRow } from '../chores/reuse';
import { createChore } from './chores';

export const REUSE_PAGE_SIZE = 20;

export type ReuseErrorCode = 'not-authorized' | 'invalid' | 'invalid-key' | 'stale-source';
export class ReuseError extends Error {
  constructor(readonly code: ReuseErrorCode) { super(code); }
}

export type RecentChore = {
  id: string;
  title: string;
  description: string | null;
  rewardCents: number | null;
  dueDate: string;
  childName: string;
  updatedAt: string;
};

export type ReuseInput = {
  sourceId: string;
  sourceUpdatedAt: string;
  title: string;
  description?: string | null;
  dueDate: string;
  rewardCents?: number | null;
  assigneeIds: string[];
};

export type ReusePreview = {
  sourceId: string;
  sourceUpdatedAt: string;
  rows: ReuseRow[];
};

type Source = { id: string; updated_at: string; cancelled_at: string | null };

function parent(db: Database.Database, actor: string, household: string) {
  if (!db.prepare("SELECT 1 FROM active_membership WHERE user_id = ? AND household_id = ? AND role = 'parent'").get(actor, household)) throw new ReuseError('not-authorized');
}

function escapeLike(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

/** A bounded, parent-only list of recent real chores in one household. */
export function listRecentChores(db: Database.Database, actor: string, household: string, input: { query?: string; page?: number; pageSize?: number } = {}) {
  parent(db, actor, household);
  const query = (input.query ?? '').trim();
  if (query.length > 80) throw new ReuseError('invalid');
  const requested = input.page ?? 1;
  if (!Number.isSafeInteger(requested) || requested < 1 || requested > 10000) throw new ReuseError('invalid');
  const pageSize = Math.max(1, Math.min(50, Math.trunc(input.pageSize ?? REUSE_PAGE_SIZE)));
  const filter = query ? `AND c.title LIKE ? ESCAPE '\\'` : '';
  const parameters = query ? [`%${escapeLike(query)}%`] : [];
  const total = (db.prepare(`SELECT COUNT(*) AS count FROM chore c WHERE c.household_id = ? AND c.cancelled_at IS NULL ${filter}`).get(household, ...parameters) as { count: number }).count;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requested, pageCount);
  const items = db.prepare(`SELECT c.id, c.title, c.description, c.reward_cents AS rewardCents, c.due_date AS dueDate,
    u.name AS childName, c.updated_at AS updatedAt
    FROM chore c JOIN user u ON u.id = c.assignee_id
    WHERE c.household_id = ? AND c.cancelled_at IS NULL ${filter}
    ORDER BY c.updated_at DESC, c.id DESC LIMIT ? OFFSET ?`).all(household, ...parameters, pageSize, (page - 1) * pageSize) as RecentChore[];
  return { items, total, page, pageSize, pageCount, query };
}

export function recentChore(db: Database.Database, actor: string, household: string, id: string): RecentChore {
  parent(db, actor, household);
  const item = db.prepare(`SELECT c.id, c.title, c.description, c.reward_cents AS rewardCents, c.due_date AS dueDate,
    u.name AS childName, c.updated_at AS updatedAt
    FROM chore c JOIN user u ON u.id = c.assignee_id
    WHERE c.household_id = ? AND c.id = ? AND c.cancelled_at IS NULL`).get(household, id) as RecentChore | undefined;
  if (!item) throw new ReuseError('invalid');
  return item;
}

function validate(db: Database.Database, actor: string, household: string, input: ReuseInput) {
  parent(db, actor, household);
  let fields;
  let assigneeIds;
  try {
    fields = normalizeReuseFields(input);
    assigneeIds = uniqueAssigneeIds(input.assigneeIds);
  } catch { throw new ReuseError('invalid'); }
  const source = db.prepare('SELECT id, updated_at, cancelled_at FROM chore WHERE id = ? AND household_id = ?').get(input.sourceId, household) as Source | undefined;
  if (!source || source.cancelled_at) throw new ReuseError('invalid');
  if (source.updated_at !== input.sourceUpdatedAt) throw new ReuseError('stale-source');
  const children = assigneeIds.map(id => {
    const child = db.prepare("SELECT u.id, u.name FROM active_membership m JOIN user u ON u.id = m.user_id WHERE m.household_id = ? AND m.user_id = ? AND m.role = 'kid'").get(household, id) as { id: string; name: string } | undefined;
    if (!child) throw new ReuseError('invalid');
    return child;
  });
  return { fields, source, children };
}

/** Validate and show every independent assignment before the parent confirms. */
export function previewReuseBatch(db: Database.Database, actor: string, household: string, input: ReuseInput): ReusePreview {
  const { fields, source, children } = validate(db, actor, household, input);
  return { sourceId: input.sourceId, sourceUpdatedAt: source.updated_at, rows: reusePreviewRows(fields, children) };
}

/**
 * Create one independent to-do chore per reviewed child in a single immediate transaction.
 * The reviewed batch key makes retries and double-clicks return the original result.
 */
export function createReuseBatch(db: Database.Database, actor: string, household: string, input: ReuseInput & { key: string }): { created: boolean; choreIds: string[] } {
  return db.transaction(() => {
    parent(db, actor, household);
    if (!isValidReuseKey(input.key)) throw new ReuseError('invalid-key');
    const existing = db.prepare('SELECT chore_ids AS choreIds FROM chore_reuse_batch WHERE id = ? AND household_id = ?').get(input.key, household) as { choreIds: string } | undefined;
    if (existing) return { created: false, choreIds: JSON.parse(existing.choreIds) as string[] };
    const { fields, source, children } = validate(db, actor, household, input);
    const choreIds: string[] = [];
    for (const child of children) {
      choreIds.push(createChore(db, actor, household, {
        title: fields.title,
        description: fields.description ?? undefined,
        assigneeId: child.id,
        dueDate: fields.dueDate,
        rewardCents: fields.rewardCents
      }));
    }
    db.prepare(`INSERT INTO chore_reuse_batch
      (id, household_id, actor_id, source_chore_id, title, description, reward_cents, due_date, assignee_ids, chore_ids, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(input.key, household, actor, source.id, fields.title, fields.description, fields.rewardCents, fields.dueDate, JSON.stringify(children.map(child => child.id)), JSON.stringify(choreIds), new Date().toISOString());
    return { created: true, choreIds };
  }).immediate();
}
