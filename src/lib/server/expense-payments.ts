import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { expenseDates } from '../expenses/recurrence';
import { listExpenses } from './expenses';

type PaymentInput = { expenseId: string; scheduledDate: string; paidDate: string; amountCents: number; note: string; requestId: string };
type PreviousPayment = { id: string; actor_id: string; expense_id: string; scheduled_date: string; paid_date: string; amount_cents: number; note: string | null };

function requireParent(db: Database.Database, actor: string, household: string): void {
  if (!db.prepare("SELECT 1 FROM active_membership WHERE user_id = ? AND household_id = ? AND role = 'parent'").get(actor, household)) throw new Error('Not authorized');
}

export function recordExpensePayment(db: Database.Database, actor: string, household: string, input: PaymentInput): string {
  return db.transaction(() => {
    requireParent(db, actor, household);
    expenseDates(input.paidDate, 'once', input.paidDate, input.paidDate);
    const note = input.note.trim() || null;
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0 || input.amountCents > 100000000 || (note?.length ?? 0) > 1000 || !input.requestId || input.requestId.length > 128) throw new Error('Invalid payment');
    const previous = db.prepare('SELECT id, actor_id, expense_id, scheduled_date, paid_date, amount_cents, note FROM expense_payment WHERE household_id = ? AND request_id = ?').get(household, input.requestId) as PreviousPayment | undefined;
    if (previous) {
      if (previous.actor_id !== actor || previous.expense_id !== input.expenseId || previous.scheduled_date !== input.scheduledDate || previous.paid_date !== input.paidDate || previous.amount_cents !== input.amountCents || previous.note !== note) throw new Error('Request already used');
      return previous.id;
    }
    const occurrence = listExpenses(db, actor, household, input.scheduledDate, input.scheduledDate).find(item => item.id === input.expenseId);
    const original = db.prepare('SELECT planned_title, planned_amount_cents, planned_payee, planned_category, planned_notes FROM expense_payment WHERE expense_id = ? AND scheduled_date = ? ORDER BY rowid LIMIT 1').get(input.expenseId, input.scheduledDate) as { planned_title: string; planned_amount_cents: number; planned_payee: string | null; planned_category: string | null; planned_notes: string | null } | undefined;
    if (!occurrence && !original) throw new Error('Expense unavailable');
    const plannedTitle = original?.planned_title ?? occurrence?.title;
    const plannedAmount = original?.planned_amount_cents ?? occurrence?.amountCents;
    const id = randomUUID();
    db.prepare('INSERT INTO expense_payment (id, household_id, expense_id, scheduled_date, paid_date, amount_cents, planned_title, planned_amount_cents, planned_payee, planned_category, planned_notes, actor_id, note, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, household, input.expenseId, input.scheduledDate, input.paidDate, input.amountCents, plannedTitle, plannedAmount, original ? original.planned_payee : occurrence?.payee ?? null, original ? original.planned_category : occurrence?.category ?? null, original ? original.planned_notes : occurrence?.notes ?? null, actor, note, input.requestId, new Date().toISOString());
    return id;
  }).immediate();
}

export function reverseExpensePayment(db: Database.Database, actor: string, household: string, paymentId: string, reason: string): void {
  db.transaction(() => {
    requireParent(db, actor, household);
    const explanation = reason.trim();
    if (!explanation || explanation.length > 1000 || !db.prepare('SELECT 1 FROM expense_payment WHERE id = ? AND household_id = ?').get(paymentId, household)) throw new Error('Invalid reversal');
    db.prepare('INSERT INTO expense_payment_reversal VALUES (?, ?, ?, ?, ?)').run(randomUUID(), paymentId, actor, explanation, new Date().toISOString());
  }).immediate();
}

export function listExpensePayments(db: Database.Database, actor: string, household: string, from: string, through: string) {
  requireParent(db, actor, household);
  expenseDates(from, 'once', from, through);
  return db.prepare(`SELECT p.id, p.expense_id AS expenseId, p.scheduled_date AS scheduledDate,
    p.paid_date AS paidDate, p.amount_cents AS amountCents, p.planned_title AS plannedTitle,
    p.planned_amount_cents AS plannedAmountCents, p.planned_payee AS plannedPayee,
    p.planned_category AS plannedCategory, p.planned_notes AS plannedNotes, p.actor_id AS actorId, p.note, p.created_at AS createdAt,
    r.actor_id AS reversedBy, r.reason AS reversalReason, r.created_at AS reversedAt
    FROM expense_payment p LEFT JOIN expense_payment_reversal r ON r.payment_id = p.id
    WHERE p.household_id = ? AND p.scheduled_date BETWEEN ? AND ?
    ORDER BY p.scheduled_date, p.created_at, p.id`).all(household, from, through);
}
