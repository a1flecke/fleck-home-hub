import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../src/lib/server/identity';

const expected = [
  'chore_household_status_due',
  'chore_household_assignee_status_due',
  'chore_household_status_updated',
  'earning_household_child',
  'payout_household_child_date',
  'chore_transition_pending',
  'recurring_series_household_created'
];

it('adds repeatable read-path indexes without changing existing rows', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    await migrate(db);
    for (const [id, name] of [['parent', 'Parent'], ['kid', 'Kid']]) {
      db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, name, `${id}@example.test`);
    }
    db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'Synthetic');
    db.prepare("INSERT INTO membership (user_id, household_id, role) VALUES ('parent', 'home', 'parent')").run();
    db.prepare("INSERT INTO membership (user_id, household_id, role) VALUES ('kid', 'home', 'kid')").run();
    db.prepare("INSERT INTO chore (id, household_id, assignee_id, title, due_date, reward_cents, status, created_at, updated_at) VALUES ('chore', 'home', 'kid', 'Synthetic', '2026-11-16', 200, 'todo', '2026-11-16', '2026-11-16')").run();
    await migrate(db);
    await migrate(db);
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name IN (${expected.map(() => '?').join(', ')}) ORDER BY name`).all(...expected)).toEqual([...expected].sort().map(name => ({ name })));
    expect(db.prepare('SELECT title, status FROM chore').get()).toEqual({ title: 'Synthetic', status: 'todo' });
  } finally { db.close(); }
});
