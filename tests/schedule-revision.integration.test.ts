import { afterEach, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../src/lib/server/identity';
import { createSeries, generateOccurrences, listSeriesPage, previewSeriesSchedule, reviseSeriesSchedule, SeriesChangeError, setSeriesState, skipOccurrence } from '../src/lib/server/recurring';
import { changeChore } from '../src/lib/server/chores';
import { listRecoveryGaps, resolveRecoveryGap } from '../src/lib/server/recovery';

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

const input = { title: 'Take out trash', description: 'Kitchen and curb', assigneeId: 'kid', rewardCents: 150 };
const today = '2026-11-22';
const effectiveDate = '2026-11-23';
const seriesInput = { ...input, startDate: '2026-11-16', weekdays: [1, 3] };

function occurrence(db: Database.Database, id: string, date: string) {
  return db.prepare('SELECT o.chore_id AS choreId, c.title, c.status, c.cancelled_at AS cancelledAt, c.due_date AS dueDate FROM recurring_occurrence o JOIN chore c ON c.id = o.chore_id WHERE o.series_id = ? AND o.scheduled_date = ?').get(id, date) as { choreId: string; title: string; status: string; cancelledAt: string | null; dueDate: string } | undefined;
}

function series(db: Database.Database, id: string) {
  return db.prepare('SELECT * FROM recurring_series WHERE id = ?').get(id) as { start_date: string; end_date: string | null; weekdays: string; state: string; updated_at: string; title: string; assignee_id: string; reward_cents: number | null };
}

function setStatus(db: Database.Database, id: string, date: string, status: string) {
  const row = occurrence(db, id, date)!;
  db.prepare('UPDATE chore SET status = ? WHERE id = ?').run(status, row.choreId);
}

it('revises future weekdays, cancels obsolete unstarted dates and preserves completed work', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-22T18:00:00Z'));
  const db = await fixture();
  const id = createSeries(db, 'parent', 'home', seriesInput);
  generateOccurrences(db, 'parent', 'home', '2026-11-16', '2026-12-06');
  // A past occurrence can be completed normally; a future one is marked pending through a synthetic fixture.
  changeChore(db, 'kid', 'home', occurrence(db, id, '2026-11-18')!.choreId, 'submit');
  changeChore(db, 'parent', 'home', occurrence(db, id, '2026-11-18')!.choreId, 'verify');
  setStatus(db, id, '2026-11-25', 'pending_verification');
  const before = series(db, id);
  const earningsBefore = db.prepare('SELECT count(*) AS count, COALESCE(SUM(amount_cents), 0) AS cents FROM earning').get();

  const preview = previewSeriesSchedule(db, 'parent', 'home', id, before.updated_at, { ...seriesInput, effectiveDate, weekdays: [2, 4] });
  expect(preview.oldPattern).toBe('Monday and Wednesday');
  expect(preview.newPattern).toBe('Tuesday and Thursday');
  expect(preview.firstAffectedDate).toBe(effectiveDate);
  expect(preview.cancelDates).toEqual(['2026-11-23', '2026-11-30', '2026-12-02']);
  expect(preview.preservedDates).toContain('2026-11-25');

  reviseSeriesSchedule(db, 'parent', 'home', id, before.updated_at, { ...seriesInput, effectiveDate, weekdays: [2, 4] });
  const revised = series(db, id);
  expect(revised).toMatchObject({ start_date: '2026-11-16', weekdays: '[2,4]', title: 'Take out trash', assignee_id: 'kid', reward_cents: 150 });
  expect(listSeriesPage(db, 'parent', 'home').items.find(item => item.id === id)).toMatchObject({ startDate: '2026-11-16', effectiveDate });
  expect(revised.updated_at).not.toBe(before.updated_at);
  expect(occurrence(db, id, '2026-11-23')!.cancelledAt).toBeTruthy();
  expect(occurrence(db, id, '2026-11-30')!.cancelledAt).toBeTruthy();
  expect(occurrence(db, id, '2026-12-02')!.cancelledAt).toBeTruthy();
  expect(occurrence(db, id, '2026-11-25')).toMatchObject({ status: 'pending_verification', cancelledAt: null });
  expect(occurrence(db, id, '2026-11-18')).toMatchObject({ status: 'verified', cancelledAt: null });
  expect(occurrence(db, id, '2026-11-24')).toMatchObject({ title: 'Take out trash', status: 'todo', cancelledAt: null });
  expect(occurrence(db, id, '2026-11-26')).toMatchObject({ title: 'Take out trash', status: 'todo', cancelledAt: null });
  expect(db.prepare('SELECT count(*) AS count, COALESCE(SUM(amount_cents), 0) AS cents FROM earning').get()).toEqual(earningsBefore);

  const revision = db.prepare('SELECT * FROM recurring_schedule_revision WHERE series_id = ?').get(id) as { effective_date: string; old_start_date: string; old_weekdays: string; new_weekdays: string; cancelled_dates: string; created_dates: string; actor_id: string };
  expect(revision).toMatchObject({ effective_date: effectiveDate, old_start_date: '2026-11-16', old_weekdays: '[1,3]', new_weekdays: '[2,4]', actor_id: 'parent' });
  expect(JSON.parse(revision.cancelled_dates)).toEqual(['2026-11-23', '2026-11-30', '2026-12-02']);
  expect(JSON.parse(revision.created_dates)).toEqual(expect.arrayContaining(['2026-11-24', '2026-11-26']));

  const countBefore = db.prepare('SELECT count(*) AS count FROM recurring_occurrence WHERE series_id = ?').get(id);
  generateOccurrences(db, 'parent', 'home', effectiveDate, '2026-12-31');
  generateOccurrences(db, 'parent', 'home', effectiveDate, '2026-12-31');
  expect(db.prepare('SELECT count(*) AS count FROM recurring_occurrence WHERE series_id = ?').get(id)).toEqual(countBefore);
  expect(listRecoveryGaps(db, 'parent', 'home')).toEqual([]);
});

it('validates effective dates, end dates, membership, ended series and stale revisions', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-22T18:00:00Z'));
  const db = await fixture();
  const id = createSeries(db, 'parent', 'home', seriesInput);
  const current = series(db, id);
  const code = (fn: () => void) => {
    try { fn(); return 'none'; } catch (cause) { return cause instanceof SeriesChangeError ? cause.code : cause instanceof Error ? cause.message : 'other'; }
  };
  expect(code(() => reviseSeriesSchedule(db, 'parent', 'home', id, current.updated_at, { ...seriesInput, effectiveDate: today, weekdays: [2] }))).toBe('invalid');
  const future = createSeries(db, 'parent', 'home', { ...seriesInput, startDate: '2099-01-01' });
  const futureCurrent = series(db, future);
  expect(code(() => reviseSeriesSchedule(db, 'parent', 'home', future, futureCurrent.updated_at, { ...seriesInput, effectiveDate, weekdays: [2] }))).toBe('invalid');
  expect(code(() => reviseSeriesSchedule(db, 'parent', 'home', id, current.updated_at, { ...seriesInput, effectiveDate, endDate: '2026-11-20', weekdays: [2] }))).toBe('invalid');
  expect(code(() => reviseSeriesSchedule(db, 'kid', 'home', id, current.updated_at, { ...seriesInput, effectiveDate, weekdays: [2] }))).toBe('Not authorized');
  expect(code(() => reviseSeriesSchedule(db, 'other-parent', 'home', id, current.updated_at, { ...seriesInput, effectiveDate, weekdays: [2] }))).toBe('Not authorized');
  db.prepare("UPDATE membership SET disabled_at = 1, disabled_by = 'parent' WHERE user_id = 'kid'").run();
  expect(code(() => reviseSeriesSchedule(db, 'parent', 'home', id, current.updated_at, { ...seriesInput, effectiveDate, weekdays: [2] }))).toBe('invalid');
  db.prepare("UPDATE membership SET disabled_at = NULL, disabled_by = NULL WHERE user_id = 'kid'").run();

  expect(code(() => reviseSeriesSchedule(db, 'parent-two', 'home', id, current.updated_at, { ...seriesInput, effectiveDate, weekdays: [2, 4] }))).toBe('none');
  const newer = series(db, id);
  expect(code(() => reviseSeriesSchedule(db, 'parent', 'home', id, current.updated_at, { ...seriesInput, effectiveDate, weekdays: [5] }))).toBe('stale');
  expect(series(db, id)).toEqual(newer);
  setSeriesState(db, 'parent', 'home', id, 'ended');
  expect(code(() => reviseSeriesSchedule(db, 'parent', 'home', id, newer.updated_at, { ...seriesInput, effectiveDate, weekdays: [5] }))).toBe('ended');
});

it('shortens an end date by archiving later unstarted dates', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-22T18:00:00Z'));
  const db = await fixture();
  const id = createSeries(db, 'parent', 'home', seriesInput);
  generateOccurrences(db, 'parent', 'home', '2026-11-16', '2026-12-06');
  const current = series(db, id);
  reviseSeriesSchedule(db, 'parent', 'home', id, current.updated_at, { ...seriesInput, effectiveDate, endDate: '2026-11-30', weekdays: [1, 3] });
  expect(series(db, id).end_date).toBe('2026-11-30');
  expect(occurrence(db, id, '2026-11-23')).toMatchObject({ cancelledAt: null, status: 'todo' });
  expect(occurrence(db, id, '2026-11-25')).toMatchObject({ cancelledAt: null, status: 'todo' });
  expect(occurrence(db, id, '2026-11-30')).toMatchObject({ cancelledAt: null, status: 'todo' });
  expect(occurrence(db, id, '2026-12-02')!.cancelledAt).toBeTruthy();
});

it('keeps a paused series paused until it resumes, then generates the new dates once', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-22T18:00:00Z'));
  const db = await fixture();
  const id = createSeries(db, 'parent', 'home', seriesInput);
  generateOccurrences(db, 'parent', 'home', '2026-11-16', '2026-12-06');
  setSeriesState(db, 'parent', 'home', id, 'paused');
  const current = series(db, id);
  reviseSeriesSchedule(db, 'parent', 'home', id, current.updated_at, { ...seriesInput, effectiveDate, weekdays: [2, 4] });
  expect(occurrence(db, id, '2026-11-24')).toBeUndefined();
  expect(occurrence(db, id, '2026-11-23')!.cancelledAt).toBeTruthy();
  setSeriesState(db, 'parent', 'home', id, 'active');
  generateOccurrences(db, 'parent', 'home', effectiveDate, '2026-11-30');
  expect(occurrence(db, id, '2026-11-24')).toMatchObject({ status: 'todo', cancelledAt: null });
  expect(occurrence(db, id, '2026-11-26')).toMatchObject({ status: 'todo', cancelledAt: null });
});

it('does not create a date recorded as skipped and does not revive an archived old date', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-22T18:00:00Z'));
  const db = await fixture();
  const id = createSeries(db, 'parent', 'home', seriesInput);
  generateOccurrences(db, 'parent', 'home', '2026-11-16', '2026-12-06');
  db.prepare("INSERT INTO recurring_skip (series_id, scheduled_date) VALUES (?, '2026-11-24')").run(id);
  const current = series(db, id);
  reviseSeriesSchedule(db, 'parent', 'home', id, current.updated_at, { ...seriesInput, effectiveDate, weekdays: [2, 4] });
  expect(occurrence(db, id, '2026-11-24')).toBeUndefined();
  generateOccurrences(db, 'parent', 'home', effectiveDate, '2026-12-31');
  expect(occurrence(db, id, '2026-11-23')!.cancelledAt).toBeTruthy();
  expect(occurrence(db, id, '2026-11-24')).toBeUndefined();
});

it('preserves pre-effective-date generation, skips, recovery and earlier revisions when scheduling a future change', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-05T18:00:00Z'));
  const db = await fixture();
  const id = createSeries(db, 'parent', 'home', {
    title: 'Old trash',
    description: 'Before change',
    assigneeId: 'kid',
    rewardCents: 150,
    startDate: '2026-05-01',
    weekdays: [1, 3]
  });
  // Only generate today+7 (May 5..12); May 4 (Mon) was missed so recovery should see it.
  generateOccurrences(db, 'parent', 'home', '2026-05-05', '2026-05-12');
  const before = series(db, id);

  // Schedule a future revision effective June 1 (2026-06-01) switching to Tue/Thu with new details.
  reviseSeriesSchedule(db, 'parent', 'home', id, before.updated_at, {
    title: 'New trash',
    description: 'After change',
    assigneeId: 'sibling',
    rewardCents: 250,
    startDate: '2026-06-01',
    effectiveDate: '2026-06-01',
    weekdays: [2, 4]
  });

  // Series start_date must remain 2026-05-01, while latest effectiveDate is 2026-06-01.
  expect(series(db, id).start_date).toBe('2026-05-01');
  expect(listSeriesPage(db, 'parent', 'home').items.find(item => item.id === id)).toMatchObject({
    startDate: '2026-05-01',
    effectiveDate: '2026-06-01'
  });

  // 1) Recovery still sees missed Mon May 4 under [1, 3] and does not invent false Tue/Thu gaps.
  expect(listRecoveryGaps(db, 'parent', 'home').map(gap => ({ date: gap.date, assigneeId: gap.assigneeId, rewardCents: gap.rewardCents }))).toEqual([
    { date: '2026-05-04', assigneeId: 'kid', rewardCents: 150 }
  ]);

  // 2) Skipping an upcoming pre-effective-date Monday/Wednesday succeeds; non-scheduled Tuesday is rejected.
  skipOccurrence(db, 'parent', 'home', id, '2026-05-13');
  expect(() => skipOccurrence(db, 'parent', 'home', id, '2026-05-12')).toThrow();

  // 3) Advancing into mid-May still generates Mon/Wed occurrences before June 1 with the old details (and skips May 13).
  generateOccurrences(db, 'parent', 'home', '2026-05-12', '2026-06-05');
  expect(occurrence(db, id, '2026-05-13')).toBeUndefined();
  expect(occurrence(db, id, '2026-05-18')).toMatchObject({ title: 'Old trash', status: 'todo', cancelledAt: null });
  expect(occurrence(db, id, '2026-05-20')).toMatchObject({ title: 'Old trash', status: 'todo', cancelledAt: null });
  expect(occurrence(db, id, '2026-06-02')).toMatchObject({ title: 'New trash', status: 'todo', cancelledAt: null });
  const may18 = db.prepare('SELECT c.assignee_id, c.reward_cents FROM recurring_occurrence o JOIN chore c ON c.id = o.chore_id WHERE o.series_id = ? AND o.scheduled_date = ? AND o.archived_at IS NULL').get(id, '2026-05-18');
  expect(may18).toEqual({ assignee_id: 'kid', reward_cents: 150 });

  // 4) A subsequent revision effective earlier than 2026-06-01 (2026-05-22) is accepted and supersedes the June 1 revision.
  const mid = series(db, id);
  reviseSeriesSchedule(db, 'parent', 'home', id, mid.updated_at, {
    title: 'Friday trash',
    description: 'Fridays only',
    assigneeId: 'kid',
    rewardCents: 300,
    startDate: '2026-05-22',
    effectiveDate: '2026-05-22',
    weekdays: [5]
  });
  // Previously pre-generated June 2 (Tuesday) from the superseded June 1 revision is cancelled; May 22 & May 29 (Fridays) exist.
  const activeOn = (date: string) => db.prepare('SELECT c.title, c.status, c.cancelled_at AS cancelledAt FROM recurring_occurrence o JOIN chore c ON c.id = o.chore_id WHERE o.series_id = ? AND o.scheduled_date = ? AND o.archived_at IS NULL').get(id, date);
  expect(activeOn('2026-05-18')).toMatchObject({ title: 'Old trash', cancelledAt: null });
  expect(activeOn('2026-05-22')).toMatchObject({ title: 'Friday trash', cancelledAt: null });
  expect(activeOn('2026-06-02')).toBeUndefined();
});

it('re-adds previously removed weekdays on a later schedule revision without losing audit history or duplicating active work', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-22T18:00:00Z'));
  const db = await fixture();
  const id = createSeries(db, 'parent', 'home', seriesInput);
  generateOccurrences(db, 'parent', 'home', '2026-11-16', '2026-12-06');
  // Preserve Wed 2026-11-25 as submitted, explicitly skip Mon 2026-11-30.
  setStatus(db, id, '2026-11-25', 'pending_verification');
  skipOccurrence(db, 'parent', 'home', id, '2026-11-30');
  const firstMonChoreId = occurrence(db, id, '2026-11-23')!.choreId;

  // Revision 1: Mon/Wed -> Tue/Thu (cancels Mon 11-23 and Wed 12-02, preserves pending Wed 11-25).
  const beforeFirst = series(db, id);
  reviseSeriesSchedule(db, 'parent', 'home', id, beforeFirst.updated_at, { ...seriesInput, effectiveDate, weekdays: [2, 4] });
  expect(db.prepare('SELECT cancelled_at FROM chore WHERE id = ?').get(firstMonChoreId)).toMatchObject({ cancelled_at: expect.any(String) });

  // Revision 2: Tue/Thu -> back to Mon/Wed.
  const beforeSecond = series(db, id);
  const preview = previewSeriesSchedule(db, 'parent', 'home', id, beforeSecond.updated_at, { ...seriesInput, effectiveDate, weekdays: [1, 3] });
  expect(preview.addDates).toContain('2026-11-23');
  expect(preview.addDates).toContain('2026-12-02');
  expect(preview.addDates).not.toContain('2026-11-25');
  expect(preview.addDates).not.toContain('2026-11-30');
  expect(preview.preservedDates).toContain('2026-11-25');

  reviseSeriesSchedule(db, 'parent', 'home', id, beforeSecond.updated_at, { ...seriesInput, effectiveDate, weekdays: [1, 3] });
  const activeRows = (date: string) => db.prepare('SELECT o.chore_id AS choreId, c.status, c.cancelled_at AS cancelledAt FROM recurring_occurrence o JOIN chore c ON c.id = o.chore_id WHERE o.series_id = ? AND o.scheduled_date = ? AND o.archived_at IS NULL').all(id, date) as { choreId: string; status: string; cancelledAt: string | null }[];
  // Mon 11-23 and Wed 12-02 are freshly created; old cancelled chore stays intact in audit history.
  expect(activeRows('2026-11-23')).toHaveLength(1);
  expect(activeRows('2026-11-23')[0].choreId).not.toBe(firstMonChoreId);
  expect(activeRows('2026-11-23')[0]).toMatchObject({ status: 'todo', cancelledAt: null });
  expect(db.prepare('SELECT cancelled_at FROM chore WHERE id = ?').get(firstMonChoreId)).toMatchObject({ cancelled_at: expect.any(String) });
  expect(activeRows('2026-12-02')).toHaveLength(1);
  // Preserved pending Wed 11-25 has no duplicate; skipped Mon 11-30 stays uncreated.
  expect(activeRows('2026-11-25')).toHaveLength(1);
  expect(activeRows('2026-11-25')[0].status).toBe('pending_verification');
  expect(activeRows('2026-11-30').filter(row => row.cancelledAt === null)).toHaveLength(0);
});

it('resumes a paused series before a future effective date using the prior version and allows recovering a re-added cancelled date', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-04T18:00:00Z'));
  const db = await fixture();
  const id = createSeries(db, 'parent', 'home', {
    title: 'Before pause',
    assigneeId: 'kid',
    rewardCents: 100,
    startDate: '2026-05-04',
    weekdays: [1, 3]
  });
  generateOccurrences(db, 'parent', 'home', '2026-05-04', '2026-05-18');
  setSeriesState(db, 'parent', 'home', id, 'paused');

  // Revise effective May 11 -> Tue/Thu (cancels Mon May 11 & Wed May 13), then revise effective May 11 back to Mon/Wed while paused.
  const paused = series(db, id);
  reviseSeriesSchedule(db, 'parent', 'home', id, paused.updated_at, {
    title: 'Temp Tue/Thu',
    assigneeId: 'kid',
    rewardCents: 150,
    startDate: '2026-05-11',
    effectiveDate: '2026-05-11',
    weekdays: [2, 4]
  });
  const afterRemove = series(db, id);
  reviseSeriesSchedule(db, 'parent', 'home', id, afterRemove.updated_at, {
    title: 'Restored Mon/Wed',
    assigneeId: 'kid',
    rewardCents: 175,
    startDate: '2026-05-11',
    effectiveDate: '2026-05-11',
    weekdays: [1, 3]
  });
  // Also schedule a later June 1 revision to Fridays.
  const afterRestore = series(db, id);
  reviseSeriesSchedule(db, 'parent', 'home', id, afterRestore.updated_at, {
    title: 'June Friday',
    assigneeId: 'sibling',
    rewardCents: 200,
    startDate: '2026-06-01',
    effectiveDate: '2026-06-01',
    weekdays: [5]
  });

  // Resume on May 11 (without running generation for May 11), then advance clock to May 12.
  vi.setSystemTime(new Date('2026-05-11T18:00:00Z'));
  setSeriesState(db, 'parent', 'home', id, 'active');
  vi.setSystemTime(new Date('2026-05-12T18:00:00Z'));

  // Recovery must see Mon May 11 despite the earlier cancelled chore row and allow creating a fresh occurrence.
  const gaps = listRecoveryGaps(db, 'parent', 'home');
  expect(gaps.map(gap => ({ date: gap.date, title: gap.title, assigneeId: gap.assigneeId, rewardCents: gap.rewardCents }))).toEqual([
    { date: '2026-05-11', title: 'Restored Mon/Wed', assigneeId: 'kid', rewardCents: 175 }
  ]);
  resolveRecoveryGap(db, 'parent', 'home', { seriesId: id, date: '2026-05-11', decision: 'create', assigneeId: 'kid', rewardCents: 175, reviewed: gaps[0].reviewed });
  expect(listRecoveryGaps(db, 'parent', 'home')).toEqual([]);

  // Generating May 12..May 25 after resuming uses the May 11 version (Mon/Wed), not the June 1 Friday version.
  generateOccurrences(db, 'parent', 'home', '2026-05-12', '2026-05-25');
  const activeDates = db.prepare('SELECT scheduled_date, c.title FROM recurring_occurrence o JOIN chore c ON c.id = o.chore_id WHERE o.series_id = ? AND o.archived_at IS NULL AND o.scheduled_date >= ? ORDER BY scheduled_date').all(id, '2026-05-11');
  expect(activeDates).toEqual([
    { scheduled_date: '2026-05-11', title: 'Restored Mon/Wed' },
    { scheduled_date: '2026-05-13', title: 'Restored Mon/Wed' },
    { scheduled_date: '2026-05-18', title: 'Restored Mon/Wed' },
    { scheduled_date: '2026-05-20', title: 'Restored Mon/Wed' },
    { scheduled_date: '2026-05-25', title: 'Restored Mon/Wed' }
  ]);
});

it('cancels and previews materialized occurrences more than 366 days after the effective date', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-22T18:00:00Z'));
  const db = await fixture();
  const id = createSeries(db, 'parent', 'home', seriesInput);
  // Materialize a far-future week (> 2 years out, as /chores/week allows up to 520 weeks).
  generateOccurrences(db, 'parent', 'home', '2028-11-26', '2028-12-02');
  // 2028-11-27 is Monday, 2028-11-29 is Wednesday.
  expect(occurrence(db, id, '2028-11-27')).toMatchObject({ title: 'Take out trash', status: 'todo', cancelledAt: null });
  expect(occurrence(db, id, '2028-11-29')).toMatchObject({ title: 'Take out trash', status: 'todo', cancelledAt: null });

  // 1) Revise weekdays from Mon/Wed to Wed/Fri with a new title: far-future Mon must be cancelled (not overwritten), far-future Wed kept and updated.
  const firstBefore = series(db, id);
  const firstPreview = previewSeriesSchedule(db, 'parent', 'home', id, firstBefore.updated_at, {
    ...seriesInput,
    title: 'Updated trash',
    effectiveDate,
    weekdays: [3, 5]
  });
  expect(firstPreview.cancelDates).toContain('2028-11-27');
  expect(firstPreview.keepDates).toContain('2028-11-29');

  reviseSeriesSchedule(db, 'parent', 'home', id, firstBefore.updated_at, {
    ...seriesInput,
    title: 'Updated trash',
    effectiveDate,
    weekdays: [3, 5]
  });
  expect(occurrence(db, id, '2028-11-27')).toMatchObject({ title: 'Take out trash', cancelledAt: expect.any(String) });
  expect(occurrence(db, id, '2028-11-29')).toMatchObject({ title: 'Updated trash', cancelledAt: null });

  // 2) Shorten endDate to 2026-12-31: the remaining far-future Wed 2028-11-29 must also be cancelled and not overwritten.
  const secondBefore = series(db, id);
  const secondPreview = previewSeriesSchedule(db, 'parent', 'home', id, secondBefore.updated_at, {
    ...seriesInput,
    title: 'Shortened trash',
    effectiveDate,
    endDate: '2026-12-31',
    weekdays: [3, 5]
  });
  expect(secondPreview.cancelDates).toContain('2028-11-29');

  reviseSeriesSchedule(db, 'parent', 'home', id, secondBefore.updated_at, {
    ...seriesInput,
    title: 'Shortened trash',
    effectiveDate,
    endDate: '2026-12-31',
    weekdays: [3, 5]
  });
  expect(occurrence(db, id, '2028-11-29')).toMatchObject({ title: 'Updated trash', cancelledAt: expect.any(String) });
  expect(db.prepare('SELECT archived_at FROM recurring_occurrence WHERE series_id = ? AND scheduled_date = ?').get(id, '2028-11-29')).toMatchObject({ archived_at: expect.any(String) });
});

it('rejects creating or revising a recurring chore series whose date range matches zero weekdays', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-22T18:00:00Z'));
  const db = await fixture();
  // Mon 2026-11-23 through Wed 2026-11-25 has no Friday (weekday 5).
  expect(() => createSeries(db, 'parent', 'home', {
    ...input,
    startDate: '2026-11-23',
    endDate: '2026-11-25',
    weekdays: [5]
  })).toThrow('Invalid series');

  const id = createSeries(db, 'parent', 'home', seriesInput);
  const before = series(db, id);
  expect(() => reviseSeriesSchedule(db, 'parent', 'home', id, before.updated_at, {
    ...seriesInput,
    effectiveDate: '2026-11-23',
    endDate: '2026-11-25',
    weekdays: [5]
  })).toThrow('invalid');
});
