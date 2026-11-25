import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate as migrateDrizzle } from 'drizzle-orm/better-sqlite3/migrator';
import { expect, it, vi } from 'vitest';
import { localDate } from '../src/lib/chores/recurrence';
import { backupDatabase } from '../src/lib/server/backup';
import { migrate } from '../src/lib/server/identity';
import { createSeries } from '../src/lib/server/recurring';
import { listRecoveryGaps, resolveRecoveryGap } from '../src/lib/server/recovery';
import { runDatabaseWorkers } from './helpers/database-workers';

function seed(db: Database.Database, startDate: string) {
  db.exec("INSERT INTO household VALUES ('home', 'Synthetic')");
  for (const [id, role] of [['parent', 'parent'], ['other-parent', 'parent'], ['kid', 'kid']]) {
    db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, id + '@example.test');
    db.prepare("INSERT INTO membership (user_id, household_id, role) VALUES (?, 'home', ?)").run(id, role);
  }
  return createSeries(db, 'parent', 'home', {
    title: 'Synthetic recovery', assigneeId: 'kid', startDate,
    weekdays: [0, 1, 2, 3, 4, 5, 6], rewardCents: 200
  });
}

function counts(db: Database.Database) {
  return db.prepare(`SELECT
    (SELECT count(*) FROM recurring_occurrence) AS occurrences,
    (SELECT count(*) FROM recurring_skip) AS skips,
    (SELECT count(*) FROM chore) AS chores,
    (SELECT count(*) FROM earning) AS earnings,
    (SELECT count(*) FROM recurring_recovery_decision) AS decisions`).get();
}

it('upgrades the previous journal prefix and restores both recovery decisions from a WAL backup', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-recovery-upgrade-'));
  const source = join(dir, 'source.sqlite');
  const snapshot = join(dir, 'backup.sqlite');
  const restoredPath = join(dir, 'restored.sqlite');
  const db = new Database(source);
  try {
    db.pragma('foreign_keys = ON');
    db.exec(readFileSync('drizzle/auth/0001_better_auth.sql', 'utf8'));
    const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as { entries: { tag: string }[] };
    const prefix = (entries: { tag: string }[]) => entries.slice(0, entries.findIndex(entry => entry.tag === '0014_expense_payments') + 1);
    const entries = prefix(journal.entries);
    expect(entries.at(-1)?.tag).toBe('0014_expense_payments');
    expect(prefix([...journal.entries, { tag: 'future_migration' }])).toEqual(entries);
    mkdirSync(join(dir, 'meta'));
    for (const { tag } of entries) copyFileSync('drizzle/' + tag + '.sql', join(dir, tag + '.sql'));
    writeFileSync(join(dir, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
    migrateDrizzle(drizzle(db), { migrationsFolder: dir });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name IN ('recurring_pause_interval', 'recurring_recovery_decision')").all()).toEqual([]);
    db.exec("INSERT INTO household VALUES ('home', 'Synthetic')");
    for (const [id, role] of [['parent', 'parent'], ['other-parent', 'parent'], ['kid', 'kid']]) {
      db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, id + '@example.test');
      db.prepare("INSERT INTO membership (user_id, household_id, role) VALUES (?, 'home', ?)").run(id, role);
    }
    const seriesId = 'pre-upgrade-recovery-series';
    db.prepare(`INSERT INTO recurring_series (id, household_id, creator_id, assignee_id, title, reward_cents, start_date, weekdays, state, created_at, updated_at)
      VALUES (?, 'home', 'parent', 'kid', 'Synthetic recovery', 200, '2026-03-01', '[0,1,2,3,4,5,6]', 'active', '2026-03-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z')`).run(seriesId);
    const series = db.prepare('SELECT * FROM recurring_series').get();

    await migrate(db);
    expect(db.prepare('SELECT * FROM recurring_series').get()).toEqual(series);
    expect(db.prepare('SELECT * FROM recurring_pause_interval').all()).toEqual([]);
    db.pragma('journal_mode = WAL');
    db.pragma('wal_autocheckpoint = 0');
    // Preserve native timers for the asynchronous backup.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-04T18:00:00Z'));
    const [skip, create, unresolved] = listRecoveryGaps(db, 'parent', 'home');
    expect([skip.date, create.date, unresolved.date]).toEqual(['2026-03-01', '2026-03-02', '2026-03-03']);
    expect(skip.uncertain).toBe(true);
    resolveRecoveryGap(db, 'parent', 'home', { seriesId, date: skip.date, reviewed: skip.reviewed, decision: 'skip' });
    resolveRecoveryGap(db, 'other-parent', 'home', { seriesId, date: create.date, reviewed: create.reviewed, decision: 'create', assigneeId: 'kid', rewardCents: 175 });
    await backupDatabase(source, snapshot);
    copyFileSync(snapshot, restoredPath);
    const restored = new Database(restoredPath, { fileMustExist: true });
    try {
      expect(restored.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(restored.pragma('foreign_key_check')).toEqual([]);
      expect(restored.prepare('SELECT * FROM recurring_recovery_decision ORDER BY scheduled_date').all())
        .toEqual(db.prepare('SELECT * FROM recurring_recovery_decision ORDER BY scheduled_date').all());
      expect(restored.prepare('SELECT c.status, c.reward_cents, d.actor_id FROM recurring_recovery_decision d JOIN chore c ON c.id = d.chore_id').get())
        .toEqual({ status: 'todo', reward_cents: 175, actor_id: 'other-parent' });
      expect(counts(restored)).toEqual({ occurrences: 1, skips: 1, chores: 1, earnings: 0, decisions: 2 });
      expect(listRecoveryGaps(restored, 'parent', 'home').map(gap => gap.date)).toEqual([unresolved.date]);
    } finally { restored.close(); }
  } finally { vi.useRealTimers(); db.close(); rmSync(dir, { recursive: true, force: true }); }
});

it('commits exactly one of two competing parent decisions on the same date', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-two-parent-recovery-'));
  const path = join(dir, 'source.sqlite');
  const db = new Database(path);
  try {
    db.pragma('foreign_keys = ON');
    await migrate(db);
    const today = localDate(new Date(), 'America/Chicago');
    const date = new Date(Date.parse(today + 'T00:00:00Z') - 86_400_000).toISOString().slice(0, 10);
    const id = seed(db, date);
    const [create, skip] = await runDatabaseWorkers('tests/fixtures/recovery-worker.ts', [
      [path, id, date, 'recover', 'parent'], [path, id, date, 'skip', 'other-parent']
    ]);
    const created = create === 'created';
    expect([create, skip]).toEqual(created ? ['created', 'conflict'] : ['conflict', 'skipped']);
    expect(db.prepare('SELECT actor_id, decision FROM recurring_recovery_decision').get())
      .toEqual(created ? { actor_id: 'parent', decision: 'create' } : { actor_id: 'other-parent', decision: 'skip' });
    expect(counts(db)).toEqual({ occurrences: Number(created), skips: Number(!created), chores: Number(created), earnings: 0, decisions: 1 });
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

it.each(['other-parent', 'kid'])('rejects a recovery decision when revocation of %s wins at the writer lock', async target => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-recovery-revocation-'));
  const path = join(dir, 'source.sqlite');
  const revoker = new Database(path);
  let attempts = 0;
  const resolving = new Database(path, { verbose(sql) {
    if (sql !== 'BEGIN IMMEDIATE') return;
    // better-sqlite3 calls verbose immediately before execution. Commit the
    // competing writer after any pre-lock checks and before this lock is acquired.
    attempts++;
    revoker.prepare("UPDATE membership SET disabled_at = 1, disabled_by = 'parent' WHERE household_id = 'home' AND user_id = ?").run(target);
  } });
  try {
    await migrate(revoker);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-04T18:00:00Z'));
    const seriesId = seed(revoker, '2026-03-03');
    const gap = listRecoveryGaps(resolving, 'other-parent', 'home')[0];
    expect(gap.date).toBe('2026-03-03');
    expect(() => resolveRecoveryGap(resolving, 'other-parent', 'home', {
      seriesId, date: gap.date, reviewed: gap.reviewed, decision: 'create', assigneeId: 'kid', rewardCents: 200
    })).toThrow(target === 'kid' ? 'Recovery date changed' : 'Not authorized');
    expect(attempts).toBe(1);
    expect(revoker.prepare("SELECT disabled_at FROM membership WHERE household_id = 'home' AND user_id = ?").get(target)).toEqual({ disabled_at: 1 });
    expect(counts(revoker)).toEqual({ occurrences: 0, skips: 0, chores: 0, earnings: 0, decisions: 0 });
  } finally { vi.useRealTimers(); resolving.close(); revoker.close(); rmSync(dir, { recursive: true, force: true }); }
});
