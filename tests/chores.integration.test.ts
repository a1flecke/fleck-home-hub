import { afterEach, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../src/lib/server/identity';
import { createChore, changeChore } from '../src/lib/server/chores';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const opened: Database.Database[] = [];
afterEach(() => { for (const db of opened.splice(0)) db.close(); });

async function fixture(path = ':memory:') {
  const db = new Database(path); opened.push(db);
  db.pragma('foreign_keys = ON');
  await migrate(db);
  for (const id of ['parent', 'kid', 'other']) {
    db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, `${id}@example.test`);
  }
  db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'Synthetic');
  for (const [id, role] of [['parent', 'parent'], ['kid', 'kid'], ['other', 'kid']]) db.prepare('INSERT INTO membership VALUES (?, ?, ?)').run(id, 'home', role);
  return db;
}

it('allows a parent to create a chore for a child in the household', async () => {
  const db = await fixture();
  const id = createChore(db, 'parent', 'home', { title: 'Feed cat', assigneeId: 'kid', dueDate: '2026-10-30', rewardCents: 200 });
  expect(db.prepare('SELECT status, reward_cents FROM chore WHERE id = ?').get(id)).toEqual({ status: 'todo', reward_cents: 200 });
});

it('serializes competing approvals across independent SQLite connections', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-race-'));
  const path = join(dir, 'race.sqlite');
  try {
    const db = await fixture(path);
    db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run('parent2', 'Second parent', 'parent2@example.test');
    db.prepare('INSERT INTO membership VALUES (?, ?, ?)').run('parent2', 'home', 'parent');
    const id = createChore(db, 'parent', 'home', { title: 'Race', assigneeId: 'kid', dueDate: '2026-10-30', rewardCents: 200 });
    changeChore(db, 'kid', 'home', id, 'submit');
    const workers = ['parent', 'parent2'].map(actor => spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/verify-chore.ts', path, actor, id], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }));
    const outcomes = workers.map(worker => new Promise<string>((resolve, reject) => {
      worker.on('error', reject);
      worker.on('message', message => { if (message === 'ready') return; resolve(String(message)); });
      worker.on('exit', code => { if (code !== 0) reject(new Error(`worker exited ${code}`)); });
    }));
    await Promise.all(workers.map(worker => new Promise<void>((resolve, reject) => {
      worker.on('message', message => { if (message === 'ready') resolve(); });
      worker.on('error', reject);
    })));
    for (const worker of workers) worker.send('go');
    expect((await Promise.all(outcomes)).sort()).toEqual(['rejected', 'verified']);
    expect(db.prepare('SELECT count(*) AS count, sum(amount_cents) AS total FROM earning').get()).toEqual({ count: 1, total: 200 });
    db.close(); opened.splice(opened.indexOf(db), 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it('rejects child creation and invalid assignees or inputs', async () => {
  const db = await fixture();
  const input = { title: 'Feed cat', assigneeId: 'kid', dueDate: '2026-10-30', rewardCents: 200 };
  expect(() => createChore(db, 'kid', 'home', input)).toThrow();
  expect(() => createChore(db, 'parent', 'home', { ...input, assigneeId: 'parent' })).toThrow();
  expect(() => createChore(db, 'parent', 'forged', input)).toThrow();
  expect(() => createChore(db, 'parent', 'home', { ...input, rewardCents: 1.5 })).toThrow();
  expect(() => createChore(db, 'parent', 'home', { ...input, dueDate: '2026-02-30' })).toThrow();
  db.prepare('INSERT INTO household VALUES (?, ?)').run('other-home', 'Other');
  db.prepare('INSERT INTO membership VALUES (?, ?, ?)').run('other', 'other-home', 'parent');
  const id = createChore(db, 'parent', 'home', input);
  changeChore(db, 'kid', 'home', id, 'submit');
  expect(() => changeChore(db, 'other', 'other-home', id, 'verify')).toThrow();
  expect(() => changeChore(db, 'other', 'home', id, 'verify')).toThrow();
  expect(db.prepare('SELECT count(*) AS count FROM earning').get()).toEqual({ count: 0 });
});

it('only credits a paid chore once after parent verification and records actors', async () => {
  const db = await fixture();
  const id = createChore(db, 'parent', 'home', { title: 'Feed cat', assigneeId: 'kid', dueDate: '2026-10-30', rewardCents: 200 });
  expect(() => changeChore(db, 'other', 'home', id, 'submit')).toThrow();
  changeChore(db, 'kid', 'home', id, 'submit');
  expect(db.prepare('SELECT count(*) AS count FROM earning').get()).toEqual({ count: 0 });
  expect(() => changeChore(db, 'kid', 'home', id, 'verify')).toThrow();
  expect(() => changeChore(db, 'parent', 'forged', id, 'verify')).toThrow();
  changeChore(db, 'parent', 'home', id, 'verify');
  expect(() => changeChore(db, 'parent', 'home', id, 'verify')).toThrow();
  expect(db.prepare('SELECT child_id, amount_cents FROM earning').all()).toEqual([{ child_id: 'kid', amount_cents: 200 }]);
  expect(db.prepare('SELECT actor_id, from_status, to_status FROM chore_transition ORDER BY id').all()).toEqual([
    { actor_id: 'parent', from_status: null, to_status: 'todo' },
    { actor_id: 'kid', from_status: 'todo', to_status: 'pending_verification' },
    { actor_id: 'parent', from_status: 'pending_verification', to_status: 'verified' }
  ]);
  expect(() => db.prepare('UPDATE earning SET amount_cents = 1').run()).toThrow();
  expect(() => db.prepare('DELETE FROM earning').run()).toThrow();
  db.prepare('UPDATE chore SET reward_cents = 999 WHERE id = ?').run(id);
  expect(db.prepare('SELECT amount_cents FROM earning WHERE chore_id = ?').get(id)).toEqual({ amount_cents: 200 });
});

it('allows rework and resubmission without crediting an unpaid chore', async () => {
  const db = await fixture();
  const id = createChore(db, 'parent', 'home', { title: 'Tidy', assigneeId: 'kid', dueDate: '2026-10-30' });
  changeChore(db, 'kid', 'home', id, 'submit');
  changeChore(db, 'parent', 'home', id, 'rework', 'Please finish');
  expect(db.prepare('SELECT status, rework_reason FROM chore WHERE id = ?').get(id)).toEqual({ status: 'needs_rework', rework_reason: 'Please finish' });
  expect(db.prepare('SELECT count(*) AS count FROM earning').get()).toEqual({ count: 0 });
  changeChore(db, 'kid', 'home', id, 'submit');
  changeChore(db, 'parent', 'home', id, 'verify');
  expect(db.prepare('SELECT count(*) AS count FROM earning').get()).toEqual({ count: 0 });
});

it('credits a paid reworked chore exactly once only after verification', async () => {
  const db = await fixture();
  const id = createChore(db, 'parent', 'home', { title: 'Tidy again', assigneeId: 'kid', dueDate: '2026-10-30', rewardCents: 250 });
  changeChore(db, 'kid', 'home', id, 'submit');
  changeChore(db, 'parent', 'home', id, 'rework', 'One more corner');
  changeChore(db, 'kid', 'home', id, 'submit');
  expect(db.prepare('SELECT count(*) AS count FROM earning').get()).toEqual({ count: 0 });
  changeChore(db, 'parent', 'home', id, 'verify');
  expect(() => changeChore(db, 'parent', 'home', id, 'verify')).toThrow();
  expect(db.prepare('SELECT count(*) AS count, sum(amount_cents) AS total FROM earning').get()).toEqual({ count: 1, total: 250 });
});
