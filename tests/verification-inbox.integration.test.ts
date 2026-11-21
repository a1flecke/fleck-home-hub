import { afterEach, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../src/lib/server/identity';
import { changeChore, createChore } from '../src/lib/server/chores';
import { listReviewQueue, reviewChildSummaries } from '../src/lib/server/verification';

const opened: Database.Database[] = [];
afterEach(() => { for (const db of opened.splice(0)) db.close(); });

async function fixture() {
  const db = new Database(':memory:');
  opened.push(db);
  db.pragma('foreign_keys = ON');
  await migrate(db);
  for (const [id, name] of [['parent', 'Parent'], ['parent-two', 'Second Parent'], ['kid', 'Ada'], ['sibling', 'Ben'], ['other-parent', 'Other Parent'], ['other-kid', 'Other Kid']]) {
    db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, name, `${id}@example.test`);
  }
  db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'Synthetic');
  db.prepare('INSERT INTO household VALUES (?, ?)').run('other-home', 'Other Synthetic');
  for (const [user, household, role] of [['parent', 'home', 'parent'], ['parent-two', 'home', 'parent'], ['kid', 'home', 'kid'], ['sibling', 'home', 'kid'], ['other-parent', 'other-home', 'parent'], ['other-kid', 'other-home', 'kid']] as const) {
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(user, household, role);
  }
  return db;
}

function pending(db: Database.Database, id: string, child: string, reward: number, submittedAt: string) {
  db.prepare("INSERT INTO chore (id, household_id, assignee_id, title, due_date, reward_cents, status, created_at, updated_at) VALUES (?, 'home', ?, ?, '2026-11-01', ?, 'pending_verification', '2026-11-01', ?)")
    .run(id, child, id, reward, submittedAt);
  db.prepare("INSERT INTO chore_transition (chore_id, actor_id, from_status, to_status, created_at) VALUES (?, ?, 'todo', 'pending_verification', ?)").run(id, child, submittedAt);
}

it('pages parent review submissions by child and newest submission while keeping totals complete', async () => {
  const db = await fixture();
  for (let index = 0; index < 15; index++) {
    const stamp = new Date(Date.UTC(2026, 10, 1 + (index % 3), 9, index)).toISOString();
    pending(db, `kid-${String(index).padStart(2, '0')}`, 'kid', 200, stamp);
  }
  for (let index = 0; index < 10; index++) {
    const stamp = new Date(Date.UTC(2026, 10, 2 + (index % 2), 8, index)).toISOString();
    pending(db, `sibling-${String(index).padStart(2, '0')}`, 'sibling', 100, stamp);
  }
  const first = listReviewQueue(db, 'parent', 'home', { today: '2026-11-18', page: 1 });
  const second = listReviewQueue(db, 'parent', 'home', { today: '2026-11-18', page: 2 });
  expect(first.total).toBe(25);
  expect(first.pageCount).toBe(2);
  expect(first.items).toHaveLength(20);
  expect(second.items).toHaveLength(5);
  expect(new Set(first.items.map(item => item.id)).size).toBe(20);
  expect(first.items.some(item => second.items.some(next => next.id === item.id))).toBe(false);
  expect(first.items.slice(0, 15).every(item => item.childName === 'Ada')).toBe(true);
  expect(first.items[0].submittedAt >= first.items[1].submittedAt).toBe(true);
  expect(second.items.every(item => item.childName === 'Ben')).toBe(true);

  const filtered = listReviewQueue(db, 'parent', 'home', { today: '2026-11-18', childId: 'sibling' });
  expect(filtered.total).toBe(10);
  expect(filtered.items).toHaveLength(10);

  const summaries = reviewChildSummaries(db, 'parent', 'home');
  expect(summaries).toEqual([
    { id: 'kid', name: 'Ada', pendingCount: 15, pendingCents: 3000, owed: 0 },
    { id: 'sibling', name: 'Ben', pendingCount: 10, pendingCents: 1000, owed: 0 }
  ]);
});

it('rejects non-parent, cross-household and disabled-parent queue reads', async () => {
  const db = await fixture();
  pending(db, 'kid-1', 'kid', 200, '2026-11-16T09:00:00.000Z');
  expect(() => listReviewQueue(db, 'kid', 'home', { today: '2026-11-18' })).toThrow();
  expect(() => listReviewQueue(db, 'other-parent', 'home', { today: '2026-11-18' })).toThrow();
  expect(() => reviewChildSummaries(db, 'kid', 'home')).toThrow();
  db.prepare("UPDATE membership SET disabled_at = 1, disabled_by = 'parent-two' WHERE user_id = 'parent' AND household_id = 'home'").run();
  expect(() => listReviewQueue(db, 'parent', 'home', { today: '2026-11-18' })).toThrow();
});

it('verifies once, credits once and rejects a repeated or competing decision', async () => {
  const db = await fixture();
  pending(db, 'paid', 'kid', 250, '2026-11-16T09:00:00.000Z');
  expect(listReviewQueue(db, 'parent', 'home', { today: '2026-11-18' }).total).toBe(1);
  changeChore(db, 'parent', 'home', 'paid', 'verify');
  expect(db.prepare('SELECT chore_id, amount_cents FROM earning').all()).toEqual([{ chore_id: 'paid', amount_cents: 250 }]);
  expect(listReviewQueue(db, 'parent', 'home', { today: '2026-11-18' }).total).toBe(0);
  expect(() => changeChore(db, 'parent-two', 'home', 'paid', 'verify')).toThrow();
  expect(() => changeChore(db, 'parent', 'home', 'paid', 'rework', 'Too late')).toThrow();
  expect(db.prepare('SELECT count(*) AS count, sum(amount_cents) AS total FROM earning').get()).toEqual({ count: 1, total: 250 });
});

it('rejects a rework decision without a reason at the service boundary', async () => {
  const db = await fixture();
  pending(db, 'needs-reason', 'kid', 250, '2026-11-16T09:00:00.000Z');
  expect(() => changeChore(db, 'parent', 'home', 'needs-reason', 'rework')).toThrow('reason');
  expect(db.prepare('SELECT status FROM chore WHERE id = ?').get('needs-reason')).toEqual({ status: 'pending_verification' });
  expect(db.prepare('SELECT count(*) AS count FROM earning').get()).toEqual({ count: 0 });
});

it('returns work without creating a credit and makes it resubmittable', async () => {
  const db = await fixture();
  pending(db, 'rework', 'kid', 250, '2026-11-16T09:00:00.000Z');
  changeChore(db, 'parent', 'home', 'rework', 'rework', 'Dry the dishes');
  expect(db.prepare('SELECT status, rework_reason FROM chore WHERE id = ?').get('rework')).toEqual({ status: 'needs_rework', rework_reason: 'Dry the dishes' });
  expect(db.prepare('SELECT count(*) AS count FROM earning').get()).toEqual({ count: 0 });
  changeChore(db, 'kid', 'home', 'rework', 'submit');
  expect(listReviewQueue(db, 'parent', 'home', { today: '2026-11-18' }).total).toBe(1);
});

it('keeps a newly created one-off chore pending until a parent verifies it', async () => {
  const db = await fixture();
  const id = createChore(db, 'parent', 'home', { title: 'Synthetic', assigneeId: 'kid', dueDate: '2026-11-18', rewardCents: 100 });
  changeChore(db, 'kid', 'home', id, 'submit');
  expect(listReviewQueue(db, 'parent', 'home', { today: '2026-11-18' }).total).toBe(1);
  expect(db.prepare('SELECT count(*) AS count FROM earning').get()).toEqual({ count: 0 });
});
