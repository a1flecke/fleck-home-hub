import { afterEach, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../src/lib/server/identity';
import { cancelChore, changeChore, ChoreChangeError, createChore, editChore } from '../src/lib/server/chores';
import { createSeries, generateOccurrences } from '../src/lib/server/recurring';
import { choreScopeCounts, listChoreScope } from '../src/lib/server/my-day';
import { loadChoreWeek } from '../src/lib/server/chore-week';

const opened: Database.Database[] = [];
afterEach(() => { vi.useRealTimers(); for (const db of opened.splice(0)) db.close(); });

async function fixture() {
  const db = new Database(':memory:');
  opened.push(db);
  db.pragma('foreign_keys = ON');
  await migrate(db);
  for (const [id, name] of [['parent', 'Parent'], ['parent-two', 'Parent Two'], ['kid', 'Kid'], ['sibling', 'Sibling'], ['other-parent', 'Other Parent'], ['other-kid', 'Other Kid']]) {
    db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, name, `${id}@example.test`);
  }
  db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'Synthetic');
  db.prepare('INSERT INTO household VALUES (?, ?)').run('other-home', 'Other Synthetic');
  for (const [user, household, role] of [
    ['parent', 'home', 'parent'],
    ['parent-two', 'home', 'parent'],
    ['kid', 'home', 'kid'],
    ['sibling', 'home', 'kid'],
    ['other-parent', 'other-home', 'parent'],
    ['other-kid', 'other-home', 'kid']
  ] as const) {
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(user, household, role);
  }
  return db;
}

const base = { title: 'Clean room', description: 'Vacuum and dust', assigneeId: 'kid', dueDate: '2026-11-21', rewardCents: 200 };

function current(db: Database.Database, id: string) {
  return db.prepare('SELECT * FROM chore WHERE id = ?').get(id) as { title: string; description: string | null; assignee_id: string; due_date: string; reward_cents: number | null; status: string; updated_at: string; cancelled_at: string | null; cancelled_by: string | null };
}

it('edits an unstarted one-off chore and records only changed fields with the actor and time', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-20T12:00:00.000Z'));
  const db = await fixture();
  const id = createChore(db, 'parent', 'home', base);
  const before = current(db, id);
  editChore(db, 'parent', 'home', id, before.updated_at, { title: '  Clean bedroom  ', description: 'Dust the shelves', assigneeId: 'sibling', dueDate: '2026-11-22', rewardCents: 350 });
  const after = current(db, id);
  expect(after).toMatchObject({ title: 'Clean bedroom', description: 'Dust the shelves', assignee_id: 'sibling', due_date: '2026-11-22', reward_cents: 350, status: 'todo', cancelled_at: null });
  expect(after.updated_at).not.toBe(before.updated_at);
  const revision = db.prepare('SELECT actor_id, changes, changed_at FROM chore_revision WHERE chore_id = ?').get(id) as { actor_id: string; changes: string; changed_at: string };
  expect(revision.actor_id).toBe('parent');
  expect(revision.changed_at).toBe(after.updated_at);
  expect(JSON.parse(revision.changes)).toEqual({
    title: { from: 'Clean room', to: 'Clean bedroom' },
    description: { from: 'Vacuum and dust', to: 'Dust the shelves' },
    assigneeId: { from: 'kid', to: 'sibling' },
    dueDate: { from: '2026-11-21', to: '2026-11-22' },
    rewardCents: { from: 200, to: 350 }
  });
  expect(db.prepare('SELECT count(*) AS count FROM earning').get()).toEqual({ count: 0 });
});

it('rejects unauthorized, invalid, recurring and started work without writing changes', async () => {
  const db = await fixture();
  const id = createChore(db, 'parent', 'home', base);
  const before = current(db, id);
  const code = (fn: () => void) => {
    try { fn(); return 'none'; } catch (cause) { return cause instanceof ChoreChangeError ? cause.code : 'other'; }
  };
  expect(code(() => editChore(db, 'kid', 'home', id, before.updated_at, { ...base, title: 'Child edit' }))).toBe('not-authorized');
  expect(code(() => editChore(db, 'other-parent', 'home', id, before.updated_at, { ...base, title: 'Other edit' }))).toBe('not-authorized');
  expect(code(() => editChore(db, 'parent', 'home', id, before.updated_at, { ...base, assigneeId: 'other-kid' }))).toBe('not-authorized');
  expect(code(() => editChore(db, 'parent', 'home', id, before.updated_at, { ...base, title: '   ' }))).toBe('invalid');
  expect(code(() => cancelChore(db, 'kid', 'home', id, before.updated_at))).toBe('not-authorized');
  expect(current(db, id)).toEqual(before);
  expect(db.prepare('SELECT count(*) AS count FROM chore_revision').get()).toEqual({ count: 0 });

  const series = createSeries(db, 'parent', 'home', { title: 'Feed pet', assigneeId: 'kid', startDate: '2026-11-21', weekdays: [6] });
  generateOccurrences(db, 'parent', 'home', '2026-11-21', '2026-11-21');
  const occurrence = db.prepare('SELECT chore_id FROM recurring_occurrence WHERE series_id = ?').get(series) as { chore_id: string };
  const occurrenceBefore = current(db, occurrence.chore_id);
  expect(code(() => editChore(db, 'parent', 'home', occurrence.chore_id, occurrenceBefore.updated_at, { ...base, title: 'Detached occurrence' }))).toBe('recurring');
  expect(code(() => cancelChore(db, 'parent', 'home', occurrence.chore_id, occurrenceBefore.updated_at))).toBe('recurring');
  expect(current(db, occurrence.chore_id)).toEqual(occurrenceBefore);

  const pending = createChore(db, 'parent', 'home', { ...base, title: 'Pending chore' });
  const pendingBefore = current(db, pending);
  changeChore(db, 'kid', 'home', pending, 'submit');
  expect(code(() => editChore(db, 'parent', 'home', pending, pendingBefore.updated_at, { ...base, title: 'Edit pending' }))).toBe('not-editable');
  expect(code(() => cancelChore(db, 'parent', 'home', pending, pendingBefore.updated_at))).toBe('not-editable');

  const verified = createChore(db, 'parent', 'home', { ...base, title: 'Verified chore', rewardCents: 500 });
  const verifiedBefore = current(db, verified);
  changeChore(db, 'kid', 'home', verified, 'submit');
  changeChore(db, 'parent', 'home', verified, 'verify');
  expect(code(() => editChore(db, 'parent', 'home', verified, verifiedBefore.updated_at, { ...base, title: 'Edit verified' }))).toBe('not-editable');
  expect(code(() => cancelChore(db, 'parent', 'home', verified, verifiedBefore.updated_at))).toBe('not-editable');
  expect(db.prepare('SELECT amount_cents FROM earning WHERE chore_id = ?').get(verified)).toEqual({ amount_cents: 500 });
});

it('rejects a stale edit from another parent and keeps the newer work', async () => {
  const db = await fixture();
  const id = createChore(db, 'parent', 'home', base);
  const first = current(db, id);
  editChore(db, 'parent-two', 'home', id, first.updated_at, { ...base, title: 'Parent two version', dueDate: '2026-11-23' });
  const newer = current(db, id);
  let failure: unknown;
  try { editChore(db, 'parent', 'home', id, first.updated_at, { ...base, title: 'Stale parent version', dueDate: '2026-11-24' }); } catch (cause) { failure = cause; }
  expect(failure).toBeInstanceOf(ChoreChangeError);
  expect((failure as ChoreChangeError).code).toBe('stale');
  expect(current(db, id)).toEqual(newer);
  expect(db.prepare('SELECT count(*) AS count FROM chore_revision WHERE chore_id = ?').get(id)).toEqual({ count: 1 });
});

it('cancels an unstarted one-off without deleting it or creating earnings', async () => {
  const db = await fixture();
  const id = createChore(db, 'parent', 'home', base);
  const before = current(db, id);
  cancelChore(db, 'parent', 'home', id, before.updated_at);
  const cancelled = current(db, id);
  expect(cancelled.status).toBe('todo');
  expect(cancelled.cancelled_at).toBeTruthy();
  expect(cancelled.cancelled_by).toBe('parent');
  expect(cancelled.updated_at).not.toBe(before.updated_at);
  expect(db.prepare('SELECT count(*) AS count FROM earning').get()).toEqual({ count: 0 });
  const revision = db.prepare('SELECT actor_id, changes FROM chore_revision WHERE chore_id = ?').get(id) as { actor_id: string; changes: string };
  expect(revision.actor_id).toBe('parent');
  expect(JSON.parse(revision.changes)).toEqual({ cancelled: { from: null, to: cancelled.cancelled_at } });
  expect(() => changeChore(db, 'kid', 'home', id, 'submit')).toThrow();

  const audience = { householdId: 'home', role: 'parent' as const, actorId: 'parent', today: '2026-11-20' };
  expect(choreScopeCounts(db, audience)).toEqual({ review: 0, overdue: 0, today: 0, upcoming: 0, later: 0, rework: 0, verified: 0 });
  expect(listChoreScope(db, { ...audience, scope: 'today' }).total).toBe(0);
  expect(loadChoreWeek(db, audience, { start: '2026-11-15' }).total).toBe(0);

  let failure: unknown;
  try { cancelChore(db, 'parent', 'home', id, cancelled.updated_at); } catch (cause) { failure = cause; }
  expect((failure as ChoreChangeError).code).toBe('cancelled');
  expect(current(db, id)).toEqual(cancelled);
});

it('does not write a partial update when validation or the assignee fails inside the transaction', async () => {
  const db = await fixture();
  const id = createChore(db, 'parent', 'home', base);
  const before = current(db, id);
  expect(() => editChore(db, 'parent', 'home', id, before.updated_at, { ...base, title: 'Would be saved', assigneeId: 'missing-kid' })).toThrow();
  expect(current(db, id)).toEqual(before);
  expect(db.prepare('SELECT count(*) AS count FROM chore_revision').get()).toEqual({ count: 0 });
});
