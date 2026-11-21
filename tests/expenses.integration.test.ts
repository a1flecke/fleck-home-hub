import { expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../src/lib/server/identity';
import { createExpense, listExpensePlans, listExpenses, setExpenseState, skipExpense, updateExpense } from '../src/lib/server/expenses';

it('keeps expense plans private and preserves their lifecycle across future edits', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    await migrate(db);
    for (const id of ['parent', 'kid', 'outsider']) db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, `${id}@example.test`);
    for (const id of ['home', 'other']) db.prepare('INSERT INTO household VALUES (?, ?)').run(id, id);
    for (const [id, household, role] of [['parent', 'home', 'parent'], ['kid', 'home', 'kid'], ['outsider', 'other', 'parent']]) db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(id, household, role);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T18:00:00Z'));
    const input = { title: 'Internet', amountCents: 7000, dueDate: '2026-01-31', cadence: 'monthly' as const, payee: '', category: '', notes: '' };
    expect(() => createExpense(db, 'kid', 'home', input)).toThrow();
    expect(() => createExpense(db, 'outsider', 'home', input)).toThrow();
    expect(() => createExpense(db, 'parent', 'home', { ...input, amountCents: 1.5 })).toThrow();
    const id = createExpense(db, 'parent', 'home', input);
    expect(() => listExpenses(db, 'kid', 'home', '2026-01-01', '2026-03-31')).toThrow();
    expect(() => listExpenses(db, 'outsider', 'home', '2026-01-01', '2026-03-31')).toThrow();
    expect(listExpenses(db, 'parent', 'home', '2026-01-01', '2026-03-31').map(x => x.date)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    skipExpense(db, 'parent', 'home', id, '2026-02-28');
    updateExpense(db, 'parent', 'home', id, { ...input, title: 'Internet updated', amountCents: 8000 });
    expect(listExpenses(db, 'parent', 'home', '2026-01-01', '2026-03-31').map(x => [x.date, x.amountCents])).toEqual([['2026-01-31', 8000], ['2026-03-31', 8000]]);
    setExpenseState(db, 'parent', 'home', id, 'paused');
    vi.setSystemTime(new Date('2026-03-01T18:00:00Z'));
    setExpenseState(db, 'parent', 'home', id, 'active');
    expect(listExpenses(db, 'parent', 'home', '2026-01-01', '2026-03-31').map(x => x.date)).toEqual(['2026-03-31']);
    setExpenseState(db, 'parent', 'home', id, 'ended');
    expect(listExpenses(db, 'parent', 'home', '2026-01-01', '2026-03-31')).toEqual([]);
    expect(() => setExpenseState(db, 'parent', 'home', id, 'active')).toThrow();
    expect(db.pragma('foreign_key_check')).toEqual([]);
  } finally { vi.useRealTimers(); db.close(); }
});

it('allows repeated pause and resume on the same household-local day', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    await migrate(db);
    db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run('parent', 'Parent', 'parent@example.test');
    db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'Synthetic');
    db.prepare("INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, 'parent')").run('parent', 'home');
    const id = createExpense(db, 'parent', 'home', { title: 'Rent', amountCents: 100, dueDate: '2099-01-01', cadence: 'monthly', payee: '', category: '', notes: '' });
    setExpenseState(db, 'parent', 'home', id, 'paused');
    setExpenseState(db, 'parent', 'home', id, 'active');
    setExpenseState(db, 'parent', 'home', id, 'paused');
    setExpenseState(db, 'parent', 'home', id, 'active');
  } finally { db.close(); }
});

it('moves an unpaid one-off occurrence and rejects disabled parents', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    await migrate(db);
    for (const id of ['parent', 'other-parent']) db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, `${id}@example.test`);
    db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'Synthetic');
    for (const id of ['parent', 'other-parent']) db.prepare("INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, 'parent')").run(id, 'home');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T18:00:00Z'));
    const input = { title: 'Repair', amountCents: 5000, dueDate: '2026-01-10', cadence: 'once' as const, payee: '', category: '', notes: '' };
    const id = createExpense(db, 'parent', 'home', input);
    updateExpense(db, 'parent', 'home', id, { ...input, dueDate: '2026-01-20' });
    expect(listExpenses(db, 'parent', 'home', '2026-01-01', '2026-01-31').map(item => item.date)).toEqual(['2026-01-20']);
    db.prepare('UPDATE membership SET disabled_at = ?, disabled_by = ? WHERE user_id = ? AND household_id = ?').run(1, 'other-parent', 'parent', 'home');
    expect(() => listExpenses(db, 'parent', 'home', '2026-01-01', '2026-01-31')).toThrow();
    expect(() => updateExpense(db, 'parent', 'home', id, input)).toThrow();
  } finally { vi.useRealTimers(); db.close(); }
});

it('applies an edit to a one-off occurrence that is due today or overdue', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    await migrate(db);
    db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run('parent', 'Parent', 'parent@example.test');
    db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'Synthetic');
    db.prepare("INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, 'parent')").run('parent', 'home');
    db.prepare("INSERT INTO household_settings (household_id, timezone) VALUES ('home', 'America/Chicago')").run();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-10T18:00:00Z'));
    const input = { title: 'Plumber', amountCents: 10000, dueDate: '2026-01-05', cadence: 'once' as const, payee: '', category: '', notes: '' };
    const overdue = createExpense(db, 'parent', 'home', input);
    updateExpense(db, 'parent', 'home', overdue, { ...input, title: 'Plumber (corrected)', amountCents: 25000 });
    expect(listExpenses(db, 'parent', 'home', '2026-01-01', '2026-01-31').map(item => [item.date, item.title, item.amountCents]))
      .toEqual([['2026-01-05', 'Plumber (corrected)', 25000]]);

    const today = createExpense(db, 'parent', 'home', { ...input, title: 'Vet', dueDate: '2026-01-20' });
    updateExpense(db, 'parent', 'home', today, { ...input, title: 'Vet visit', amountCents: 9000, dueDate: '2026-01-10' });
    expect(listExpenses(db, 'parent', 'home', '2026-01-10', '2026-01-10').map(item => [item.title, item.amountCents])).toEqual([['Vet visit', 9000]]);
    expect(listExpensePlans(db, 'parent', 'home').map(plan => [plan.title, plan.amountCents])).toEqual([['Plumber (corrected)', 25000], ['Vet visit', 9000]]);
  } finally { vi.useRealTimers(); db.close(); }
});

it('keeps recurring edits effective only after the household-local date', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    await migrate(db);
    db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run('parent', 'Parent', 'parent@example.test');
    db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'Synthetic');
    db.prepare("INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, 'parent')").run('parent', 'home');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-10T18:00:00Z'));
    const input = { title: 'Lessons', amountCents: 4000, dueDate: '2026-01-03', cadence: 'weekly' as const, payee: '', category: '', notes: '' };
    const id = createExpense(db, 'parent', 'home', input);
    updateExpense(db, 'parent', 'home', id, { ...input, amountCents: 4500 });
    expect(listExpenses(db, 'parent', 'home', '2026-01-03', '2026-01-17').map(item => [item.date, item.amountCents]))
      .toEqual([['2026-01-03', 4000], ['2026-01-10', 4000], ['2026-01-17', 4500]]);
  } finally { vi.useRealTimers(); db.close(); }
});
