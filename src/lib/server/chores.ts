import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { transition, type ChoreAction, type ChoreRole, type ChoreState } from '../chores/domain';
import { localDate } from '../chores/recurrence';

export type CreateChoreInput = { title: string; description?: string; assigneeId: string; dueDate: string; rewardCents?: number | null };

export function changeChore(db: Database.Database, actor: string, household: string, id: string, action: ChoreAction, reason?: string): void {
  db.transaction(() => {
    const member = db.prepare('SELECT role FROM membership WHERE user_id = ? AND household_id = ?').get(actor, household) as { role: ChoreRole } | undefined;
    const chore = db.prepare('SELECT status, assignee_id, reward_cents FROM chore WHERE id = ? AND household_id = ?').get(id, household) as { status: ChoreState; assignee_id: string; reward_cents: number | null } | undefined;
    if (!member || !chore || (member.role === 'kid' && chore.assignee_id !== actor)) throw new Error('Not authorized');
    if (db.prepare('SELECT 1 FROM recurring_occurrence o JOIN recurring_skip s ON s.series_id = o.series_id AND s.scheduled_date = o.scheduled_date WHERE o.chore_id = ?').get(id)) throw new Error('Occurrence skipped');
    if (action === 'submit') {
      const recurring = db.prepare('SELECT o.scheduled_date, s.state FROM recurring_occurrence o JOIN recurring_series s ON s.id = o.series_id WHERE o.chore_id = ?').get(id) as { scheduled_date: string; state: string } | undefined;
      if (recurring) {
        const settings = db.prepare('SELECT timezone FROM household_settings WHERE household_id = ?').get(household) as { timezone: string } | undefined;
        const today = localDate(new Date(), settings?.timezone ?? 'America/Chicago');
        if (recurring.scheduled_date > today || (recurring.scheduled_date >= today && recurring.state !== 'active' && chore.status === 'todo')) throw new Error('Occurrence not available');
      }
    }
    const next = transition(chore.status, action, member.role);
    const explanation = action === 'rework' ? reason?.trim() || null : null;
    if (explanation && explanation.length > 1000) throw new Error('Invalid reason');
    const now = new Date().toISOString();
    db.prepare('UPDATE chore SET status = ?, rework_reason = ?, updated_at = ? WHERE id = ?').run(next, explanation, now, id);
    db.prepare('INSERT INTO chore_transition (chore_id, actor_id, from_status, to_status, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, actor, chore.status, next, explanation, now);
    if (next === 'verified' && chore.reward_cents) db.prepare('INSERT INTO earning (id, chore_id, household_id, child_id, amount_cents, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), id, household, chore.assignee_id, chore.reward_cents, now);
  }).immediate();
}

export function createChore(db: Database.Database, actor: string, household: string, input: CreateChoreInput): string {
  const parent = db.prepare("SELECT 1 FROM membership WHERE user_id = ? AND household_id = ? AND role = 'parent'").get(actor, household);
  const child = db.prepare("SELECT 1 FROM membership WHERE user_id = ? AND household_id = ? AND role = 'kid'").get(input.assigneeId, household);
  if (!parent || !child) throw new Error('Not authorized');
  const title = input.title.trim();
  const description = input.description?.trim() || null;
  const date = new Date(`${input.dueDate}T00:00:00Z`);
  if (!title || title.length > 120 || (description && description.length > 1000) || !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== input.dueDate || (input.rewardCents != null && (!Number.isSafeInteger(input.rewardCents) || input.rewardCents < 0 || input.rewardCents > 100000000))) throw new Error('Invalid chore');
  const id = randomUUID();
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare('INSERT INTO chore (id, household_id, assignee_id, title, description, due_date, reward_cents, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, household, input.assigneeId, title, description, input.dueDate, input.rewardCents ?? null, 'todo', now, now);
    db.prepare('INSERT INTO chore_transition (chore_id, actor_id, from_status, to_status, created_at) VALUES (?, ?, NULL, ?, ?)').run(id, actor, 'todo', now);
  })();
  return id;
}
