import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const expectedIndexes = [
  'meal_household_date',
  'expense_pause_expense_dates',
  'expense_payment_household_date',
  'membership_household_active',
  'calendar_inbox_household_state',
  'household_invitation_household',
  'managed_child_household',
  'chore_household_updated',
  'chore_household_assignee_due'
];

it('adds missing hot-path indexes without altering existing household data', () => {
  const baseline = mkdtempSync(join(tmpdir(), 'performance-indexes-upgrade-'));
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    db.exec(readFileSync('drizzle/auth/0001_better_auth.sql', 'utf8'));
    const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as { entries: { tag: string; idx: number; when: number }[] };
    const boundary = '0028_checklist_item_assignments';
    const prefix = (entries: typeof journal.entries) => entries.slice(0, entries.findIndex(entry => entry.tag === boundary) + 1);
    const previous = prefix(journal.entries);
    expect(previous.at(-1)?.tag).toBe(boundary);
    expect(prefix([...journal.entries, { tag: 'future', idx: 999, when: Number.MAX_SAFE_INTEGER }])).toEqual(previous);

    mkdirSync(join(baseline, 'meta'));
    for (const { tag } of previous) copyFileSync(`drizzle/${tag}.sql`, join(baseline, `${tag}.sql`));
    writeFileSync(join(baseline, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: previous }));
    migrate(drizzle(db), { migrationsFolder: baseline });

    const existingIndexNames = () => new Set(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").pluck().all() as string[]
    );
    for (const name of expectedIndexes) expect(existingIndexNames().has(name)).toBe(false);

    db.exec(`
      INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES
        ('parent', 'Parent', 'parent@example.test', 0, 0, 0),
        ('kid', 'Kid', 'kid@children.fleck.invalid', 0, 0, 0);
      INSERT INTO household VALUES ('home', 'Synthetic home');
      INSERT INTO membership (user_id, household_id, role) VALUES ('parent', 'home', 'parent'), ('kid', 'home', 'kid');
      INSERT INTO managed_child (user_id, household_id, username, version, created_by) VALUES ('kid', 'home', 'kiddo', 0, 'parent');
      INSERT INTO meal (id, household_id, title, meal_date, ingredients, shared, created_at, updated_at)
        VALUES ('meal-1', 'home', 'Tacos', '2026-11-23', 'tortillas', 1, 'before', 'before');
      INSERT INTO expense (id, household_id, creator_id, due_date, cadence, state, created_at, updated_at)
        VALUES ('exp-1', 'home', 'parent', '2026-11-01', 'monthly', 'active', 'before', 'before');
      INSERT INTO expense_version (expense_id, effective_date, title, amount_cents, actor_id, created_at)
        VALUES ('exp-1', '2026-11-01', 'Internet', 7500, 'parent', 'before');
      INSERT INTO expense_pause (expense_id, start_date, end_date, actor_id, created_at)
        VALUES ('exp-1', '2026-12-01', NULL, 'parent', 'before');
      INSERT INTO expense_payment (id, household_id, expense_id, scheduled_date, paid_date, amount_cents, planned_title, planned_amount_cents, actor_id, request_id, created_at)
        VALUES ('pay-1', 'home', 'exp-1', '2026-11-01', '2026-11-01', 7500, 'Internet', 7500, 'parent', 'req-1', 'before');
      INSERT INTO calendar_inbox (id, household_id, creator_id, title, state, created_at, updated_at)
        VALUES ('inbox-1', 'home', 'parent', 'Dentist', 'open', 'before', 'before');
      INSERT INTO household_invitation (id, token_hash, household_id, role, created_by, expires_at)
        VALUES ('inv-1', 'hash-1', 'home', 'kid', 'parent', 9999999999999);
      INSERT INTO chore (id, household_id, assignee_id, title, due_date, status, created_at, updated_at)
        VALUES ('chore-1', 'home', 'kid', 'Dishes', '2026-11-23', 'todo', 'before', 'later');
    `);

    const snapshot = () => [
      db.prepare('SELECT * FROM meal').all(),
      db.prepare('SELECT * FROM expense_pause').all(),
      db.prepare('SELECT * FROM expense_payment').all(),
      db.prepare('SELECT * FROM membership').all(),
      db.prepare('SELECT * FROM calendar_inbox').all(),
      db.prepare('SELECT * FROM household_invitation').all(),
      db.prepare('SELECT * FROM managed_child').all(),
      db.prepare('SELECT * FROM chore').all()
    ];
    const before = snapshot();

    migrate(drizzle(db), { migrationsFolder: 'drizzle' });
    migrate(drizzle(db), { migrationsFolder: 'drizzle' });

    const afterIndexes = existingIndexNames();
    for (const name of expectedIndexes) expect(afterIndexes.has(name)).toBe(true);
    expect(snapshot()).toEqual(before);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
  } finally {
    db.close();
    rmSync(baseline, { recursive: true, force: true });
  }
});
