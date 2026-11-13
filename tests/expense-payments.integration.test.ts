import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runDatabaseWorkers } from './helpers/database-workers';
import { migrate } from '../src/lib/server/identity';
import { backupDatabase } from '../src/lib/server/backup';
import { createChore, changeChore } from '../src/lib/server/chores';
import { balance, recordPayout } from '../src/lib/server/payouts';
import { createExpense, updateExpense, setExpenseState } from '../src/lib/server/expenses';
import { recordExpensePayment, reverseExpensePayment, listExpensePayments } from '../src/lib/server/expense-payments';

it('records a payment idempotently, preserves it on reversal, and permits a corrected replacement', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    await migrate(db);
    for (const id of ['parent', 'kid']) db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, `${id}@example.test`);
    db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'Synthetic');
    for (const [id, role] of [['parent', 'parent'], ['kid', 'kid']]) db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(id, 'home', role);
    const input = { title: 'Internet', amountCents: 7000, dueDate: '2099-01-31', cadence: 'once' as const, payee: '', category: '', notes: '' };
    const expense = createExpense(db, 'parent', 'home', input);
    const payment = { expenseId: expense, scheduledDate: '2099-01-31', paidDate: '2099-01-30', amountCents: 6900, note: 'receipt', requestId: 'first' };
    expect(() => recordExpensePayment(db, 'kid', 'home', payment)).toThrow();
    const id = recordExpensePayment(db, 'parent', 'home', payment);
    expect(recordExpensePayment(db, 'parent', 'home', payment)).toBe(id);
    expect(() => recordExpensePayment(db, 'parent', 'home', { ...payment, requestId: 'second' })).toThrow();
    expect(() => updateExpense(db, 'parent', 'home', expense, { ...input, dueDate: '2099-02-01' })).toThrow();
    expect(() => db.prepare('DELETE FROM expense_payment WHERE id = ?').run(id)).toThrow();
    reverseExpensePayment(db, 'parent', 'home', id, 'Incorrect amount');
    expect(() => reverseExpensePayment(db, 'parent', 'home', id, 'Again')).toThrow();
    const replacement = recordExpensePayment(db, 'parent', 'home', { ...payment, requestId: 'replacement', amountCents: 7000 });
    expect(replacement).not.toBe(id);
    expect(db.prepare('SELECT amount_cents FROM expense_payment ORDER BY amount_cents').all()).toEqual([{ amount_cents: 6900 }, { amount_cents: 7000 }]);
    expect(db.prepare('SELECT reason FROM expense_payment_reversal').get()).toEqual({ reason: 'Incorrect amount' });
    expect(db.pragma('foreign_key_check')).toEqual([]);
  } finally { db.close(); }
});

it('permits correcting a recorded occurrence after its recurring series ends', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    await migrate(db);
    db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run('parent', 'Parent', 'parent@example.test');
    db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'Synthetic');
    db.prepare("INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, 'parent')").run('parent', 'home');
    const expenseId = createExpense(db, 'parent', 'home', { title: 'Internet', amountCents: 7000, dueDate: '2099-01-31', cadence: 'monthly', payee: '', category: '', notes: '' });
    const payment = { expenseId, scheduledDate: '2099-01-31', paidDate: '2099-01-30', amountCents: 6900, note: '', requestId: 'first' };
    const id = recordExpensePayment(db, 'parent', 'home', payment);
    setExpenseState(db, 'parent', 'home', expenseId, 'ended');
    reverseExpensePayment(db, 'parent', 'home', id, 'Incorrect amount');
    expect(recordExpensePayment(db, 'parent', 'home', { ...payment, requestId: 'second', amountCents: 7000 })).not.toBe(id);
  } finally { db.close(); }
});

it('allows only one active payment across independent connections', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'expense-payment-race-'));
  const path = join(directory, 'synthetic.sqlite');
  const db = new Database(path);
  try {
    db.pragma('foreign_keys = ON');
    await migrate(db);
    db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run('parent', 'Parent', 'parent@example.test');
    db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'Synthetic');
    db.prepare("INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, 'parent')").run('parent', 'home');
    db.prepare("INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)").run('second-parent', 'Second', 'second@example.test');
    db.prepare("INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, 'parent')").run('second-parent', 'home');
    const id = createExpense(db, 'parent', 'home', { title: 'Internet', amountCents: 7000, dueDate: '2099-01-31', cadence: 'once', payee: '', category: '', notes: '' });
    const outcomes = await runDatabaseWorkers('tests/fixtures/record-expense-payment.ts', [[path, id, 'one', 'parent'], [path, id, 'two', 'second-parent']]);
    expect(outcomes.sort()).toEqual(['paid', 'rejected']);
    expect(db.prepare('SELECT count(*) AS count FROM expense_payment').get()).toEqual({ count: 1 });
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

it('blocks direct database changes to a paid one-off date and paid occurrence skip', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    await migrate(db);
    db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run('parent', 'Parent', 'parent@example.test');
    db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'Synthetic');
    db.prepare("INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, 'parent')").run('parent', 'home');
    const id = createExpense(db, 'parent', 'home', { title: 'Internet', amountCents: 7000, dueDate: '2099-01-31', cadence: 'once', payee: '', category: '', notes: '' });
    recordExpensePayment(db, 'parent', 'home', { expenseId: id, scheduledDate: '2099-01-31', paidDate: '2099-01-30', amountCents: 7000, note: '', requestId: 'first' });
    expect(() => db.prepare('UPDATE expense SET due_date = ? WHERE id = ?').run('2099-02-01', id)).toThrow();
    expect(() => db.prepare('INSERT INTO expense_skip VALUES (?, ?, ?, ?)').run(id, '2099-01-31', 'parent', '2099-01-01')).toThrow();
  } finally { db.close(); }
});

it('returns payment history only to the owning household parent', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    await migrate(db);
    for (const id of ['parent', 'kid', 'outsider']) db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, `${id}@example.test`);
    for (const id of ['home', 'other']) db.prepare('INSERT INTO household VALUES (?, ?)').run(id, id);
    for (const [id, household, role] of [['parent', 'home', 'parent'], ['kid', 'home', 'kid'], ['outsider', 'other', 'parent']]) db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(id, household, role);
    const input = { title: 'Internet', amountCents: 7000, dueDate: '2099-01-31', cadence: 'once' as const, payee: 'Provider', category: 'Utilities', notes: 'Original note' };
    const expenseId = createExpense(db, 'parent', 'home', input);
    const id = recordExpensePayment(db, 'parent', 'home', { expenseId, scheduledDate: '2099-01-31', paidDate: '2099-01-30', amountCents: 7000, note: '', requestId: 'first' });
    updateExpense(db, 'parent', 'home', expenseId, { ...input, title: 'New title', notes: 'Changed' });
    reverseExpensePayment(db, 'parent', 'home', id, 'Correction');
    expect(listExpensePayments(db, 'parent', 'home', '2099-01-01', '2099-01-31')).toMatchObject([{ id, plannedTitle: 'Internet', plannedAmountCents: 7000, plannedPayee: 'Provider', plannedCategory: 'Utilities', plannedNotes: 'Original note', amountCents: 7000, reversalReason: 'Correction' }]);
    expect(() => listExpensePayments(db, 'kid', 'home', '2099-01-01', '2099-01-31')).toThrow();
    expect(() => listExpensePayments(db, 'outsider', 'home', '2099-01-01', '2099-01-31')).toThrow();
    expect(listExpensePayments(db, 'outsider', 'other', '2099-01-01', '2099-01-31')).toEqual([]);
  } finally { db.close(); }
});

it('rejects invalid payments and request reuse with different data without writing', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    await migrate(db);
    db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run('parent', 'Parent', 'parent@example.test');
    db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'Synthetic');
    db.prepare("INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, 'parent')").run('parent', 'home');
    const expenseId = createExpense(db, 'parent', 'home', { title: 'Internet', amountCents: 7000, dueDate: '2099-01-31', cadence: 'monthly', payee: '', category: '', notes: '' });
    const input = { expenseId, scheduledDate: '2099-01-31', paidDate: '2099-01-30', amountCents: 7000, note: '', requestId: 'first' };
    for (const amountCents of [0, -1, 1.5]) expect(() => recordExpensePayment(db, 'parent', 'home', { ...input, amountCents })).toThrow();
    expect(() => recordExpensePayment(db, 'parent', 'home', { ...input, paidDate: '2099-02-30' })).toThrow();
    expect(() => recordExpensePayment(db, 'parent', 'home', { ...input, scheduledDate: '2099-02-01' })).toThrow();
    expect(db.prepare('SELECT count(*) AS count FROM expense_payment').get()).toEqual({ count: 0 });
    recordExpensePayment(db, 'parent', 'home', input);
    expect(() => recordExpensePayment(db, 'parent', 'home', { ...input, amountCents: 6999 })).toThrow();
    expect(db.prepare('SELECT count(*) AS count FROM expense_payment').get()).toEqual({ count: 1 });
  } finally { db.close(); }
});

it('restores recorded payments and reversals without changing chore balances', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'expense-recovery-'));
  const path = join(directory, 'source.sqlite');
  const backup = join(directory, 'backup.sqlite');
  const db = new Database(path);
  try {
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    await migrate(db);
    for (const id of ['parent', 'kid']) db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, `${id}@example.test`);
    db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'Synthetic');
    for (const [id, role] of [['parent', 'parent'], ['kid', 'kid']]) db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(id, 'home', role);
    const chore = createChore(db, 'parent', 'home', { title: 'Synthetic chore', assigneeId: 'kid', dueDate: '2026-10-30', rewardCents: 500 });
    changeChore(db, 'kid', 'home', chore, 'submit');
    changeChore(db, 'parent', 'home', chore, 'verify');
    recordPayout(db, 'parent', 'home', { childId: 'kid', amountCents: 200, date: '2026-10-30', note: '', requestId: 'payout' });
    const before = balance(db, 'home', 'kid');
    const expenseId = createExpense(db, 'parent', 'home', { title: 'Internet', amountCents: 7000, dueDate: '2099-01-31', cadence: 'once', payee: '', category: '', notes: '' });
    const input = { expenseId, scheduledDate: '2099-01-31', paidDate: '2099-01-30', amountCents: 6900, note: '', requestId: 'first' };
    const id = recordExpensePayment(db, 'parent', 'home', input);
    reverseExpensePayment(db, 'parent', 'home', id, 'Correct amount');
    recordExpensePayment(db, 'parent', 'home', { ...input, amountCents: 7000, requestId: 'replacement' });
    expect(balance(db, 'home', 'kid')).toEqual(before);
    await backupDatabase(path, backup);
    const restored = new Database(backup, { fileMustExist: true });
    try {
      restored.pragma('foreign_keys = ON');
      expect(restored.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(restored.pragma('foreign_key_check')).toEqual([]);
      expect(balance(restored, 'home', 'kid')).toEqual(before);
      expect(listExpensePayments(restored, 'parent', 'home', '2099-01-01', '2099-01-31')).toHaveLength(2);
      expect(restored.prepare('SELECT reason FROM expense_payment_reversal').get()).toEqual({ reason: 'Correct amount' });
    } finally { restored.close(); }
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

it('rolls back a rejected database insertion and remains usable', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    await migrate(db);
    db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run('parent', 'Parent', 'parent@example.test');
    db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'Synthetic');
    db.prepare("INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, 'parent')").run('parent', 'home');
    const expenseId = createExpense(db, 'parent', 'home', { title: 'Internet', amountCents: 7000, dueDate: '2099-01-31', cadence: 'once', payee: '', category: '', notes: '' });
    const input = { expenseId, scheduledDate: '2099-01-31', paidDate: '2099-01-30', amountCents: 7000, note: '', requestId: 'first' };
    db.exec("CREATE TEMP TRIGGER fail_expense_payment BEFORE INSERT ON expense_payment BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END");
    expect(() => recordExpensePayment(db, 'parent', 'home', input)).toThrow();
    expect(db.prepare('SELECT count(*) AS count FROM expense_payment').get()).toEqual({ count: 0 });
    db.exec('DROP TRIGGER fail_expense_payment');
    expect(recordExpensePayment(db, 'parent', 'home', input)).toBeTruthy();
  } finally { db.close(); }
});

it('rechecks parent membership after waiting for the writer lock', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'expense-revocation-'));
  const path = join(directory, 'synthetic.sqlite');
  const db = new Database(path);
  try {
    db.pragma('foreign_keys = ON');
    await migrate(db);
    for (const id of ['parent', 'other']) db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, `${id}@example.test`);
    db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'Synthetic');
    for (const id of ['parent', 'other']) db.prepare("INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, 'parent')").run(id, 'home');
    const expenseId = createExpense(db, 'parent', 'home', { title: 'Internet', amountCents: 7000, dueDate: '2099-01-31', cadence: 'once', payee: '', category: '', notes: '' });
    db.exec('BEGIN IMMEDIATE');
    const worker = spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/record-expense-payment.ts', path, expenseId, 'race', 'parent'], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], signal: AbortSignal.timeout(5000) });
    const exited = once(worker, 'exit');
    const result = new Promise<string>((resolve, reject) => {
      worker.on('error', reject);
      worker.on('message', message => {
        if (message === 'ready') worker.send('go');
        if (message === 'attempting') {
          db.prepare('UPDATE membership SET disabled_at = ?, disabled_by = ? WHERE user_id = ? AND household_id = ?').run(1, 'other', 'parent', 'home');
          db.exec('COMMIT');
        }
        if (message === 'paid' || message === 'rejected') resolve(message);
      });
      worker.on('exit', code => { if (code !== 0) reject(new Error(`Worker exited with ${code}`)); });
    });
    expect(await result).toBe('rejected');
    expect(await exited).toEqual([0, null]);
    expect(db.prepare('SELECT count(*) AS count FROM expense_payment').get()).toEqual({ count: 0 });
  } finally { if (db.inTransaction) db.exec('ROLLBACK'); db.close(); rmSync(directory, { recursive: true, force: true }); }
});
