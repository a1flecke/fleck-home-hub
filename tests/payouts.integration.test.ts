import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../src/lib/server/identity';
import { createChore, changeChore } from '../src/lib/server/chores';
import { balance, recordPayout, reversePayout, setPayday } from '../src/lib/server/payouts';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function fixture(path = ':memory:') {
  const db = new Database(path);
  db.pragma('foreign_keys = ON');
  await migrate(db);
  for (const id of ['parent', 'kid']) db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, `${id}@example.test`);
  db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'Synthetic');
  db.prepare('INSERT INTO membership VALUES (?, ?, ?)').run('parent', 'home', 'parent');
  db.prepare('INSERT INTO membership VALUES (?, ?, ?)').run('kid', 'home', 'kid');
  const chore = createChore(db, 'parent', 'home', { title: 'Synthetic', assigneeId: 'kid', dueDate: '2026-10-30', rewardCents: 500 });
  changeChore(db, 'kid', 'home', chore, 'submit');
  changeChore(db, 'parent', 'home', chore, 'verify');
  return db;
}

it('records a partial payout against verified earnings and makes repeats idempotent', async () => {
  const db = await fixture();
  try {
    const input = { childId: 'kid', amountCents: 200, date: '2026-10-30', note: '', requestId: 'synthetic-request' };
    const id = recordPayout(db, 'parent', 'home', input);
    expect(recordPayout(db, 'parent', 'home', input)).toBe(id);
    expect(balance(db, 'home', 'kid')).toEqual({ earned: 500, paid: 200, owed: 300 });
    expect(db.prepare('SELECT count(*) AS count FROM payout').get()).toEqual({ count: 1 });
    expect(() => db.prepare('UPDATE payout SET amount_cents = 1').run()).toThrow();
    expect(() => db.prepare('DELETE FROM payout').run()).toThrow();
  } finally { db.close(); }
});

it('rejects concurrent overpayment across independent connections', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-payout-race-'));
  const path = join(dir, 'synthetic.sqlite');
  const db = await fixture(path);
  try {
    const workers = ['one', 'two'].map(key => spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/record-payout.ts', path, key], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }));
    const outcomes = workers.map(worker => new Promise<string>((resolve, reject) => {
      worker.on('error', reject);
      worker.on('message', message => { if (message !== 'ready') resolve(String(message)); });
      worker.on('exit', code => { if (code !== 0) reject(new Error(`worker exited ${code}`)); });
    }));
    await Promise.all(workers.map(worker => new Promise<void>((resolve, reject) => {
      worker.on('message', message => { if (message === 'ready') resolve(); });
      worker.on('error', reject);
    })));
    for (const worker of workers) worker.send('go');
    expect((await Promise.all(outcomes)).sort()).toEqual(['paid', 'rejected']);
    expect(balance(db, 'home', 'kid')).toEqual({ earned: 500, paid: 400, owed: 100 });
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

it('rejects unauthorized, invalid, overpaid, and mismatched duplicate requests', async () => {
  const db = await fixture();
  try {
    const input = { childId: 'kid', amountCents: 200, date: '2026-10-30', note: '', requestId: 'request-a' };
    expect(() => recordPayout(db, 'kid', 'home', input)).toThrow();
    expect(() => recordPayout(db, 'parent', 'other-home', input)).toThrow();
    for (const amountCents of [0, -1, 501, 1.5]) expect(() => recordPayout(db, 'parent', 'home', { ...input, amountCents })).toThrow();
    expect(() => recordPayout(db, 'parent', 'home', { ...input, date: '2026-02-30' })).toThrow();
    recordPayout(db, 'parent', 'home', input);
    expect(() => recordPayout(db, 'parent', 'home', { ...input, amountCents: 201 })).toThrow();
    expect(balance(db, 'home', 'kid')).toEqual({ earned: 500, paid: 200, owed: 300 });
  } finally { db.close(); }
});

it('excludes pending rewards and reconciles earnings and full payments on the same date', async () => {
  const db = await fixture();
  try {
    const pending = createChore(db, 'parent', 'home', { title: 'Pending', assigneeId: 'kid', dueDate: '2026-10-30', rewardCents: 300 });
    changeChore(db, 'kid', 'home', pending, 'submit');
    const input = { childId: 'kid', amountCents: 800, date: '2026-10-30', note: '', requestId: 'first' };
    expect(() => recordPayout(db, 'parent', 'home', input)).toThrow();
    changeChore(db, 'parent', 'home', pending, 'verify');
    recordPayout(db, 'parent', 'home', input);
    expect(balance(db, 'home', 'kid')).toEqual({ earned: 800, paid: 800, owed: 0 });
    expect(() => recordPayout(db, 'parent', 'home', { ...input, amountCents: 1, requestId: 'second' })).toThrow();
  } finally { db.close(); }
});

it('corrects a payout with a single immutable compensating record', async () => {
  const db = await fixture();
  try {
    const id = recordPayout(db, 'parent', 'home', { childId: 'kid', amountCents: 200, date: '2026-10-30', note: '', requestId: 'request-a' });
    db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run('other-parent', 'Other', 'other-parent@example.test');
    db.prepare('INSERT INTO household VALUES (?, ?)').run('other-home', 'Other Synthetic');
    db.prepare('INSERT INTO membership VALUES (?, ?, ?)').run('other-parent', 'other-home', 'parent');
    expect(() => reversePayout(db, 'kid', 'home', id, 'Mistake')).toThrow();
    expect(() => reversePayout(db, 'other-parent', 'other-home', id, 'Mistake')).toThrow();
    expect(() => recordPayout(db, 'other-parent', 'other-home', { childId: 'kid', amountCents: 1, date: '2026-10-30', note: '', requestId: 'forged' })).toThrow();
    reversePayout(db, 'parent', 'home', id, 'Recorded by mistake');
    expect(balance(db, 'home', 'kid')).toEqual({ earned: 500, paid: 0, owed: 500 });
    expect(() => reversePayout(db, 'parent', 'home', id, 'Again')).toThrow();
    expect(() => db.prepare('UPDATE payout_reversal SET reason = ?').run('Changed')).toThrow();
    expect(() => db.prepare('DELETE FROM payout_reversal').run()).toThrow();
    expect(db.prepare('SELECT amount_cents FROM payout WHERE id = ?').get(id)).toEqual({ amount_cents: 200 });
  } finally { db.close(); }
});

it('allows only a parent to configure a valid household payday', async () => {
  const db = await fixture();
  try {
    expect(() => setPayday(db, 'kid', 'home', '2026-11-06', 7)).toThrow();
    expect(() => setPayday(db, 'parent', 'home', '2026-02-30', 7)).toThrow();
    expect(() => setPayday(db, 'parent', 'home', '2026-11-06', 10)).toThrow();
    setPayday(db, 'parent', 'home', '2026-11-06', 14);
    expect(db.prepare('SELECT anchor_date, cadence_days FROM payday_schedule WHERE household_id = ?').get('home')).toEqual({ anchor_date: '2026-11-06', cadence_days: 14 });
  } finally { db.close(); }
});
