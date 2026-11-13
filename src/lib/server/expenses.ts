import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { localDate } from '../chores/recurrence';
import { expenseDates, type ExpenseCadence } from '../expenses/recurrence';

type ExpenseInput = { title: string; amountCents: number; dueDate: string; cadence: ExpenseCadence; payee: string; category: string; notes: string };
type Expense = { id: string; due_date: string; cadence: ExpenseCadence; state: 'active' | 'paused' | 'ended'; ended_on: string | null };
type Version = { title: string; amount_cents: number; payee: string | null; category: string | null; notes: string | null };

function requireParent(db: Database.Database, actor: string, household: string): void {
  if (!db.prepare("SELECT 1 FROM active_membership WHERE user_id = ? AND household_id = ? AND role = 'parent'").get(actor, household)) throw new Error('Not authorized');
}

function today(db: Database.Database, household: string): string {
  const settings = db.prepare('SELECT timezone FROM household_settings WHERE household_id = ?').get(household) as { timezone: string } | undefined;
  return localDate(new Date(), settings?.timezone ?? 'America/Chicago');
}

function validate(input: ExpenseInput): void {
  expenseDates(input.dueDate, input.cadence, input.dueDate, input.dueDate);
  if (!input.title.trim() || input.title.trim().length > 120 || !Number.isSafeInteger(input.amountCents) || input.amountCents <= 0 || input.amountCents > 100000000 || input.payee.length > 120 || input.category.length > 120 || input.notes.length > 1000) throw new Error('Invalid expense');
}

function getExpense(db: Database.Database, household: string, id: string): Expense {
  const item = db.prepare('SELECT id, due_date, cadence, state, ended_on FROM expense WHERE id = ? AND household_id = ?').get(id, household) as Expense | undefined;
  if (!item) throw new Error('Expense unavailable');
  return item;
}

export function createExpense(db: Database.Database, actor: string, household: string, input: ExpenseInput): string {
  return db.transaction(() => {
    requireParent(db, actor, household);
    validate(input);
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO expense (id, household_id, creator_id, due_date, cadence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, household, actor, input.dueDate, input.cadence, now, now);
    db.prepare('INSERT INTO expense_version VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, '0000-01-01', input.title.trim(), input.amountCents, input.payee.trim() || null, input.category.trim() || null, input.notes.trim() || null, actor, now);
    return id;
  }).immediate();
}

export function updateExpense(db: Database.Database, actor: string, household: string, id: string, input: ExpenseInput): void {
  db.transaction(() => {
    requireParent(db, actor, household);
    const item = getExpense(db, household, id);
    validate(input);
    if (item.state === 'ended' || (item.cadence !== 'once' && item.due_date !== input.dueDate) || item.cadence !== input.cadence) throw new Error('Schedule cannot be changed');
    if (item.cadence === 'once' && item.due_date !== input.dueDate && db.prepare('SELECT 1 FROM expense_payment WHERE expense_id = ?').get(id)) throw new Error('Payment history exists');
    const next = new Date(`${today(db, household)}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const effective = next.toISOString().slice(0, 10);
    const now = new Date().toISOString();
    db.prepare('INSERT INTO expense_version VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(expense_id, effective_date) DO UPDATE SET title=excluded.title, amount_cents=excluded.amount_cents, payee=excluded.payee, category=excluded.category, notes=excluded.notes, actor_id=excluded.actor_id, created_at=excluded.created_at').run(id, effective, input.title.trim(), input.amountCents, input.payee.trim() || null, input.category.trim() || null, input.notes.trim() || null, actor, now);
    db.prepare('UPDATE expense SET due_date = ?, updated_at = ? WHERE id = ?').run(input.dueDate, now, id);
  }).immediate();
}

export function setExpenseState(db: Database.Database, actor: string, household: string, id: string, state: 'active' | 'paused' | 'ended'): void {
  db.transaction(() => {
    requireParent(db, actor, household);
    const item = getExpense(db, household, id);
    if (item.cadence === 'once' || item.state === 'ended' || item.state === state || !['active', 'paused', 'ended'].includes(state)) throw new Error('Invalid state');
    const date = today(db, household);
    const now = new Date().toISOString();
    if (state === 'paused') db.prepare('INSERT INTO expense_pause VALUES (?, ?, NULL, ?, ?)').run(id, date, actor, now);
    if (item.state === 'paused') db.prepare('UPDATE expense_pause SET end_date = ? WHERE expense_id = ? AND end_date IS NULL').run(date, id);
    db.prepare('UPDATE expense SET state = ?, ended_on = ?, updated_at = ? WHERE id = ?').run(state, state === 'ended' ? date : null, now, id);
  }).immediate();
}

export function skipExpense(db: Database.Database, actor: string, household: string, id: string, date: string): void {
  db.transaction(() => {
    requireParent(db, actor, household);
    const item = getExpense(db, household, id);
    if (item.cadence === 'once' || item.state !== 'active' || date <= today(db, household) || !expenseDates(item.due_date, item.cadence, date, date).length) throw new Error('Invalid occurrence');
    if (db.prepare('SELECT 1 FROM expense_payment WHERE expense_id = ? AND scheduled_date = ?').get(id, date)) throw new Error('Payment history exists');
    db.prepare('INSERT INTO expense_skip VALUES (?, ?, ?, ?)').run(id, date, actor, new Date().toISOString());
  }).immediate();
}

export function listExpenses(db: Database.Database, actor: string, household: string, from: string, through: string) {
  requireParent(db, actor, household);
  expenseDates(from, 'once', from, through);
  const items = db.prepare('SELECT id, due_date, cadence, state, ended_on FROM expense WHERE household_id = ?').all(household) as Expense[];
  const result: { id: string; date: string; title: string; amountCents: number; payee: string | null; category: string | null; notes: string | null }[] = [];
  for (const item of items) {
    for (const date of expenseDates(item.due_date, item.cadence, from, through)) {
      if ((item.ended_on && date >= item.ended_on) || db.prepare('SELECT 1 FROM expense_skip WHERE expense_id = ? AND scheduled_date = ?').get(item.id, date) || db.prepare('SELECT 1 FROM expense_pause WHERE expense_id = ? AND start_date <= ? AND (end_date IS NULL OR end_date > ?)').get(item.id, date, date)) continue;
      const version = db.prepare('SELECT title, amount_cents, payee, category, notes FROM expense_version WHERE expense_id = ? AND effective_date <= ? ORDER BY effective_date DESC LIMIT 1').get(item.id, date) as Version;
      result.push({ id: item.id, date, title: version.title, amountCents: version.amount_cents, payee: version.payee, category: version.category, notes: version.notes });
    }
  }
  return result.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
