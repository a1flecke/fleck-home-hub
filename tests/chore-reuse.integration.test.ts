import { afterEach, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../src/lib/server/identity';
import { createChore, changeChore } from '../src/lib/server/chores';
import { createReuseBatch, listRecentChores, previewReuseBatch, ReuseError } from '../src/lib/server/chore-reuse';

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

function sourceChore(db: Database.Database, title = 'Clean bedroom') {
  const id = createChore(db, 'parent', 'home', { title, description: 'Vacuum and dust', assigneeId: 'kid', dueDate: '2026-11-20', rewardCents: 300 });
  changeChore(db, 'kid', 'home', id, 'submit');
  changeChore(db, 'parent', 'home', id, 'verify');
  return id;
}

function source(db: Database.Database, id: string) {
  return db.prepare('SELECT updated_at AS updatedAt FROM chore WHERE id = ?').get(id) as { updatedAt: string };
}

function code(run: () => void) {
  try { run(); return 'none'; } catch (cause) { return cause instanceof ReuseError ? cause.code : cause instanceof Error ? cause.message : 'other'; }
}

it('bounded recent-chore search is parent-only and household-scoped', async () => {
  const db = await fixture();
  const insert = db.prepare('INSERT INTO chore (id, household_id, assignee_id, title, description, due_date, reward_cents, status, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)');
  const many = db.transaction(() => {
    for (let index = 0; index < 45; index++) insert.run(`recent-${String(index).padStart(2, '0')}`, 'home', 'kid', `Recent chore ${String(index).padStart(2, '0')}`, '2026-11-01', 100, 'todo', `2026-11-01T00:00:${String(index).padStart(2, '0')}.000Z`, `2026-11-01T00:00:${String(index).padStart(2, '0')}.000Z`);
    insert.run('other-recent', 'other-home', 'other-kid', 'Other household secret chore', '2026-11-01', 900, 'todo', '2026-11-01', '2026-11-01');
  });
  many();

  const page = listRecentChores(db, 'parent', 'home', { query: 'Recent chore 4', page: 1 });
  expect(page.total).toBe(5);
  expect(page.items.length).toBeLessThanOrEqual(20);
  expect(page.items.every(item => item.title.includes('Recent chore 4'))).toBe(true);
  expect(page.items.some(item => item.id === 'other-recent')).toBe(false);
  expect(() => listRecentChores(db, 'kid', 'home', { query: '' })).toThrow();
  expect(() => listRecentChores(db, 'other-parent', 'home', { query: '' })).toThrow();
  expect(() => listRecentChores(db, 'parent', 'home', { query: 'x'.repeat(81) })).toThrow();
  expect(() => listRecentChores(db, 'parent', 'home', { query: '', page: 0 })).toThrow();
});

it('previews copied fields for every selected child and validates the source', async () => {
  const db = await fixture();
  const id = sourceChore(db);
  const token = source(db, id).updatedAt;
  const base = { sourceId: id, sourceUpdatedAt: token, title: 'Clean bedroom again', description: 'Hallway too', dueDate: '2026-12-01', rewardCents: 250, assigneeIds: ['kid', 'sibling'] };
  const preview = previewReuseBatch(db, 'parent', 'home', base);
  expect(preview.rows).toEqual([
    { childId: 'kid', childName: 'Kid', title: 'Clean bedroom again', description: 'Hallway too', dueDate: '2026-12-01', rewardCents: 250 },
    { childId: 'sibling', childName: 'Sibling', title: 'Clean bedroom again', description: 'Hallway too', dueDate: '2026-12-01', rewardCents: 250 }
  ]);
  expect(code(() => previewReuseBatch(db, 'kid', 'home', base))).toBe('not-authorized');
  expect(code(() => previewReuseBatch(db, 'parent', 'home', { ...base, sourceId: 'missing' }))).toBe('invalid');
  expect(code(() => previewReuseBatch(db, 'parent', 'home', { ...base, sourceUpdatedAt: 'stale' }))).toBe('stale-source');
  expect(code(() => previewReuseBatch(db, 'parent', 'home', { ...base, assigneeIds: [] }))).toBe('invalid');
  expect(code(() => previewReuseBatch(db, 'parent', 'home', { ...base, assigneeIds: ['kid', 'other-kid'] }))).toBe('invalid');
  expect(code(() => previewReuseBatch(db, 'parent', 'home', { ...base, title: '   ' }))).toBe('invalid');
});

it('creates independent to-do chores once for a retried batch and copies no history or earnings', async () => {
  const db = await fixture();
  const id = sourceChore(db);
  const token = source(db, id).updatedAt;
  const sourceTransitions = db.prepare('SELECT count(*) AS count FROM chore_transition WHERE chore_id = ?').get(id);
  const before = db.prepare('SELECT count(*) AS count FROM chore').get();
  const input = { key: 'reuse-batch-key-0001', sourceId: id, sourceUpdatedAt: token, title: 'Clean bedroom again', description: 'Hallway too', dueDate: '2026-12-01', rewardCents: 250, assigneeIds: ['kid', 'sibling'] };

  const first = createReuseBatch(db, 'parent', 'home', input);
  expect(first.created).toBe(true);
  expect(first.choreIds).toHaveLength(2);
  expect(new Set(first.choreIds).size).toBe(2);
  const rows = db.prepare(`SELECT id, title, description, due_date AS dueDate, reward_cents AS rewardCents, status, cancelled_at AS cancelledAt, assignee_id AS assigneeId
    FROM chore WHERE id IN (?, ?) ORDER BY assignee_id`).all(...first.choreIds) as { id: string; title: string; description: string; dueDate: string; rewardCents: number; status: string; cancelledAt: string | null; assigneeId: string }[];
  expect(rows).toEqual([
    { id: expect.any(String), title: 'Clean bedroom again', description: 'Hallway too', dueDate: '2026-12-01', rewardCents: 250, status: 'todo', cancelledAt: null, assigneeId: 'kid' },
    { id: expect.any(String), title: 'Clean bedroom again', description: 'Hallway too', dueDate: '2026-12-01', rewardCents: 250, status: 'todo', cancelledAt: null, assigneeId: 'sibling' }
  ]);
  expect(db.prepare('SELECT count(*) AS count FROM earning').get()).toEqual({ count: 1 });
  expect(db.prepare('SELECT count(*) AS count FROM chore_transition WHERE chore_id = ?').get(id)).toEqual(sourceTransitions);
  for (const chore of first.choreIds) expect(db.prepare('SELECT from_status AS fromStatus, to_status AS toStatus FROM chore_transition WHERE chore_id = ?').all(chore)).toEqual([{ fromStatus: null, toStatus: 'todo' }]);
  expect(db.prepare('SELECT count(*) AS count FROM chore').get()).toEqual({ count: (before as { count: number }).count + 2 });

  const batch = db.prepare('SELECT actor_id AS actorId, source_chore_id AS sourceId, assignee_ids AS assigneeIds, chore_ids AS choreIds FROM chore_reuse_batch WHERE id = ?').get(input.key) as { actorId: string; sourceId: string; assigneeIds: string; choreIds: string };
  expect(batch).toMatchObject({ actorId: 'parent', sourceId: id });
  expect(JSON.parse(batch.assigneeIds)).toEqual(['kid', 'sibling']);
  expect(JSON.parse(batch.choreIds)).toEqual(first.choreIds);

  const retry = createReuseBatch(db, 'parent', 'home', { ...input, title: 'Changed retry title' });
  expect(retry).toEqual({ created: false, choreIds: first.choreIds });
  expect(db.prepare('SELECT count(*) AS count FROM chore').get()).toEqual({ count: (before as { count: number }).count + 2 });
  expect(db.prepare('SELECT count(*) AS count FROM chore_reuse_batch').get()).toEqual({ count: 1 });
});

it('rolls back the whole batch when an assignee loses access or the source changes', async () => {
  const db = await fixture();
  const id = sourceChore(db);
  const token = source(db, id).updatedAt;
  const before = db.prepare('SELECT count(*) AS count FROM chore').get();
  const input = { key: 'reuse-batch-key-0002', sourceId: id, sourceUpdatedAt: token, title: 'Clean bedroom again', description: 'Hallway too', dueDate: '2026-12-01', rewardCents: 250, assigneeIds: ['kid', 'sibling'] };
  previewReuseBatch(db, 'parent', 'home', input);
  db.prepare("UPDATE membership SET disabled_at = 1, disabled_by = 'parent' WHERE user_id = 'sibling'").run();
  expect(code(() => createReuseBatch(db, 'parent', 'home', input))).toBe('invalid');
  expect(db.prepare('SELECT count(*) AS count FROM chore').get()).toEqual(before);
  expect(db.prepare('SELECT count(*) AS count FROM chore_reuse_batch').get()).toEqual({ count: 0 });

  db.prepare("UPDATE membership SET disabled_at = NULL, disabled_by = NULL WHERE user_id = 'sibling'").run();
  expect(code(() => createReuseBatch(db, 'parent', 'home', { ...input, sourceUpdatedAt: 'old-token' }))).toBe('stale-source');
  expect(db.prepare('SELECT count(*) AS count FROM chore').get()).toEqual(before);
  expect(db.prepare('SELECT count(*) AS count FROM chore_reuse_batch').get()).toEqual({ count: 0 });
});

it('rejects an invalid idempotency key before creating anything', async () => {
  const db = await fixture();
  const id = sourceChore(db);
  const before = db.prepare('SELECT count(*) AS count FROM chore').get();
  expect(code(() => createReuseBatch(db, 'parent', 'home', { key: 'short', sourceId: id, sourceUpdatedAt: source(db, id).updatedAt, title: 'Reuse', description: '', dueDate: '2026-12-01', rewardCents: null, assigneeIds: ['kid'] }))).toBe('invalid-key');
  expect(db.prepare('SELECT count(*) AS count FROM chore').get()).toEqual(before);
});
