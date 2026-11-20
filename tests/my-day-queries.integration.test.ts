import { afterEach, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../src/lib/server/identity';
import {
  DASHBOARD_SECTION_LIMIT,
  choreScopeCounts,
  dashboardChoreSections,
  listChoreScope,
  childEarningSummaries,
  listPayoutHistory,
  type ChoreScope
} from '../src/lib/server/my-day';

const opened: Database.Database[] = [];
afterEach(() => { for (const db of opened.splice(0)) db.close(); });

async function fixture() {
  const db = new Database(':memory:');
  opened.push(db);
  db.pragma('foreign_keys = ON');
  await migrate(db);
  for (const [id, name] of [['parent', 'Parent'], ['kid', 'Kid'], ['sibling', 'Sibling'], ['other-parent', 'Other Parent'], ['other-kid', 'Other Kid']]) {
    db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, name, `${id}@example.test`);
  }
  db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'Synthetic');
  db.prepare('INSERT INTO household VALUES (?, ?)').run('other-home', 'Other Synthetic');
  for (const [user, household, role] of [['parent', 'home', 'parent'], ['kid', 'home', 'kid'], ['sibling', 'home', 'kid'], ['other-parent', 'other-home', 'parent'], ['other-kid', 'other-home', 'kid']] as const) {
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(user, household, role);
  }
  return db;
}

const insertChore = (db: Database.Database, input: { id: string; household?: string; assignee?: string; status: string; due: string; reward?: number | null; updated?: string }) => {
  db.prepare('INSERT INTO chore (id, household_id, assignee_id, title, due_date, reward_cents, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(input.id, input.household ?? 'home', input.assignee ?? 'kid', input.id, input.due, input.reward ?? null, input.status, input.updated ?? '2026-01-01T00:00:00.000Z', input.updated ?? '2026-01-01T00:00:00.000Z');
};

const earn = (db: Database.Database, id: string, chore: string, cents: number, household = 'home', child = 'kid') => {
  db.prepare('INSERT INTO earning (id, chore_id, household_id, child_id, amount_cents, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, chore, household, child, cents, '2026-01-01T00:00:00.000Z');
};

function seedMany(db: Database.Database) {
  const many = db.transaction(() => {
    for (let index = 0; index < 2500; index++) {
      const id = `verified-${String(index).padStart(4, '0')}`;
      insertChore(db, { id, status: 'verified', due: '2025-01-01', reward: 100, updated: new Date(Date.UTC(2025, 0, 1, 0, 0, index)).toISOString() });
      earn(db, `earning-${id}`, id, 100);
    }
    for (let index = 0; index < 400; index++) insertChore(db, { id: `overdue-${index}`, status: 'todo', due: `2024-${String((index % 12) + 1).padStart(2, '0')}-${String((index % 28) + 1).padStart(2, '0')}` });
    for (let index = 0; index < 80; index++) insertChore(db, { id: `pending-${index}`, status: 'pending_verification', due: '2026-10-01', reward: 250, updated: new Date(Date.UTC(2026, 9, 1, 0, 0, index)).toISOString() });
    for (let index = 0; index < 25; index++) insertChore(db, { id: `rework-${index}`, status: 'needs_rework', due: '2026-09-01', reward: 150 });
    for (let index = 0; index < 20; index++) insertChore(db, { id: `today-${index}`, status: 'todo', due: '2026-11-16' });
    for (let index = 0; index < 30; index++) insertChore(db, { id: `upcoming-${index}`, status: 'todo', due: `2026-11-${String(17 + (index % 7)).padStart(2, '0')}` });
    for (let index = 0; index < 5; index++) insertChore(db, { id: `later-${index}`, status: 'todo', due: `2099-01-0${index + 1}` });
    for (let index = 0; index < 40; index++) insertChore(db, { id: `sibling-${index}`, assignee: 'sibling', status: 'pending_verification', due: '2026-10-01', reward: 100 });
    for (let index = 0; index < 50; index++) insertChore(db, { id: `other-${index}`, household: 'other-home', assignee: 'other-kid', status: 'pending_verification', due: '2026-10-01', reward: 900 });
  });
  many();
}

const audience = { householdId: 'home', role: 'parent' as const, actorId: 'parent', today: '2026-11-16' };

it('counts every record while returning bounded dashboard sections', async () => {
  const db = await fixture();
  seedMany(db);
  const counts = choreScopeCounts(db, audience);
  expect(counts).toEqual({ review: 120, overdue: 400, rework: 25, today: 20, upcoming: 30, later: 5, verified: 2500 });
  expect(counts.review).toBeGreaterThan(DASHBOARD_SECTION_LIMIT);

  const dashboard = dashboardChoreSections(db, audience);
  expect(dashboard.counts).toEqual(counts);
  for (const scope of Object.keys(dashboard.sections) as ChoreScope[]) {
    expect(dashboard.sections[scope].items.length).toBeLessThanOrEqual(DASHBOARD_SECTION_LIMIT);
    expect(dashboard.sections[scope].total).toBe(counts[scope]);
  }
  expect(dashboard.sections.review.items).toHaveLength(DASHBOARD_SECTION_LIMIT);
  expect(dashboard.sections.later.items.map(item => item.id)).toContain('later-0');

  const summaries = childEarningSummaries(db, audience);
  const kid = summaries.find(item => item.id === 'kid')!;
  expect(kid.pendingCount).toBe(80);
  expect(kid.pendingCents).toBe(80 * 250);
  expect(kid.earned).toBe(250_000);
  expect(summaries.find(item => item.id === 'sibling')!.pendingCents).toBe(4000);
  expect(summaries.some(item => item.id === 'other-kid')).toBe(false);
});

it('paginates history deterministically without overlaps', async () => {
  const db = await fixture();
  for (let index = 0; index < 120; index++) {
    insertChore(db, { id: `history-${String(index).padStart(3, '0')}`, status: 'verified', due: '2025-01-01', reward: 100, updated: new Date(Date.UTC(2025, 0, 1, 0, 0, index)).toISOString() });
  }
  const first = listChoreScope(db, { ...audience, scope: 'verified', page: 1 });
  const second = listChoreScope(db, { ...audience, scope: 'verified', page: 2 });
  const last = listChoreScope(db, { ...audience, scope: 'verified', page: 99 });
  expect(first.total).toBe(120);
  expect(first.pageCount).toBe(5);
  expect(first.items[0].id).toBe('history-119');
  expect(first.items).toHaveLength(25);
  expect(second.items[0].id).toBe('history-094');
  expect(second.items.some(item => first.items.some(previous => previous.id === item.id))).toBe(false);
  expect(last.page).toBe(5);
  expect(last.items).toHaveLength(20);
  expect(last.items.at(-1)!.id).toBe('history-000');
});

it('never widens a child scope through filters and rejects cross-household payouts', async () => {
  const db = await fixture();
  insertChore(db, { id: 'kid-chore', status: 'todo', due: '2026-11-16' });
  insertChore(db, { id: 'sibling-chore', assignee: 'sibling', status: 'pending_verification', due: '2026-11-16', reward: 300 });

  const kid = { ...audience, role: 'kid' as const, actorId: 'kid', scope: 'verified' as const };
  const own = listChoreScope(db, { ...kid, scope: 'today' });
  expect(own.items.map(item => item.id)).toEqual(['kid-chore']);
  const filtered = listChoreScope(db, { ...kid, scope: 'review', childId: 'sibling' });
  expect(filtered.items).toEqual([]);

  const parentFiltered = listChoreScope(db, { ...audience, scope: 'review', childId: 'sibling' });
  expect(parentFiltered.items.map(item => item.id)).toEqual(['sibling-chore']);

  expect(() => listPayoutHistory(db, { ...audience, role: 'kid', actorId: 'kid', childId: 'sibling', page: 1 })).toThrow();
  expect(() => listPayoutHistory(db, { ...audience, householdId: 'other-home', childId: 'kid', page: 1 })).toThrow();
});

it('keeps overdue and pending work visible through skips and pauses', async () => {
  const db = await fixture();
  db.prepare("INSERT INTO recurring_series (id, household_id, creator_id, assignee_id, title, start_date, weekdays, state, paused_on, created_at, updated_at) VALUES ('series', 'home', 'parent', 'kid', 'Synthetic', '2026-01-01', '[1]', 'paused', '2026-11-01', '2026-01-01', '2026-01-01')").run();
  insertChore(db, { id: 'old-pending', status: 'pending_verification', due: '2025-01-01', reward: 100 });
  insertChore(db, { id: 'old-todo', status: 'todo', due: '2025-01-02' });
  insertChore(db, { id: 'future-todo', status: 'todo', due: '2026-12-01' });
  insertChore(db, { id: 'skipped', status: 'todo', due: '2025-01-03' });
  db.prepare("INSERT INTO recurring_occurrence (series_id, household_id, scheduled_date, chore_id) VALUES ('series', 'home', '2026-12-01', 'future-todo')").run();
  db.prepare("INSERT INTO recurring_occurrence (series_id, household_id, scheduled_date, chore_id) VALUES ('series', 'home', '2025-01-03', 'skipped')").run();
  db.prepare("INSERT INTO recurring_skip (series_id, scheduled_date) VALUES ('series', '2025-01-03')").run();
  const counts = choreScopeCounts(db, audience);
  expect(counts.review).toBe(1);
  expect(counts.overdue).toBe(1);
  expect(counts.upcoming).toBe(0);
  const overdue = listChoreScope(db, { ...audience, scope: 'overdue' });
  expect(overdue.items.map(item => item.id)).toEqual(['old-todo']);
});

it('paginates payout history with reversals while keeping balances complete', async () => {
  const db = await fixture();
  insertChore(db, { id: 'paid-chore', status: 'verified', due: '2025-01-01', reward: 5000 });
  earn(db, 'paid-earning', 'paid-chore', 5000);
  const addPayout = db.prepare('INSERT INTO payout (id, household_id, child_id, actor_id, amount_cents, paid_date, note, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (let index = 0; index < 45; index++) {
    addPayout.run(`payout-${String(index).padStart(2, '0')}`, 'home', 'kid', 'parent', 100, `2026-01-${String((index % 28) + 1).padStart(2, '0')}`, null, `request-${index}`, new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString());
  }
  db.prepare("INSERT INTO payout_reversal (id, payout_id, actor_id, reason, created_at) VALUES ('reversal', 'payout-00', 'parent', 'Synthetic correction', '2026-02-01T00:00:00.000Z')").run();

  const first = listPayoutHistory(db, { ...audience, childId: 'kid', page: 1 });
  const third = listPayoutHistory(db, { ...audience, childId: 'kid', page: 3 });
  expect(first.total).toBe(45);
  expect(first.items).toHaveLength(20);
  expect(third.items).toHaveLength(5);
  expect(first.balance).toEqual({ earned: 5000, paid: 4400, owed: 600 });
  expect(third.items.find(item => item.id === 'payout-00')?.reversalReason).toBe('Synthetic correction');
});
