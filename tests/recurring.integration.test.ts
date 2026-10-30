import { expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../src/lib/server/identity';
import { createSeries, generateOccurrences, setHouseholdTimezone, setSeriesState, skipOccurrence, updateSeries } from '../src/lib/server/recurring';
import { changeChore } from '../src/lib/server/chores';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('generates household-scoped occurrences once and credits only verified work', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    await migrate(db);
    for (const id of ['parent', 'kid', 'outsider']) {
      db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, `${id}@example.test`);
    }
    db.prepare('INSERT INTO household (id, name) VALUES (?, ?)').run('home', 'Synthetic');
    for (const [id, role] of [['parent', 'parent'], ['kid', 'kid']]) db.prepare('INSERT INTO membership VALUES (?, ?, ?)').run(id, 'home', role);
    const input = { title: 'Feed pet', assigneeId: 'kid', startDate: '2026-03-07', weekdays: [0, 1, 2, 3, 4, 5, 6], rewardCents: 200 };
    expect(() => createSeries(db, 'kid', 'home', input)).toThrow();
    expect(() => createSeries(db, 'outsider', 'home', input)).toThrow();
    expect(() => createSeries(db, 'parent', 'home', { ...input, assigneeId: 'outsider' })).toThrow();
    const series = createSeries(db, 'parent', 'home', input);
    expect(() => skipOccurrence(db, 'parent', 'home', series, '2026-03-06')).toThrow();
    generateOccurrences(db, 'kid', 'home', '2026-03-07', '2026-03-09');
    generateOccurrences(db, 'parent', 'home', '2026-03-07', '2026-03-09');
    const chores = db.prepare('SELECT c.id, c.due_date FROM recurring_occurrence o JOIN chore c ON c.id = o.chore_id WHERE o.series_id = ? ORDER BY c.due_date').all(series) as { id: string; due_date: string }[];
    expect(chores.map(chore => chore.due_date)).toEqual(['2026-03-07', '2026-03-08', '2026-03-09']);
    changeChore(db, 'kid', 'home', chores[0].id, 'submit');
    expect(db.prepare('SELECT count(*) AS count FROM earning').get()).toEqual({ count: 0 });
    changeChore(db, 'parent', 'home', chores[0].id, 'verify');
    expect(db.prepare('SELECT amount_cents FROM earning WHERE chore_id = ?').get(chores[0].id)).toEqual({ amount_cents: 200 });
    expect(() => changeChore(db, 'parent', 'home', chores[0].id, 'verify')).toThrow();
    expect(() => setSeriesState(db, 'kid', 'home', series, 'paused')).toThrow();
    setSeriesState(db, 'parent', 'home', series, 'paused');
    generateOccurrences(db, 'parent', 'home', '2026-03-10', '2026-03-10');
    expect(db.prepare('SELECT count(*) AS count FROM recurring_occurrence').get()).toEqual({ count: 3 });
    setSeriesState(db, 'parent', 'home', series, 'active');
    skipOccurrence(db, 'parent', 'home', series, '2026-03-08');
    expect(() => changeChore(db, 'kid', 'home', chores[1].id, 'submit')).toThrow();
    expect(() => skipOccurrence(db, 'parent', 'home', series, '2026-03-07')).toThrow();
    skipOccurrence(db, 'parent', 'home', series, '2026-03-10');
    updateSeries(db, 'parent', 'home', series, { ...input, rewardCents: 350 });
    generateOccurrences(db, 'parent', 'home', '2026-03-10', '2026-03-11');
    expect(db.prepare('SELECT c.due_date, c.reward_cents FROM recurring_occurrence o JOIN chore c ON c.id = o.chore_id WHERE o.series_id = ? ORDER BY c.due_date').all(series)).toEqual([
      { due_date: '2026-03-07', reward_cents: 200 }, { due_date: '2026-03-08', reward_cents: 200 },
      { due_date: '2026-03-09', reward_cents: 200 }, { due_date: '2026-03-11', reward_cents: 350 }
    ]);
    setSeriesState(db, 'parent', 'home', series, 'ended');
    expect(() => setSeriesState(db, 'parent', 'home', series, 'active')).toThrow();
  } finally { db.close(); }
});

it('serializes generation from independent processes without duplicate occurrences', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-recurrence-race-'));
  const path = join(dir, 'synthetic.sqlite');
  const db = new Database(path);
  try {
    db.pragma('foreign_keys = ON');
    await migrate(db);
    for (const id of ['parent', 'kid']) db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, `${id}@example.test`);
    db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'Synthetic');
    db.prepare('INSERT INTO membership VALUES (?, ?, ?)').run('parent', 'home', 'parent');
    db.prepare('INSERT INTO membership VALUES (?, ?, ?)').run('kid', 'home', 'kid');
    createSeries(db, 'parent', 'home', { title: 'Race', assigneeId: 'kid', startDate: '2099-01-01', weekdays: [0, 1, 2, 3, 4, 5, 6] });
    const workers = [0, 1].map(() => spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/generate-occurrences.ts', path], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }));
    const outcomes = workers.map(worker => new Promise<string>((resolve, reject) => {
      worker.on('error', reject);
      worker.on('message', message => { if (message !== 'ready') resolve(String(message)); });
      worker.on('exit', code => { if (code !== 0) reject(new Error(`worker exited ${code}`)); });
    }));
    await Promise.all(workers.map(worker => new Promise<void>((resolve, reject) => {
      worker.on('message', message => { if (message === 'ready') resolve(); });
      worker.on('error', reject);
    })));
    for (const worker of workers) worker.send('go');
    expect(await Promise.all(outcomes)).toEqual(['generated', 'generated']);
    expect(db.prepare('SELECT count(*) AS count, count(DISTINCT scheduled_date) AS dates FROM recurring_occurrence').get()).toEqual({ count: 7, dates: 7 });
    expect(db.prepare('SELECT count(*) AS count FROM chore').get()).toEqual({ count: 7 });
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

it('updates future unstarted occurrences without changing verified history', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    await migrate(db);
    for (const id of ['parent', 'kid']) db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, `${id}@example.test`);
    db.prepare('INSERT INTO household (id, name) VALUES (?, ?)').run('home', 'Synthetic');
    db.prepare('INSERT INTO membership VALUES (?, ?, ?)').run('parent', 'home', 'parent');
    db.prepare('INSERT INTO membership VALUES (?, ?, ?)').run('kid', 'home', 'kid');
    expect(() => setHouseholdTimezone(db, 'kid', 'home', 'America/New_York')).toThrow();
    expect(() => setHouseholdTimezone(db, 'parent', 'home', 'Not/AZone')).toThrow();
    setHouseholdTimezone(db, 'parent', 'home', 'America/New_York');
    expect(db.prepare('SELECT timezone FROM household_settings WHERE household_id = ?').get('home')).toEqual({ timezone: 'America/New_York' });
    const input = { title: 'Original', assigneeId: 'kid', startDate: '2099-01-01', weekdays: [0, 1, 2, 3, 4, 5, 6], rewardCents: 200 };
    const id = createSeries(db, 'parent', 'home', input);
    generateOccurrences(db, 'parent', 'home', '2099-01-01', '2099-01-02');
    const future = db.prepare('SELECT chore_id FROM recurring_occurrence WHERE series_id = ? ORDER BY scheduled_date').get(id) as { chore_id: string };
    expect(() => changeChore(db, 'kid', 'home', future.chore_id, 'submit')).toThrow();
    updateSeries(db, 'parent', 'home', id, { ...input, title: 'Updated', rewardCents: 350 });
    expect(db.prepare('SELECT title, reward_cents FROM chore ORDER BY due_date').all()).toEqual([{ title: 'Updated', reward_cents: 350 }, { title: 'Updated', reward_cents: 350 }]);
  } finally { db.close(); }
});

it('does not revive generated dates that elapsed while a series was paused', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    await migrate(db);
    for (const id of ['parent', 'kid']) db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, `${id}@example.test`);
    db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'Synthetic');
    db.prepare('INSERT INTO membership VALUES (?, ?, ?)').run('parent', 'home', 'parent');
    db.prepare('INSERT INTO membership VALUES (?, ?, ?)').run('kid', 'home', 'kid');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-07T18:00:00Z'));
    const id = createSeries(db, 'parent', 'home', { title: 'Daily', assigneeId: 'kid', startDate: '2026-03-07', weekdays: [0, 1, 2, 3, 4, 5, 6] });
    generateOccurrences(db, 'parent', 'home', '2026-03-07', '2026-03-10');
    setSeriesState(db, 'parent', 'home', id, 'paused');
    vi.setSystemTime(new Date('2026-03-09T18:00:00Z'));
    setSeriesState(db, 'parent', 'home', id, 'active');
    expect(db.prepare('SELECT scheduled_date FROM recurring_skip ORDER BY scheduled_date').all()).toEqual([{ scheduled_date: '2026-03-07' }, { scheduled_date: '2026-03-08' }]);
    const skipped = db.prepare("SELECT chore_id FROM recurring_occurrence WHERE scheduled_date = '2026-03-08'").get() as { chore_id: string };
    expect(() => changeChore(db, 'kid', 'home', skipped.chore_id, 'submit')).toThrow();
  } finally { vi.useRealTimers(); db.close(); }
});
