import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localDate } from '../src/lib/chores/recurrence';
import { runDatabaseWorkers } from './helpers/database-workers';
import { expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../src/lib/server/identity';
import { createSeries, setSeriesState } from '../src/lib/server/recurring';
import { listRecoveryGaps, resolveRecoveryGap } from '../src/lib/server/recovery';
import { changeChore } from '../src/lib/server/chores';

it('requires an explicit parent decision and credits only verified work', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    await migrate(db);
    for (const id of ['parent', 'kid']) db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, `${id}@example.test`);
    db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'Synthetic');
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('parent', 'home', 'parent');
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('kid', 'home', 'kid');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-04T18:00:00Z'));
    const id = createSeries(db, 'parent', 'home', { title: 'Synthetic chore', assigneeId: 'kid', startDate: '2026-03-01', weekdays: [0, 1, 2, 3, 4, 5, 6], rewardCents: 200 });
    const reviewed = listRecoveryGaps(db, 'parent', 'home')[0].reviewed;
    expect(listRecoveryGaps(db, 'parent', 'home').map(gap => gap.date)).toEqual(['2026-03-01', '2026-03-02', '2026-03-03']);
    expect(() => listRecoveryGaps(db, 'kid', 'home')).toThrow();
    expect(() => resolveRecoveryGap(db, 'kid', 'home', { seriesId: id, date: '2026-03-01', decision: 'skip', reviewed })).toThrow();
    resolveRecoveryGap(db, 'parent', 'home', { seriesId: id, date: '2026-03-01', decision: 'skip', reviewed });
    resolveRecoveryGap(db, 'parent', 'home', { seriesId: id, date: '2026-03-02', decision: 'create', assigneeId: 'kid', rewardCents: 150, reviewed });
    expect(() => resolveRecoveryGap(db, 'parent', 'home', { seriesId: id, date: '2026-03-02', decision: 'skip', reviewed })).toThrow();
    expect(listRecoveryGaps(db, 'parent', 'home').map(gap => gap.date)).toEqual(['2026-03-03']);
    expect(db.prepare('SELECT count(*) AS count FROM earning').get()).toEqual({ count: 0 });
    const chore = db.prepare('SELECT chore_id FROM recurring_occurrence WHERE series_id = ?').get(id) as { chore_id: string };
    changeChore(db, 'kid', 'home', chore.chore_id, 'submit');
    expect(db.prepare('SELECT count(*) AS count FROM earning').get()).toEqual({ count: 0 });
    changeChore(db, 'parent', 'home', chore.chore_id, 'verify');
    expect(db.prepare('SELECT amount_cents FROM earning').get()).toEqual({ amount_cents: 150 });
  } finally { vi.useRealTimers(); db.close(); }
});

it('does not offer dates in a recorded pause after the series resumes', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    await migrate(db);
    for (const id of ['parent', 'kid']) db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, `${id}@example.test`);
    db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'Synthetic');
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('parent', 'home', 'parent');
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('kid', 'home', 'kid');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T18:00:00Z'));
    const id = createSeries(db, 'parent', 'home', { title: 'Synthetic chore', assigneeId: 'kid', startDate: '2026-03-01', weekdays: [0, 1, 2, 3, 4, 5, 6] });
    setSeriesState(db, 'parent', 'home', id, 'paused');
    vi.setSystemTime(new Date('2026-03-03T18:00:00Z'));
    setSeriesState(db, 'parent', 'home', id, 'active');
    vi.setSystemTime(new Date('2026-03-05T18:00:00Z'));
    expect(listRecoveryGaps(db, 'parent', 'home').map(gap => gap.date)).toEqual(['2026-03-03', '2026-03-04']);
  } finally { vi.useRealTimers(); db.close(); }
});

it('serializes concurrent recovery and ordinary generation across connections', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-recovery-race-'));
  const path = join(dir, 'synthetic.sqlite');
  const db = new Database(path);
  try {
    db.pragma('foreign_keys = ON');
    await migrate(db);
    for (const id of ['parent', 'kid']) db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, `${id}@example.test`);
    db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'Synthetic');
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('parent', 'home', 'parent');
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('kid', 'home', 'kid');
    const day = localDate(new Date(), 'America/Chicago');
    const date = new Date(Date.parse(day + 'T00:00:00Z') - 86_400_000).toISOString().slice(0, 10);
    const id = createSeries(db, 'parent', 'home', { title: 'Synthetic race', assigneeId: 'kid', startDate: date, weekdays: [0, 1, 2, 3, 4, 5, 6] });
    const outcomes = await runDatabaseWorkers('tests/fixtures/recovery-worker.ts', [[path, id, date, 'recover'], [path, id, date, 'generate']]);
    expect(outcomes[1]).toBe('generated');
    expect(['created', 'conflict']).toContain(outcomes[0]);
    expect(db.prepare('SELECT count(*) AS count FROM recurring_occurrence WHERE series_id = ? AND scheduled_date = ?').get(id, date)).toEqual({ count: 1 });
    expect(db.prepare('SELECT count(*) AS count FROM chore').get()).toEqual({ count: 1 });
    expect(db.prepare('SELECT count(*) AS count FROM earning').get()).toEqual({ count: 0 });
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

it('rejects a decision when the series changed after review', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    await migrate(db);
    for (const id of ['parent', 'kid']) db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, `${id}@example.test`);
    db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'Synthetic');
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('parent', 'home', 'parent');
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('kid', 'home', 'kid');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-04T18:00:00Z'));
    const id = createSeries(db, 'parent', 'home', { title: 'Before', assigneeId: 'kid', startDate: '2026-03-03', weekdays: [0, 1, 2, 3, 4, 5, 6] });
    const gap = listRecoveryGaps(db, 'parent', 'home')[0];
    db.prepare('UPDATE recurring_series SET title = ? WHERE id = ?').run('After', id);
    expect(() => resolveRecoveryGap(db, 'parent', 'home', { seriesId: id, date: gap.date, decision: 'create', assigneeId: 'kid', rewardCents: 200, reviewed: gap.reviewed })).toThrow('changed');
    expect(db.prepare('SELECT count(*) AS count FROM chore').get()).toEqual({ count: 0 });
  } finally { vi.useRealTimers(); db.close(); }
});

it('rejects cross-household and disabled members and rolls back a late write failure', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    await migrate(db);
    for (const id of ['parent', 'parent2', 'kid', 'outsider']) db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, `${id}@example.test`);
    for (const id of ['home', 'other']) db.prepare('INSERT INTO household VALUES (?, ?)').run(id, 'Synthetic');
    for (const [id, home, role] of [['parent', 'home', 'parent'], ['parent2', 'home', 'parent'], ['kid', 'home', 'kid'], ['outsider', 'other', 'parent']]) db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(id, home, role);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-04T18:00:00Z'));
    const id = createSeries(db, 'parent', 'home', { title: 'Private synthetic chore', assigneeId: 'kid', startDate: '2026-03-03', weekdays: [0, 1, 2, 3, 4, 5, 6] });
    const gap = listRecoveryGaps(db, 'parent', 'home')[0];
    const decision = { seriesId: id, date: gap.date, reviewed: gap.reviewed, decision: 'create' as const, assigneeId: 'kid', rewardCents: 100 };
    expect(() => listRecoveryGaps(db, 'outsider', 'home')).toThrow();
    expect(listRecoveryGaps(db, 'outsider', 'other')).toEqual([]);
    expect(() => resolveRecoveryGap(db, 'outsider', 'other', decision)).toThrow();
    db.prepare('UPDATE membership SET disabled_at = 1, disabled_by = ? WHERE user_id = ? AND household_id = ?').run('parent2', 'parent', 'home');
    expect(() => resolveRecoveryGap(db, 'parent', 'home', decision)).toThrow();
    expect(() => resolveRecoveryGap(db, 'parent2', 'home', decision)).toThrow();
    db.prepare('UPDATE membership SET disabled_at = NULL, disabled_by = NULL WHERE user_id = ? AND household_id = ?').run('parent', 'home');
    db.prepare('UPDATE membership SET disabled_at = 1, disabled_by = ? WHERE user_id = ? AND household_id = ?').run('parent', 'kid', 'home');
    expect(() => resolveRecoveryGap(db, 'parent', 'home', decision)).toThrow();
    db.prepare('UPDATE membership SET disabled_at = NULL, disabled_by = NULL WHERE user_id = ? AND household_id = ?').run('kid', 'home');
    db.exec("CREATE TRIGGER reject_recovery BEFORE INSERT ON recurring_recovery_decision BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END");
    expect(() => resolveRecoveryGap(db, 'parent', 'home', decision)).toThrow();
    expect(db.prepare('SELECT count(*) AS count FROM chore').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT count(*) AS count FROM recurring_occurrence').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT count(*) AS count FROM recurring_skip').get()).toEqual({ count: 0 });
  } finally { vi.useRealTimers(); db.close(); }
});

it('bounds each review page to one series while allowing later series to be reviewed', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    await migrate(db);
    for (const id of ['parent', 'kid']) db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, `${id}@example.test`);
    db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'Synthetic');
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('parent', 'home', 'parent');
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('kid', 'home', 'kid');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-04T18:00:00Z'));
    for (const title of ['Alpha', 'Beta']) createSeries(db, 'parent', 'home', { title, assigneeId: 'kid', startDate: '2026-03-03', weekdays: [0, 1, 2, 3, 4, 5, 6] });
    expect(listRecoveryGaps(db, 'parent', 'home', 0).map(gap => gap.title)).toEqual(['Alpha']);
    expect(listRecoveryGaps(db, 'parent', 'home', 1).map(gap => gap.title)).toEqual(['Beta']);
    expect(listRecoveryGaps(db, 'parent', 'home', 2)).toEqual([]);
  } finally { vi.useRealTimers(); db.close(); }
});
