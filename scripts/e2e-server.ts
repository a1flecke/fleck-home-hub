import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { bootstrap } from '../src/lib/server/bootstrap';
import { createAuth } from '../src/lib/server/identity';

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
// Shopping journeys: one isolated household per scenario so list-wide counts and bulk
// clears are independent of every other grocery test.
for (const fixture of [
  { key: 'a', name: 'Grocery Parent A', role: 'parent' },
  { key: 'c', name: 'Grocery Parent C', role: 'parent' },
  { key: 'd', name: 'Grocery Parent D', role: 'parent' },
  { key: 'e', name: 'Grocery Parent E', role: 'parent' },
  { key: 'f', name: 'Grocery Parent F', role: 'parent' },
  { key: 'kid', name: 'Grocery Kid', role: 'kid' }
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
db.close();
const mockRecipeFetch = fileURLToPath(new URL('./mock-recipe-fetch.cjs', import.meta.url));
const nodeOptions = [process.env.NODE_OPTIONS, '--require', mockRecipeFetch].filter(Boolean).join(' ');
const child = spawn('pnpm', ['exec', 'vite', 'dev', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], {
  // Keep browser tests deterministic and offline: they never contact NWS, eMeals or use private coordinates.
  stdio: 'inherit', env: { ...process.env, DATABASE_PATH: config.dbPath, AUTH_SECRET: config.secret, AUTH_ORIGIN: config.origin, WEATHER_LATITUDE: '', WEATHER_LONGITUDE: '', E2E_RECIPE_FIXTURE: '1', NODE_OPTIONS: nodeOptions }
});
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => { rmSync(directory, { recursive: true, force: true }); process.exit(code ?? 1); });
child.on('error', () => { rmSync(directory, { recursive: true, force: true }); process.exit(1); });
