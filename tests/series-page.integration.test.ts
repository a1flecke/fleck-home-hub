import { afterEach, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../src/lib/server/identity';
import { listSeriesPage } from '../src/lib/server/recurring';
import { localDate } from '../src/lib/chores/recurrence';

const opened: Database.Database[] = [];
afterEach(() => { vi.useRealTimers(); for (const db of opened.splice(0)) db.close(); });

async function fixture() {
  const db = new Database(':memory:');
  opened.push(db);
  db.pragma('foreign_keys = ON');
  await migrate(db);
  for (const [id, name] of [['parent', 'Parent'], ['kid', 'Kid']]) db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, name, `${id}@example.test`);
  db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'Synthetic');
  db.prepare("INSERT INTO membership (user_id, household_id, role) VALUES ('parent', 'home', 'parent')").run();
  db.prepare("INSERT INTO membership (user_id, household_id, role) VALUES ('kid', 'home', 'kid')").run();
  return db;
}

it('paginates recurring schedules and bounds next occurrences and skips', async () => {
  const db = await fixture();
  // The next occurrence depends on the household-local date; pin the clock before deriving any date.
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-16T18:00:00Z'));
  const insert = db.prepare(`INSERT INTO recurring_series (id, household_id, creator_id, assignee_id, title, start_date, weekdays, state, created_at, updated_at)
    VALUES (?, 'home', 'parent', 'kid', ?, '2026-01-01', '[0,1,2,3,4,5,6]', 'active', ?, ?)`);
  for (let index = 0; index < 23; index++) {
    const stamp = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
    insert.run(`series-${String(index).padStart(2, '0')}`, `Series ${index}`, stamp, stamp);
  }
  const today = localDate(new Date(), 'America/Chicago');
  const next = new Date(`${today}T00:00:00.000Z`); next.setUTCDate(next.getUTCDate() + 1);
  const nextDate = next.toISOString().slice(0, 10);
  db.prepare("INSERT INTO chore (id, household_id, assignee_id, title, due_date, reward_cents, status, created_at, updated_at) VALUES ('next-chore', 'home', 'kid', 'Series 22', ?, 100, 'todo', ?, ?)").run(nextDate, today, today);
  db.prepare("INSERT INTO recurring_occurrence (series_id, household_id, scheduled_date, chore_id) VALUES ('series-22', 'home', ?, 'next-chore')").run(nextDate);
  const skip = db.prepare("INSERT INTO recurring_skip (series_id, scheduled_date) VALUES ('series-22', ?)");
  for (let day = 1; day <= 8; day++) skip.run(`2026-10-${String(day).padStart(2, '0')}`);

  const first = listSeriesPage(db, 'parent', 'home', 1, 10);
  const last = listSeriesPage(db, 'parent', 'home', 3, 10);
  expect(first.total).toBe(23);
  expect(first.pageCount).toBe(3);
  expect(first.items).toHaveLength(10);
  expect(first.items[0].id).toBe('series-22');
  expect(first.items[0].next).toBe(nextDate);
  expect(first.items[0].skips).toEqual(['2026-10-08', '2026-10-07', '2026-10-06', '2026-10-05', '2026-10-04']);
  expect(first.items[0].skipCount).toBe(8);
  expect(last.items).toHaveLength(3);
  expect(last.items.at(-1)!.id).toBe('series-00');
  expect(() => listSeriesPage(db, 'kid', 'home', 1, 10)).toThrow();
  // Once its date has passed, the occurrence is no longer the next one.
  vi.setSystemTime(new Date(`${nextDate}T18:00:00Z`).getTime() + 86_400_000);
  expect(listSeriesPage(db, 'parent', 'home', 1, 10).items[0].next).toBeUndefined();
});

it('batches next-occurrence and skip queries across a page of recurring series', async () => {
  const db = await fixture();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-16T18:00:00Z'));
  const insert = db.prepare(`INSERT INTO recurring_series (id, household_id, creator_id, assignee_id, title, start_date, weekdays, state, created_at, updated_at)
    VALUES (?, 'home', 'parent', 'kid', ?, '2026-01-01', '[0,1,2,3,4,5,6]', 'active', ?, ?)`);
  for (let i = 0; i < 15; i += 1) {
    const id = `series-${String(i).padStart(2, '0')}`;
    const stamp = new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString();
    insert.run(id, `Series ${i}`, stamp, stamp);
    db.prepare("INSERT INTO chore (id, household_id, assignee_id, title, due_date, reward_cents, status, created_at, updated_at) VALUES (?, 'home', 'kid', ?, '2026-11-18', 100, 'todo', '2026-11-16', '2026-11-16')").run(`chore-${i}`, `Series ${i}`);
    db.prepare("INSERT INTO recurring_occurrence (series_id, household_id, scheduled_date, chore_id) VALUES (?, 'home', '2026-11-18', ?)").run(id, `chore-${i}`);
    db.prepare("INSERT INTO recurring_skip (series_id, scheduled_date) VALUES (?, '2026-10-01')").run(id);
  }

  const originalPrepare = db.prepare.bind(db);
  const statements: string[] = [];
  db.prepare = ((sql: string) => {
    statements.push(sql);
    return originalPrepare(sql);
  }) as typeof db.prepare;

  const page = listSeriesPage(db, 'parent', 'home', 1, 15);
  expect(page.items).toHaveLength(15);
  expect(page.items.every(item => item.next === '2026-11-18' && item.skipCount === 1)).toBe(true);
  expect(statements.length).toBeLessThanOrEqual(10);
});
