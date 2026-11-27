import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { bootstrap } from '../src/lib/server/bootstrap';
import { createAuth } from '../src/lib/server/identity';
import { startSeedServer } from './e2e-seed-server';
import { appCommand } from './e2e-app-command';

// Synthetic fixtures only, isolated from developer databases and credentials.
const directory = mkdtempSync(join(tmpdir(), 'fleck-e2e-'));
const config = { dbPath: join(directory, 'fixture.sqlite'), origin: 'http://127.0.0.1:4173', secret: 'synthetic-test-secret-only-not-for-production-1234' };
await bootstrap(config, { name: 'Sample Parent', email: 'parent@example.test', password: 'synthetic-parent-password', household: 'Example' });
const db = new Database(config.dbPath, { fileMustExist: true });
const auth = createAuth(db, { ...config, allowSignUp: true });
const kid = await auth.api.signUpEmail({ body: { name: 'Sample Kid', email: 'kid@example.test', password: 'synthetic-kid-password' } });
const other = await auth.api.signUpEmail({ body: { name: 'Other Kid', email: 'other@example.test', password: 'synthetic-other-password' } });
const payoutKid = await auth.api.signUpEmail({ body: { name: 'Payout Kid', email: 'payout-kid@example.test', password: 'synthetic-payout-kid-password' } });
const balanceKid = await auth.api.signUpEmail({ body: { name: 'Balance Kid', email: 'balance-kid@example.test', password: 'synthetic-balance-kid-password' } });
const stalePayoutOnKid = await auth.api.signUpEmail({ body: { name: 'Stale Payout On Kid', email: 'stale-payout-on@example.test', password: 'synthetic-stale-payout-on-password' } });
const stalePayoutOffKid = await auth.api.signUpEmail({ body: { name: 'Stale Payout Off Kid', email: 'stale-payout-off@example.test', password: 'synthetic-stale-payout-off-password' } });
const multiParent = await auth.api.signUpEmail({ body: { name: 'Multi Parent', email: 'multi-parent@example.test', password: 'synthetic-multi-parent-password' } });
const otherParent = await auth.api.signUpEmail({ body: { name: 'Other Parent', email: 'other-parent@example.test', password: 'synthetic-other-parent-password' } });
const household = db.prepare('SELECT id FROM household').get() as { id: string };
db.prepare('INSERT INTO household (id, name) VALUES (?, ?)').run('synthetic-other-household', 'Other household');
db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(kid.user.id, household.id, 'kid');
db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(other.user.id, household.id, 'kid');
db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(payoutKid.user.id, household.id, 'kid');
db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(balanceKid.user.id, household.id, 'kid');
db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(stalePayoutOnKid.user.id, household.id, 'kid');
db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(stalePayoutOffKid.user.id, household.id, 'kid');
db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(otherParent.user.id, 'synthetic-other-household', 'parent');
db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(multiParent.user.id, household.id, 'parent');
db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(multiParent.user.id, 'synthetic-other-household', 'parent');
db.prepare('INSERT INTO household (id, name) VALUES (?, ?)').run('synthetic-failure-household', 'Validation example');
db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(multiParent.user.id, 'synthetic-failure-household', 'parent');
// Bulk grocery journeys: one household per scenario (e2e/bulk-groceries.spec.ts). The grocery
// list journeys build their own households with freshHousehold() instead.
for (const fixture of [
  { key: 'bulk-a', name: 'Bulk Grocery Parent A', role: 'parent' },
  { key: 'bulk-b', name: 'Bulk Grocery Parent B', role: 'parent' },
  { key: 'bulk-kid', name: 'Bulk Grocery Kid', role: 'kid' },
  { key: 'bulk-live', name: 'Bulk Grocery Live Parent', role: 'parent' }
] as const) {
  const created = await auth.api.signUpEmail({ body: { name: fixture.name, email: `grocery-parent-${fixture.key}@example.test`, password: `synthetic-grocery-parent-${fixture.key}-password` } });
  const householdId = `synthetic-grocery-${fixture.key}-household`;
  db.prepare('INSERT INTO household (id, name) VALUES (?, ?)').run(householdId, fixture.name);
  db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(created.user.id, householdId, fixture.role);
}
db.exec("CREATE TRIGGER reject_synthetic_child_invite BEFORE INSERT ON household_invitation WHEN NEW.household_id = 'synthetic-failure-household' AND NEW.role = 'kid' BEGIN SELECT RAISE(ABORT, 'synthetic invitation failure'); END");
// Member-disable journeys: one-shot fixtures, each disabled at most once per run.
const revokeKid = await auth.api.signUpEmail({ body: { name: 'Revoke Kid', email: 'revoke-kid@example.test', password: 'synthetic-revoke-kid-password' } });
const revokeParent = await auth.api.signUpEmail({ body: { name: 'Revoke Parent', email: 'revoke-parent@example.test', password: 'synthetic-revoke-parent-password' } });
const raceOne = await auth.api.signUpEmail({ body: { name: 'Race One', email: 'race-one@example.test', password: 'synthetic-race-one-password' } });
const raceTwo = await auth.api.signUpEmail({ body: { name: 'Race Two', email: 'race-two@example.test', password: 'synthetic-race-two-password' } });
db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(revokeKid.user.id, household.id, 'kid');
db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(revokeParent.user.id, household.id, 'parent');
db.prepare('INSERT INTO household (id, name) VALUES (?, ?)').run('synthetic-race-household', 'Race household');
db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(raceOne.user.id, 'synthetic-race-household', 'parent');
db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(raceTwo.user.id, 'synthetic-race-household', 'parent');
const retainedParent = await auth.api.signUpEmail({ body: { name: 'Retained Parent', email: 'retained-parent@example.test', password: 'synthetic-retained-parent-password' } });
db.prepare('INSERT INTO household (id, name) VALUES (?, ?), (?, ?)').run('synthetic-disable-selected', 'Revocation example', 'synthetic-disable-retained', 'Remaining household');
const addMembership = db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)');
addMembership.run(multiParent.user.id, 'synthetic-disable-selected', 'parent');
addMembership.run(retainedParent.user.id, 'synthetic-disable-selected', 'parent');
addMembership.run(retainedParent.user.id, 'synthetic-disable-retained', 'parent');
for (const mode of ['Script', 'Native']) {
  const email = `retry-${mode.toLowerCase()}@example.test`;
  const child = await auth.api.signUpEmail({ body: { name: `Retry ${mode}`, email, password: 'synthetic-disable-retry-password' } });
  addMembership.run(child.user.id, 'synthetic-disable-selected', 'kid');
}
// Display-pairing journeys: a household with two parents so one can be disabled.
const displayOne = await auth.api.signUpEmail({ body: { name: 'Display Parent One', email: 'display-one@example.test', password: 'synthetic-display-one-password' } });
const displayTwo = await auth.api.signUpEmail({ body: { name: 'Display Parent Two', email: 'display-two@example.test', password: 'synthetic-display-two-password' } });
db.prepare('INSERT INTO household (id, name) VALUES (?, ?)').run('synthetic-display-household', 'Display household');
db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(displayOne.user.id, 'synthetic-display-household', 'parent');
db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(displayTwo.user.id, 'synthetic-display-household', 'parent');
// Multi-household display management: one parent in two households. "A ..." sorts first, so it is
// the default; the journeys manage the second household explicitly.
const displayMulti = await auth.api.signUpEmail({ body: { name: 'Display Multi Parent', email: 'display-multi@example.test', password: 'synthetic-display-multi-password' } });
db.prepare('INSERT INTO household (id, name) VALUES (?, ?), (?, ?)').run('synthetic-display-first', 'A display home', 'synthetic-display-second', 'B display home');
for (const id of ['synthetic-display-first', 'synthetic-display-second']) db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(displayMulti.user.id, id, 'parent');
// The second household's own parent, whose primary household it is, creates its records.
const displaySecondParent = await auth.api.signUpEmail({ body: { name: 'Display Second Parent', email: 'display-second@example.test', password: 'synthetic-display-second-password' } });
db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(displaySecondParent.user.id, 'synthetic-display-second', 'parent');
// Checklist readiness journeys use a dedicated household for exact dashboard summaries.
const prepHousehold = 'synthetic-prep-household';
db.prepare('INSERT INTO household (id, name) VALUES (?, ?)').run(prepHousehold, 'Trip preparation household');
db.prepare('INSERT INTO household_settings (household_id, timezone) VALUES (?, ?)').run(prepHousehold, 'America/Chicago');
for (const [key, name, role] of [
  ['prep-parent', 'Trip Parent', 'parent'],
  ['prep-peer', 'Trip Co-parent', 'parent'],
  ['prep-alex', 'Alex', 'kid'],
  ['prep-riley', 'Riley', 'kid']
]) {
  const { user } = await auth.api.signUpEmail({ body: { name, email: `${key}@example.test`, password: `synthetic-${key}-password` } });
  addMembership.run(user.id, prepHousehold, role);
}
// Dashboard calendar journeys: an isolated household in a non-host time zone.
const calendarParent = await auth.api.signUpEmail({ body: { name: 'Calendar Parent', email: 'calendar-parent@example.test', password: 'synthetic-calendar-parent-password' } });
const calendarKid = await auth.api.signUpEmail({ body: { name: 'Calendar Kid', email: 'calendar-kid@example.test', password: 'synthetic-calendar-kid-password' } });
db.prepare('INSERT INTO household (id, name) VALUES (?, ?)').run('synthetic-calendar-household', 'Calendar household');
db.prepare('INSERT INTO household_settings (household_id, timezone) VALUES (?, ?)').run('synthetic-calendar-household', 'Pacific/Kiritimati');
db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(calendarParent.user.id, 'synthetic-calendar-household', 'parent');
db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(calendarKid.user.id, 'synthetic-calendar-household', 'kid');
const emptyCalendarParent = await auth.api.signUpEmail({ body: { name: 'Calendar Empty Parent', email: 'calendar-empty-parent@example.test', password: 'synthetic-calendar-empty-parent-password' } });
db.prepare('INSERT INTO household (id, name) VALUES (?, ?)').run('synthetic-calendar-empty-household', 'Empty calendar household');
db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(emptyCalendarParent.user.id, 'synthetic-calendar-empty-household', 'parent');
const sessionKid = await auth.api.signUpEmail({ body: { name: 'Session Kid', email: 'session-kid@example.test', password: 'synthetic-session-kid-password' } });
db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(sessionKid.user.id, household.id, 'kid');
// Sign-up auto-created a session; the journey counts only the devices it signs in.
db.prepare('DELETE FROM session WHERE userId = ?').run(sessionKid.user.id);
// Grocery endpoint journeys: a valid sign-in with no active household membership.
const disabledGrocery = await auth.api.signUpEmail({ body: { name: 'Disabled Grocery Member', email: 'disabled-grocery@example.test', password: 'synthetic-disabled-grocery-password' } });
const bootstrapParent = db.prepare("SELECT id FROM user WHERE email = 'parent@example.test'").get() as { id: string };
db.prepare('INSERT INTO household (id, name) VALUES (?, ?)').run('synthetic-disabled-grocery-household', 'Disabled grocery household');
db.prepare('INSERT INTO membership (user_id, household_id, role, disabled_at, disabled_by) VALUES (?, ?, ?, ?, ?)').run(disabledGrocery.user.id, 'synthetic-disabled-grocery-household', 'kid', Date.now(), bootstrapParent.id);
const disabledExpense = await auth.api.signUpEmail({ body: { name: 'Disabled Expense Parent', email: 'disabled-expense@example.test', password: 'synthetic-disabled-expense-password' } });
db.prepare('INSERT INTO membership (user_id, household_id, role, disabled_at, disabled_by) VALUES (?, ?, ?, ?, ?)').run(disabledExpense.user.id, household.id, 'parent', Date.now(), bootstrapParent.id);
const seededAt = new Date().toISOString();
db.prepare("INSERT INTO chore (id, household_id, assignee_id, title, due_date, reward_cents, status, created_at, updated_at) VALUES ('revoke-pending-chore', ?, ?, 'Revocation pending chore', '2026-11-01', 250, 'pending_verification', ?, ?)").run(household.id, revokeKid.user.id, seededAt, seededAt);
// Bounded history journeys: a dedicated household keeps pagination and financial totals
// independent from concurrently running chores and payout tests.
const historyParent = await auth.api.signUpEmail({ body: { name: 'History Parent', email: 'history-parent@example.test', password: 'synthetic-history-parent-password' } });
const historyKid = await auth.api.signUpEmail({ body: { name: 'History Kid', email: 'history-kid@example.test', password: 'synthetic-history-kid-password' } });
const historySibling = await auth.api.signUpEmail({ body: { name: 'History Sibling', email: 'history-sibling@example.test', password: 'synthetic-history-sibling-password' } });
db.prepare('INSERT INTO household (id, name) VALUES (?, ?)').run('synthetic-history-household', 'History household');
for (const [userId, role] of [[historyParent.user.id, 'parent'], [historyKid.user.id, 'kid'], [historySibling.user.id, 'kid']] as const) {
  db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(userId, 'synthetic-history-household', role);
}
const historyChore = db.prepare(`INSERT INTO chore (id, household_id, assignee_id, title, due_date, reward_cents, status, created_at, updated_at)
  VALUES (?, 'synthetic-history-household', ?, ?, ?, ?, ?, ?, ?)`);
const historyEarning = db.prepare('INSERT INTO earning (id, chore_id, household_id, child_id, amount_cents, created_at) VALUES (?, ?, ?, ?, ?, ?)');
for (let index = 1; index <= 60; index++) {
  const id = `history-completed-${String(index).padStart(3, '0')}`;
  const stamp = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
  historyChore.run(id, historyKid.user.id, `History completed ${String(index).padStart(3, '0')}`, '2025-06-01', 100, 'verified', stamp, stamp);
  historyEarning.run(`history-earning-${String(index).padStart(3, '0')}`, id, 'synthetic-history-household', historyKid.user.id, 100, stamp);
}
for (let index = 1; index <= 3; index++) historyChore.run(`history-pending-${index}`, historyKid.user.id, `History pending ${index}`, '2020-01-01', 100, 'pending_verification', seededAt, seededAt);
for (let index = 1; index <= 4; index++) historyChore.run(`history-overdue-${index}`, historyKid.user.id, `History overdue ${index}`, '2020-01-01', 50, 'todo', seededAt, seededAt);
historyChore.run('history-sibling-private', historySibling.user.id, 'History sibling private chore', '2025-06-01', 999, 'verified', seededAt, seededAt);
historyEarning.run('history-sibling-earning', 'history-sibling-private', 'synthetic-history-household', historySibling.user.id, 999, seededAt);
const historyPayout = db.prepare('INSERT INTO payout (id, household_id, child_id, actor_id, amount_cents, paid_date, note, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
for (let index = 0; index < 25; index++) {
  historyPayout.run(`history-payout-${String(index).padStart(2, '0')}`, 'synthetic-history-household', historyKid.user.id, historyParent.user.id, 100, `2024-01-${String(index + 1).padStart(2, '0')}`, index === 2 ? 'Synthetic older payment' : `Synthetic payment ${index + 1}`, `history-request-${index}`, new Date(Date.UTC(2024, 0, 1, 0, 0, index)).toISOString());
}
db.prepare("INSERT INTO payout_reversal (id, payout_id, actor_id, reason, created_at) VALUES ('history-reversal', 'history-payout-00', ?, 'Synthetic older correction', '2024-02-01T00:00:00.000Z')").run(historyParent.user.id);
historyPayout.run('history-sibling-payout', 'synthetic-history-household', historySibling.user.id, historyParent.user.id, 500, '2024-01-01', 'Sibling private payment', 'history-sibling-request', '2024-01-01T00:00:00.000Z');
// Verification inbox journeys: two parents, two children with pending work, and an empty child.
const verifyParent = await auth.api.signUpEmail({ body: { name: 'Verify Parent', email: 'verify-parent@example.test', password: 'synthetic-verify-parent-password' } });
const verifyParentTwo = await auth.api.signUpEmail({ body: { name: 'Verify Parent Two', email: 'verify-parent-two@example.test', password: 'synthetic-verify-parent-two-password' } });
const verifyKid = await auth.api.signUpEmail({ body: { name: 'Verification Kid', email: 'verify-kid@example.test', password: 'synthetic-verify-kid-password' } });
const verifySibling = await auth.api.signUpEmail({ body: { name: 'Verification Sibling', email: 'verify-sibling@example.test', password: 'synthetic-verify-sibling-password' } });
const verifyEmpty = await auth.api.signUpEmail({ body: { name: 'Verification Empty', email: 'verify-empty@example.test', password: 'synthetic-verify-empty-password' } });
db.prepare('INSERT INTO household (id, name) VALUES (?, ?)').run('synthetic-verify-household', 'Verification household');
for (const [userId, role] of [[verifyParent.user.id, 'parent'], [verifyParentTwo.user.id, 'parent'], [verifyKid.user.id, 'kid'], [verifySibling.user.id, 'kid'], [verifyEmpty.user.id, 'kid']] as const) {
  db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(userId, 'synthetic-verify-household', role);
}
const verifyChore = db.prepare(`INSERT INTO chore (id, household_id, assignee_id, title, due_date, reward_cents, status, created_at, updated_at)
  VALUES (?, 'synthetic-verify-household', ?, ?, '2026-11-01', ?, 'pending_verification', ?, ?)`);
const verifyTransition = db.prepare("INSERT INTO chore_transition (chore_id, actor_id, from_status, to_status, created_at) VALUES (?, ?, 'todo', 'pending_verification', ?)");
for (let index = 1; index <= 15; index++) {
  const id = `verify-kid-${String(index).padStart(2, '0')}`;
  const day = index <= 5 ? 1 : index <= 10 ? 2 : 3;
  const stamp = new Date(Date.UTC(2026, 10, day, 9, index)).toISOString();
  verifyChore.run(id, verifyKid.user.id, `Verification kid ${String(index).padStart(2, '0')}`, 200, stamp, stamp);
  verifyTransition.run(id, verifyKid.user.id, stamp);
}
for (let index = 1; index <= 10; index++) {
  const id = `verify-sibling-${String(index).padStart(2, '0')}`;
  const day = index <= 5 ? 4 : 5;
  const stamp = new Date(Date.UTC(2026, 10, day, 8, index)).toISOString();
  verifyChore.run(id, verifySibling.user.id, `Verification sibling ${String(index).padStart(2, '0')}`, 100, stamp, stamp);
  verifyTransition.run(id, verifySibling.user.id, stamp);
}
// Kid My Day journeys: one child has work in every section; a sibling owns private financial data.
const dayParent = await auth.api.signUpEmail({ body: { name: 'Day Parent', email: 'day-parent@example.test', password: 'synthetic-day-parent-password' } });
const dayKid = await auth.api.signUpEmail({ body: { name: 'Day Kid', email: 'day-kid@example.test', password: 'synthetic-day-kid-password' } });
const daySibling = await auth.api.signUpEmail({ body: { name: 'Day Sibling', email: 'day-sibling@example.test', password: 'synthetic-day-sibling-password' } });
const dayEmptyKid = await auth.api.signUpEmail({ body: { name: 'Day Empty Kid', email: 'day-empty-kid@example.test', password: 'synthetic-day-empty-kid-password' } });
db.prepare('INSERT INTO household (id, name) VALUES (?, ?)').run('synthetic-day-household', 'Day household');
for (const [userId, role] of [[dayParent.user.id, 'parent'], [dayKid.user.id, 'kid'], [daySibling.user.id, 'kid'], [dayEmptyKid.user.id, 'kid']] as const) {
  db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(userId, 'synthetic-day-household', role);
}
const dayToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const dayOffset = (days: number) => new Date(Date.parse(dayToday + 'T00:00:00Z') + days * 86_400_000).toISOString().slice(0, 10);
const dayChore = db.prepare(`INSERT INTO chore (id, household_id, assignee_id, title, due_date, reward_cents, status, rework_reason, created_at, updated_at)
  VALUES (?, 'synthetic-day-household', ?, ?, ?, ?, ?, ?, ?, ?)`);
const dayEarning = db.prepare('INSERT INTO earning (id, chore_id, household_id, child_id, amount_cents, created_at) VALUES (?, ?, ?, ?, ?, ?)');
for (let index = 1; index <= 3; index++) dayChore.run(`day-today-${index}`, dayKid.user.id, `Day today ${index}`, dayToday, 200, 'todo', null, seededAt, seededAt);
for (let index = 1; index <= 2; index++) dayChore.run(`day-overdue-${index}`, dayKid.user.id, `Day overdue ${index}`, dayOffset(-index - 1), 100, 'todo', null, seededAt, seededAt);
dayChore.run('day-rework-one', dayKid.user.id, 'Day rework one', dayOffset(-1), 200, 'needs_rework', 'Please put the books back neatly', seededAt, seededAt);
for (let index = 1; index <= 2; index++) {
  dayChore.run(`day-pending-${index}`, dayKid.user.id, `Day pending ${index}`, dayOffset(-1), 150, 'pending_verification', null, seededAt, seededAt);
  db.prepare("INSERT INTO chore_transition (chore_id, actor_id, from_status, to_status, created_at) VALUES (?, ?, 'todo', 'pending_verification', ?)").run(`day-pending-${index}`, dayKid.user.id, seededAt);
}
dayChore.run('day-upcoming-one', dayKid.user.id, 'Day upcoming one', dayOffset(2), 200, 'todo', null, seededAt, seededAt);
dayChore.run('day-later-one', dayKid.user.id, 'Day later one', dayOffset(60), 200, 'todo', null, seededAt, seededAt);
for (let index = 1; index <= 2; index++) {
  dayChore.run(`day-verified-${index}`, dayKid.user.id, `Day verified ${index}`, dayOffset(-2), 250, 'verified', null, seededAt, seededAt);
  dayEarning.run(`day-earning-${index}`, `day-verified-${index}`, 'synthetic-day-household', dayKid.user.id, 250, seededAt);
}
dayChore.run('day-sibling-secret', daySibling.user.id, 'Day sibling secret chore', dayOffset(-1), 999, 'verified', null, seededAt, seededAt);
dayEarning.run('day-sibling-earning', 'day-sibling-secret', 'synthetic-day-household', daySibling.user.id, 999, seededAt);
db.prepare('INSERT INTO payout (id, household_id, child_id, actor_id, amount_cents, paid_date, note, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
  .run('day-sibling-payout', 'synthetic-day-household', daySibling.user.id, dayParent.user.id, 500, dayOffset(-1), 'Day sibling secret payment', 'day-sibling-request', seededAt);
// Weekly chore board journeys: a populated household for display/filters and a separate
// empty household so the first-chore empty state stays meaningful.
const weekParent = await auth.api.signUpEmail({ body: { name: 'Week Parent', email: 'week-parent@example.test', password: 'synthetic-week-parent-password' } });
const weekParentTwo = await auth.api.signUpEmail({ body: { name: 'Week Parent Two', email: 'week-parent-two@example.test', password: 'synthetic-week-parent-two-password' } });
const weekKid = await auth.api.signUpEmail({ body: { name: 'Week Kid', email: 'week-kid@example.test', password: 'synthetic-week-kid-password' } });
const weekSibling = await auth.api.signUpEmail({ body: { name: 'Week Sibling', email: 'week-sibling@example.test', password: 'synthetic-week-sibling-password' } });
const weekEmptyParent = await auth.api.signUpEmail({ body: { name: 'Week Empty Parent', email: 'week-empty-parent@example.test', password: 'synthetic-week-empty-parent-password' } });
const weekEmptyKid = await auth.api.signUpEmail({ body: { name: 'Week Empty Kid', email: 'week-empty-kid@example.test', password: 'synthetic-week-empty-kid-password' } });
db.prepare('INSERT INTO household (id, name) VALUES (?, ?), (?, ?)').run('synthetic-chore-week-household', 'Chore week household', 'synthetic-chore-week-empty-household', 'Empty chore week household');
for (const [userId, householdId, role] of [
  [weekParent.user.id, 'synthetic-chore-week-household', 'parent'],
  [weekParentTwo.user.id, 'synthetic-chore-week-household', 'parent'],
  [weekKid.user.id, 'synthetic-chore-week-household', 'kid'],
  [weekSibling.user.id, 'synthetic-chore-week-household', 'kid'],
  [weekEmptyParent.user.id, 'synthetic-chore-week-empty-household', 'parent'],
  [weekEmptyKid.user.id, 'synthetic-chore-week-empty-household', 'kid']
] as const) {
  db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(userId, householdId, role);
}
const weekChore = db.prepare(`INSERT INTO chore (id, household_id, assignee_id, title, due_date, reward_cents, status, rework_reason, created_at, updated_at)
  VALUES (?, 'synthetic-chore-week-household', ?, ?, ?, ?, ?, ?, ?, ?)`);
weekChore.run('week-pending', weekKid.user.id, 'Week pending chore', '2099-03-02', 100, 'pending_verification', null, seededAt, seededAt);
weekChore.run('week-rework', weekKid.user.id, 'Week rework chore', '2099-03-02', 150, 'needs_rework', 'Please put the games away', seededAt, seededAt);
weekChore.run('week-verified', weekSibling.user.id, 'Week verified chore', '2099-03-03', 200, 'verified', null, seededAt, seededAt);
db.prepare('INSERT INTO earning (id, chore_id, household_id, child_id, amount_cents, created_at) VALUES (?, ?, ?, ?, ?, ?)')
  .run('week-verified-earning', 'week-verified', 'synthetic-chore-week-household', weekSibling.user.id, 200, seededAt);
// Edit/cancel journeys: an editable one-off, a recurring occurrence in a later week, and a
// second parent for the stale-edit conflict. These stay outside the first week's counts.
weekChore.run('week-hydration', weekKid.user.id, 'Week hydration chore', '2099-04-06', 250, 'todo', null, seededAt, seededAt);
db.prepare(`INSERT INTO recurring_series (id, household_id, creator_id, assignee_id, title, description, reward_cents, start_date, weekdays, state, created_at, updated_at)
  VALUES ('week-series', 'synthetic-chore-week-household', ?, ?, 'Week repeating chore', NULL, 175, '2099-03-09', '[1]', 'active', ?, ?)`).run(weekParent.user.id, weekKid.user.id, seededAt, seededAt);
weekChore.run('week-repeating', weekKid.user.id, 'Week repeating chore', '2099-03-09', 175, 'todo', null, seededAt, seededAt);
db.prepare("INSERT INTO recurring_occurrence (series_id, household_id, scheduled_date, chore_id) VALUES ('week-series', 'synthetic-chore-week-household', '2099-03-09', 'week-repeating')").run();
// Recurring schedule revision journeys: a dedicated household so preview, confirmation and
// stale-parent scenarios cannot disturb the weekly-board fixtures.
const scheduleParent = await auth.api.signUpEmail({ body: { name: 'Schedule Parent', email: 'schedule-parent@example.test', password: 'synthetic-schedule-parent-password' } });
const scheduleParentTwo = await auth.api.signUpEmail({ body: { name: 'Schedule Parent Two', email: 'schedule-parent-two@example.test', password: 'synthetic-schedule-parent-two-password' } });
const scheduleKid = await auth.api.signUpEmail({ body: { name: 'Schedule Kid', email: 'schedule-kid@example.test', password: 'synthetic-schedule-kid-password' } });
db.prepare('INSERT INTO household (id, name) VALUES (?, ?)').run('synthetic-schedule-household', 'Schedule household');
for (const [userId, role] of [[scheduleParent.user.id, 'parent'], [scheduleParentTwo.user.id, 'parent'], [scheduleKid.user.id, 'kid']] as const) {
  db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(userId, 'synthetic-schedule-household', role);
}
const scheduleSeries = db.prepare(`INSERT INTO recurring_series (id, household_id, creator_id, assignee_id, title, description, reward_cents, start_date, weekdays, state, created_at, updated_at)
  VALUES (?, 'synthetic-schedule-household', ?, ?, ?, ?, 175, ?, ?, ?, ?, ?)`);
scheduleSeries.run('sched-series', scheduleParent.user.id, scheduleKid.user.id, 'Schedule trash', 'Kitchen and curb', '2099-03-01', '[1,3]', 'active', seededAt, seededAt);
scheduleSeries.run('sched-recovery', scheduleParent.user.id, scheduleKid.user.id, 'Schedule recovery', 'Keep schedule description', '2099-04-01', '[1]', 'active', seededAt, seededAt);
scheduleSeries.run('sched-stale', scheduleParent.user.id, scheduleKid.user.id, 'Schedule stale base', null, '2099-05-01', '[1]', 'active', seededAt, seededAt);
scheduleSeries.run('sched-native', scheduleParent.user.id, scheduleKid.user.id, 'Schedule native', null, '2099-06-01', '[1]', 'active', seededAt, seededAt);
scheduleSeries.run('sched-hydration', scheduleParent.user.id, scheduleKid.user.id, 'Schedule hydration', 'Hydration description', '2099-07-06', '[1]', 'active', seededAt, seededAt);
scheduleSeries.run('sched-paused', scheduleParent.user.id, scheduleKid.user.id, 'Schedule paused', null, '2099-08-01', '[1]', 'paused', seededAt, seededAt);
scheduleSeries.run('sched-ended', scheduleParent.user.id, scheduleKid.user.id, 'Schedule ended', null, '2099-09-01', '[1]', 'ended', seededAt, seededAt);
const scheduleChore = db.prepare(`INSERT INTO chore (id, household_id, assignee_id, title, due_date, reward_cents, status, created_at, updated_at)
  VALUES (?, 'synthetic-schedule-household', ?, ?, ?, ?, ?, ?, ?)`);
const scheduleOccurrence = db.prepare("INSERT INTO recurring_occurrence (series_id, household_id, scheduled_date, chore_id) VALUES ('sched-series', 'synthetic-schedule-household', ?, ?)");
scheduleChore.run('sched-old-mon', scheduleKid.user.id, 'Schedule trash', '2099-03-02', 175, 'todo', seededAt, seededAt);
scheduleOccurrence.run('2099-03-02', 'sched-old-mon');
scheduleChore.run('sched-old-wed', scheduleKid.user.id, 'Schedule trash', '2099-03-04', 175, 'pending_verification', seededAt, seededAt);
scheduleOccurrence.run('2099-03-04', 'sched-old-wed');
scheduleChore.run('sched-verified', scheduleKid.user.id, 'Schedule completed', '2099-02-25', 300, 'verified', seededAt, seededAt);
db.prepare("INSERT INTO earning (id, chore_id, household_id, child_id, amount_cents, created_at) VALUES ('sched-verified-earning', 'sched-verified', 'synthetic-schedule-household', ?, 300, ?)").run(scheduleKid.user.id, seededAt);
// Reuse journeys use per-test households from the seeding service (e2e/support/households.ts).
db.close();
// Per-test isolated households for specs that must be repeatable (e2e/support/households.ts).
const seedServer = startSeedServer(config);
const mockRecipeFetch = fileURLToPath(new URL('./mock-recipe-fetch.cjs', import.meta.url));
const nodeOptions = [process.env.NODE_OPTIONS, '--require', mockRecipeFetch].filter(Boolean).join(' ');
const app = appCommand(4173, config.origin, 'main');
const child = spawn(app.command, app.args, {
  // Keep browser tests deterministic and offline: they never contact NWS, eMeals or use private coordinates.
  stdio: 'inherit', env: { ...process.env, ...app.env, DATABASE_PATH: config.dbPath, AUTH_SECRET: config.secret, AUTH_ORIGIN: config.origin, WEATHER_LATITUDE: '', WEATHER_LONGITUDE: '', E2E_RECIPE_FIXTURE: '1', NODE_OPTIONS: nodeOptions }
});
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => { seedServer.close(); rmSync(directory, { recursive: true, force: true }); process.exit(code ?? 1); });
child.on('error', () => { seedServer.close(); rmSync(directory, { recursive: true, force: true }); process.exit(1); });
