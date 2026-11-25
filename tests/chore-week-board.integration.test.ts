import { afterEach, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../src/lib/server/identity';
import { generateOccurrences, createSeries } from '../src/lib/server/recurring';
import { loadChoreWeek } from '../src/lib/server/chore-week';

const opened: Database.Database[] = [];
afterEach(() => { for (const db of opened.splice(0)) db.close(); });

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

const insertChore = (db: Database.Database, input: { id: string; household?: string; assignee?: string; title?: string; status?: string; due: string; reward?: number | null; description?: string | null }) => {
  db.prepare('INSERT INTO chore (id, household_id, assignee_id, title, description, due_date, reward_cents, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(input.id, input.household ?? 'home', input.assignee ?? 'kid', input.title ?? input.id, input.description ?? null, input.due, input.reward ?? null, input.status ?? 'todo', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z');
};

const audience = { householdId: 'home', actorId: 'parent', role: 'parent' as const, today: '2026-11-18' };
const week = { start: '2026-11-15' };

it('is parent-only, validates filters, and reads exactly one household-local week', async () => {
  const db = await fixture();
  insertChore(db, { id: 'kid-sunday', due: '2026-11-15', reward: 200, description: 'Put books away' });
  insertChore(db, { id: 'sibling-monday', assignee: 'sibling', due: '2026-11-16', reward: null });
  insertChore(db, { id: 'kid-verified', due: '2026-11-17', reward: 300, status: 'verified' });
  insertChore(db, { id: 'outside-week', due: '2026-11-22' });
  insertChore(db, { id: 'other-household', household: 'other-home', assignee: 'other-kid', due: '2026-11-16' });

  expect(() => loadChoreWeek(db, { ...audience, role: 'kid', actorId: 'kid' }, week)).toThrow();
  expect(() => loadChoreWeek(db, { ...audience, actorId: 'other-parent' }, week)).toThrow();
  expect(loadChoreWeek(db, { ...audience, actorId: 'other-parent', householdId: 'other-home' }, week).total).toBe(1);
  expect(loadChoreWeek(db, { ...audience, actorId: 'other-parent', householdId: 'other-home' }, week).days[1].children[0].chores[0].id).toBe('other-household');
  expect(() => loadChoreWeek(db, audience, { start: 'not-a-date' })).toThrow();
  expect(() => loadChoreWeek(db, audience, { ...week, status: 'cancelled' as never })).toThrow();
  expect(() => loadChoreWeek(db, audience, { ...week, childId: 'other-kid' })).toThrow();
  expect(() => loadChoreWeek(db, audience, { ...week, childId: 'missing' })).toThrow();

  const board = loadChoreWeek(db, audience, week);
  expect(board.start).toBe('2026-11-15');
  expect(board.end).toBe('2026-11-21');
  expect(board.days).toHaveLength(7);
  expect(board.days.map(day => day.date)).toEqual(['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21']);
  expect(board.days[0].isToday).toBe(false);
  expect(board.days[3].isToday).toBe(true);
  expect(board.total).toBe(3);
  expect(board.counts).toEqual({ todo: 2, pending_verification: 0, needs_rework: 0, verified: 1 });
  expect(board.children).toEqual([{ id: 'kid', name: 'Kid', total: 2 }, { id: 'sibling', name: 'Sibling', total: 1 }]);
  expect(board.days[0].children).toEqual([{ id: 'kid', name: 'Kid', chores: [expect.objectContaining({ id: 'kid-sunday', title: 'kid-sunday', description: 'Put books away', dueDate: '2026-11-15', rewardCents: 200, status: 'todo', childName: 'Kid', seriesId: null, isRecurring: false })] }]);
  expect(board.days[1].children.map(child => child.id)).toEqual(['sibling']);
  expect(board.days[2].children[0].chores[0]).toMatchObject({ id: 'kid-verified', status: 'verified', rewardCents: 300 });
  expect(board.days[6].children).toEqual([]);
  expect(board.days.flatMap(day => day.children.flatMap(child => child.chores.map(chore => chore.id)))).not.toContain('other-household');
});

it('applies child and status filters without widening another household', async () => {
  const db = await fixture();
  insertChore(db, { id: 'kid-todo', due: '2026-11-15' });
  insertChore(db, { id: 'kid-pending', due: '2026-11-16', status: 'pending_verification', reward: 100 });
  insertChore(db, { id: 'sibling-todo', assignee: 'sibling', due: '2026-11-17' });

  const pending = loadChoreWeek(db, audience, { ...week, status: 'pending_verification' });
  expect(pending.total).toBe(1);
  expect(pending.days[1].children[0].chores.map(chore => chore.id)).toEqual(['kid-pending']);

  const sibling = loadChoreWeek(db, audience, { ...week, childId: 'sibling' });
  expect(sibling.total).toBe(1);
  expect(sibling.days[2].children[0].id).toBe('sibling');
  expect(sibling.children).toEqual([{ id: 'kid', name: 'Kid', total: 2 }, { id: 'sibling', name: 'Sibling', total: 1 }]);
});

it('shows recurring occurrences, hides skipped and paused future work, and never duplicates generation', async () => {
  const db = await fixture();
  const active = createSeries(db, 'parent', 'home', { title: 'Take out trash', assigneeId: 'kid', startDate: '2026-11-15', weekdays: [0, 2], rewardCents: 150 });
  generateOccurrences(db, 'parent', 'home', '2026-11-15', '2026-11-21');
  generateOccurrences(db, 'parent', 'home', '2026-11-15', '2026-11-21');

  db.prepare("INSERT INTO recurring_series (id, household_id, creator_id, assignee_id, title, start_date, weekdays, state, paused_on, created_at, updated_at) VALUES ('paused', 'home', 'parent', 'kid', 'Paused chore', '2026-01-01', '[0,1,2,3,4,5,6]', 'paused', '2026-11-01', '2026-11-01', '2026-11-01')").run();
  insertChore(db, { id: 'paused-future', due: '2026-11-19' });
  db.prepare("INSERT INTO recurring_occurrence (series_id, household_id, scheduled_date, chore_id) VALUES ('paused', 'home', '2026-11-19', 'paused-future')").run();
  insertChore(db, { id: 'skipped', due: '2026-11-18' });
  db.prepare("INSERT INTO recurring_occurrence (series_id, household_id, scheduled_date, chore_id) VALUES ('paused', 'home', '2026-11-18', 'skipped')").run();
  db.prepare("INSERT INTO recurring_skip (series_id, scheduled_date) VALUES ('paused', '2026-11-18')").run();

  const board = loadChoreWeek(db, audience, week);
  const occurrences = board.days[0].children[0].chores;
  expect(occurrences).toHaveLength(1);
  expect(occurrences[0]).toMatchObject({ title: 'Take out trash', seriesId: active, scheduledDate: '2026-11-15', isRecurring: true, rewardCents: 150 });
  const ids = board.days.flatMap(day => day.children.flatMap(child => child.chores.map(chore => chore.id)));
  expect(ids).toContain(occurrences[0].id);
  expect(ids).not.toContain('paused-future');
  expect(ids).not.toContain('skipped');
  expect(db.prepare('SELECT count(*) AS count FROM recurring_occurrence WHERE series_id = ?').get(active)).toEqual({ count: 2 });
});

it('bounds a busy week and reports truncation instead of reading unbounded history', async () => {
  const db = await fixture();
  const insert = db.prepare('INSERT INTO chore (id, household_id, assignee_id, title, due_date, reward_cents, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)');
  const many = db.transaction(() => {
    for (let index = 0; index < 501; index++) insert.run(`busy-${index}`, 'home', 'kid', `Busy ${index}`, '2026-11-15', 'todo', '2026-11-01', '2026-11-01');
  });
  many();
  const board = loadChoreWeek(db, audience, week);
  expect(board.truncated).toBe(true);
  expect(board.total).toBe(500);
});

it('applies child and status filters before the 500-row cap while reporting exact whole-week counts', async () => {
  const db = await fixture();
  const insert = db.prepare('INSERT INTO chore (id, household_id, assignee_id, title, due_date, reward_cents, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)');
  const many = db.transaction(() => {
    for (let index = 0; index < 505; index++) {
      insert.run(`busy-kid-${index}`, 'home', 'kid', `Busy ${index}`, '2026-11-15', 'todo', '2026-11-01', '2026-11-01');
    }
    insert.run('sibling-verified-1', 'home', 'sibling', 'Sibling verified 1', '2026-11-16', 'verified', '2026-11-01', '2026-11-01');
    insert.run('sibling-verified-2', 'home', 'sibling', 'Sibling verified 2', '2026-11-16', 'verified', '2026-11-01', '2026-11-01');
  });
  many();

  const unfiltered = loadChoreWeek(db, audience, week);
  expect(unfiltered.truncated).toBe(true);
  expect(unfiltered.total).toBe(500);
  expect(unfiltered.counts).toEqual({ todo: 505, pending_verification: 0, needs_rework: 0, verified: 2 });
  expect(unfiltered.children).toEqual([
    { id: 'kid', name: 'Kid', total: 505 },
    { id: 'sibling', name: 'Sibling', total: 2 }
  ]);

  const byChild = loadChoreWeek(db, audience, { ...week, childId: 'sibling' });
  expect(byChild.truncated).toBe(false);
  expect(byChild.total).toBe(2);
  expect(byChild.days[1].children[0].chores.map(chore => chore.id)).toEqual(['sibling-verified-1', 'sibling-verified-2']);
  expect(byChild.counts).toEqual({ todo: 505, pending_verification: 0, needs_rework: 0, verified: 2 });
  expect(byChild.children).toEqual([
    { id: 'kid', name: 'Kid', total: 505 },
    { id: 'sibling', name: 'Sibling', total: 2 }
  ]);

  const byStatus = loadChoreWeek(db, audience, { ...week, status: 'verified' });
  expect(byStatus.truncated).toBe(false);
  expect(byStatus.total).toBe(2);
  expect(byStatus.days[1].children[0].chores.map(chore => chore.id)).toEqual(['sibling-verified-1', 'sibling-verified-2']);
});
