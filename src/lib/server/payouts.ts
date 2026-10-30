import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { nextPayday } from '../earnings/payday';

type PayoutInput = { childId: string; amountCents: number; date: string; note: string; requestId: string };

export function setPayday(db: Database.Database, actor: string, household: string, anchor: string, cadence: number): void {
  if (!db.prepare("SELECT 1 FROM membership WHERE user_id = ? AND household_id = ? AND role = 'parent'").get(actor, household)) throw new Error('Not authorized');
  nextPayday(anchor, anchor, cadence);
  db.prepare('INSERT INTO payday_schedule (household_id, anchor_date, cadence_days, updated_by, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(household_id) DO UPDATE SET anchor_date = excluded.anchor_date, cadence_days = excluded.cadence_days, updated_by = excluded.updated_by, updated_at = excluded.updated_at').run(household, anchor, cadence, actor, new Date().toISOString());
}

export function balance(db: Database.Database, household: string, child: string) {
  const earned = (db.prepare('SELECT COALESCE(SUM(amount_cents), 0) AS total FROM earning WHERE household_id = ? AND child_id = ?').get(household, child) as { total: number }).total;
  const paid = (db.prepare('SELECT COALESCE(SUM(p.amount_cents), 0) AS total FROM payout p WHERE p.household_id = ? AND p.child_id = ? AND NOT EXISTS (SELECT 1 FROM payout_reversal r WHERE r.payout_id = p.id)').get(household, child) as { total: number }).total;
  return { earned, paid, owed: earned - paid };
}

export function reversePayout(db: Database.Database, actor: string, household: string, payoutId: string, reason: string): void {
  db.transaction(() => {
    const explanation = reason.trim();
    if (!explanation || explanation.length > 1000 || !db.prepare("SELECT 1 FROM membership m JOIN payout p ON p.household_id = m.household_id WHERE m.user_id = ? AND m.household_id = ? AND m.role = 'parent' AND p.id = ?").get(actor, household, payoutId)) throw new Error('Not authorized or invalid correction');
    db.prepare('INSERT INTO payout_reversal (id, payout_id, actor_id, reason, created_at) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), payoutId, actor, explanation, new Date().toISOString());
  }).immediate();
}

export function recordPayout(db: Database.Database, actor: string, household: string, input: PayoutInput): string {
  return db.transaction(() => {
    if (!db.prepare("SELECT 1 FROM membership WHERE user_id = ? AND household_id = ? AND role = 'parent'").get(actor, household) || !db.prepare("SELECT 1 FROM membership WHERE user_id = ? AND household_id = ? AND role = 'kid'").get(input.childId, household)) throw new Error('Not authorized');
    const parsed = new Date(`${input.date}T00:00:00Z`);
    const note = input.note.trim();
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== input.date || note.length > 1000 || !input.requestId || input.requestId.length > 128) throw new Error('Invalid payout');
    const existing = db.prepare('SELECT id, actor_id, child_id, amount_cents, paid_date, note FROM payout WHERE household_id = ? AND request_id = ?').get(household, input.requestId) as { id: string; actor_id: string; child_id: string; amount_cents: number; paid_date: string; note: string | null } | undefined;
    if (existing) {
      if (existing.actor_id !== actor || existing.child_id !== input.childId || existing.amount_cents !== input.amountCents || existing.paid_date !== input.date || existing.note !== (note || null)) throw new Error('Request already used');
      return existing.id;
    }
    if (input.amountCents > balance(db, household, input.childId).owed) throw new Error('Amount exceeds balance');
    const id = randomUUID();
    db.prepare('INSERT INTO payout (id, household_id, child_id, actor_id, amount_cents, paid_date, note, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, household, input.childId, actor, input.amountCents, input.date, note || null, input.requestId, new Date().toISOString());
    return id;
  }).immediate();
}
