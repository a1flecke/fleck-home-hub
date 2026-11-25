import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { transition, type ChoreAction, type ChoreRole, type ChoreState } from '../chores/domain';
import { changesBetween, normalizeChoreEdit, type ChoreChange, type ChoreEditInput, type NormalizedChoreEdit } from '../chores/edit';
import { localDate } from '../chores/recurrence';

export type CreateChoreInput = { title: string; description?: string; assigneeId: string; dueDate: string; rewardCents?: number | null };
export type ChoreChangeCode = 'not-authorized' | 'not-editable' | 'recurring' | 'stale' | 'cancelled' | 'invalid';

export class ChoreChangeError extends Error {
  constructor(readonly code: ChoreChangeCode) { super(code); }
}

type EditableChore = NormalizedChoreEdit & { status: ChoreState; updated_at: string; cancelled_at: string | null };

function parent(db: Database.Database, actor: string, household: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM active_membership WHERE user_id = ? AND household_id = ? AND role = 'parent'").get(actor, household));
}

/** Keep update timestamps strictly increasing so two edits cannot share a concurrency token. */
function nextTimestamp(previous: string): string {
  const prior = Date.parse(previous);
  const time = Number.isFinite(prior) ? Math.max(Date.now(), prior + 1) : Date.now();
  return new Date(time).toISOString();
}

function editableChore(db: Database.Database, id: string, household: string): EditableChore | undefined {
  return db.prepare(`SELECT title, description, assignee_id AS assigneeId, due_date AS dueDate,
    reward_cents AS rewardCents, status, updated_at, cancelled_at
    FROM chore WHERE id = ? AND household_id = ?`).get(id, household) as EditableChore | undefined;
}

function recordRevision(db: Database.Database, id: string, actor: string, at: string, changes: ChoreChange): void {
  db.prepare('INSERT INTO chore_revision (chore_id, actor_id, changed_at, changes) VALUES (?, ?, ?, ?)').run(id, actor, at, JSON.stringify(changes));
}

export function changeChore(db: Database.Database, actor: string, household: string, id: string, action: ChoreAction, reason?: string): void {
  db.transaction(() => {
    const member = db.prepare('SELECT role FROM active_membership WHERE user_id = ? AND household_id = ?').get(actor, household) as { role: ChoreRole } | undefined;
    const chore = db.prepare('SELECT status, assignee_id, reward_cents, cancelled_at FROM chore WHERE id = ? AND household_id = ?').get(id, household) as { status: ChoreState; assignee_id: string; reward_cents: number | null; cancelled_at: string | null } | undefined;
    if (!member || !chore || (member.role === 'kid' && chore.assignee_id !== actor)) throw new Error('Not authorized');
    if (chore.cancelled_at) throw new Error('Chore cancelled');
    if (db.prepare('SELECT 1 FROM recurring_occurrence o JOIN recurring_skip s ON s.series_id = o.series_id AND s.scheduled_date = o.scheduled_date WHERE o.chore_id = ?').get(id)) throw new Error('Occurrence skipped');
    if (action === 'submit') {
      const recurring = db.prepare('SELECT o.scheduled_date, s.state, s.paused_on FROM recurring_occurrence o JOIN recurring_series s ON s.id = o.series_id WHERE o.chore_id = ?').get(id) as { scheduled_date: string; state: string; paused_on: string | null } | undefined;
      if (recurring) {
        const settings = db.prepare('SELECT timezone FROM household_settings WHERE household_id = ?').get(household) as { timezone: string } | undefined;
        const today = localDate(new Date(), settings?.timezone ?? 'America/Chicago');
        const inactiveSince = recurring.paused_on ?? today;
        if (recurring.scheduled_date > today || (recurring.scheduled_date >= inactiveSince && recurring.state !== 'active' && chore.status === 'todo')) throw new Error('Occurrence not available');
      }
    }
    const next = transition(chore.status, action, member.role);
    const explanation = action === 'rework' ? reason?.trim() || null : null;
    if (action === 'rework' && !explanation) throw new Error('A rework reason is required');
    if (explanation && explanation.length > 1000) throw new Error('Invalid reason');
    const now = new Date().toISOString();
    const changed = db.prepare('UPDATE chore SET status = ?, rework_reason = ?, updated_at = ? WHERE id = ? AND cancelled_at IS NULL').run(next, explanation, now, id);
    if (!changed.changes) throw new Error('Chore cancelled');
    db.prepare('INSERT INTO chore_transition (chore_id, actor_id, from_status, to_status, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, actor, chore.status, next, explanation, now);
    if (next === 'verified' && chore.reward_cents) db.prepare('INSERT INTO earning (id, chore_id, household_id, child_id, amount_cents, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), id, household, chore.assignee_id, chore.reward_cents, now);
  }).immediate();
}

export function createChore(db: Database.Database, actor: string, household: string, input: CreateChoreInput): string {
  return db.transaction(() => {
    const parent = db.prepare("SELECT 1 FROM active_membership WHERE user_id = ? AND household_id = ? AND role = 'parent'").get(actor, household);
    const child = db.prepare("SELECT 1 FROM active_membership WHERE user_id = ? AND household_id = ? AND role = 'kid'").get(input.assigneeId, household);
    if (!parent || !child) throw new Error('Not authorized');
    const title = input.title.trim();
    const description = input.description?.trim() || null;
    const date = new Date(`${input.dueDate}T00:00:00Z`);
    if (!title || title.length > 120 || (description && description.length > 1000) || !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== input.dueDate || (input.rewardCents != null && (!Number.isSafeInteger(input.rewardCents) || input.rewardCents < 0 || input.rewardCents > 100000000))) throw new Error('Invalid chore');
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO chore (id, household_id, assignee_id, title, description, due_date, reward_cents, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, household, input.assigneeId, title, description, input.dueDate, input.rewardCents ?? null, 'todo', now, now);
    db.prepare('INSERT INTO chore_transition (chore_id, actor_id, from_status, to_status, created_at) VALUES (?, ?, NULL, ?, ?)').run(id, actor, 'todo', now);
    return id;
  }).immediate();
}

/**
 * Correct an unstarted one-off chore. The expected update timestamp is the concurrency token:
 * a parent who loaded an older view can never overwrite newer work. Recurring occurrences are
 * managed through their series, and started or verified work is immutable here.
 */
export function editChore(db: Database.Database, actor: string, household: string, id: string, expectedUpdatedAt: string, input: ChoreEditInput): void {
  db.transaction(() => {
    if (!parent(db, actor, household)) throw new ChoreChangeError('not-authorized');
    const chore = editableChore(db, id, household);
    if (!chore) throw new ChoreChangeError('not-editable');
    if (db.prepare('SELECT 1 FROM recurring_occurrence WHERE chore_id = ?').get(id)) throw new ChoreChangeError('recurring');
    if (chore.cancelled_at) throw new ChoreChangeError('cancelled');
    if (chore.status !== 'todo') throw new ChoreChangeError('not-editable');
    if (chore.updated_at !== expectedUpdatedAt) throw new ChoreChangeError('stale');
    let next: NormalizedChoreEdit;
    try { next = normalizeChoreEdit(input); } catch { throw new ChoreChangeError('invalid'); }
    if (!db.prepare("SELECT 1 FROM active_membership WHERE user_id = ? AND household_id = ? AND role = 'kid'").get(next.assigneeId, household)) throw new ChoreChangeError('not-authorized');
    const current: NormalizedChoreEdit = {
      title: chore.title,
      description: chore.description,
      assigneeId: chore.assigneeId,
      dueDate: chore.dueDate,
      rewardCents: chore.rewardCents
    };
    const changes = changesBetween(current, next);
    if (!changes) return;
    const now = nextTimestamp(chore.updated_at);
    const updated = db.prepare(`UPDATE chore SET title = ?, description = ?, assignee_id = ?, due_date = ?, reward_cents = ?, updated_at = ?
      WHERE id = ? AND household_id = ? AND status = 'todo' AND cancelled_at IS NULL AND updated_at = ?`)
      .run(next.title, next.description, next.assigneeId, next.dueDate, next.rewardCents, now, id, household, expectedUpdatedAt);
    if (!updated.changes) throw new ChoreChangeError('stale');
    recordRevision(db, id, actor, now, changes);
  }).immediate();
}

/** Cancel an unstarted one-off chore without deleting its row, transitions or any earnings history. */
export function cancelChore(db: Database.Database, actor: string, household: string, id: string, expectedUpdatedAt: string): void {
  db.transaction(() => {
    if (!parent(db, actor, household)) throw new ChoreChangeError('not-authorized');
    const chore = editableChore(db, id, household);
    if (!chore) throw new ChoreChangeError('not-editable');
    if (db.prepare('SELECT 1 FROM recurring_occurrence WHERE chore_id = ?').get(id)) throw new ChoreChangeError('recurring');
    if (chore.cancelled_at) throw new ChoreChangeError('cancelled');
    if (chore.status !== 'todo') throw new ChoreChangeError('not-editable');
    if (chore.updated_at !== expectedUpdatedAt) throw new ChoreChangeError('stale');
    const now = nextTimestamp(chore.updated_at);
    const cancelled = db.prepare(`UPDATE chore SET cancelled_at = ?, cancelled_by = ?, updated_at = ?
      WHERE id = ? AND household_id = ? AND status = 'todo' AND cancelled_at IS NULL AND updated_at = ?`)
      .run(now, actor, now, id, household, expectedUpdatedAt);
    if (!cancelled.changes) throw new ChoreChangeError('stale');
    recordRevision(db, id, actor, now, { cancelled: { from: null, to: now } });
  }).immediate();
}
