import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAuth, migrate, authorizeRequest, parentAction } from '../src/lib/server/identity';
import { createInvitation, listHouseholdAccess, redeemInvitation } from '../src/lib/server/invitations';
import { MemberDisableError, activeMembership, disableMember, primaryActiveMembership } from '../src/lib/server/household-access';
import { addGrocery, listGroceries } from '../src/lib/server/groceries';
import { changeChore, createChore } from '../src/lib/server/chores';
import { createSeries } from '../src/lib/server/recurring';
import { balance, recordPayout, setPayday } from '../src/lib/server/payouts';
import { displayData } from '../src/lib/server/display';

const secret = 'synthetic-member-disable-secret-over-32-characters';
const origin = 'http://localhost:3000';
const config = { secret, origin };
const dbs: Database.Database[] = [];
const dirs: string[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const post = (path: string, body: unknown) => new Request(`${origin}/api/auth/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) });

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'hub-disable-test-')); dirs.push(dir);
  const path = join(dir, 'synthetic.sqlite');
  const db = new Database(path); dbs.push(db);
  db.pragma('foreign_keys = ON');
  await migrate(db);
  const auth = createAuth(db, { ...config, allowSignUp: true });
  const make = async (name: string) => (await auth.api.signUpEmail({ body: { name, email: `${name.toLowerCase().replace(' ', '-')}@example.test`, password: 'synthetic-password-123' } })).user.id;
  const [parentA, parentB, kid, kid2, outsider] = [await make('Parent A'), await make('Parent B'), await make('Kid One'), await make('Kid Two'), await make('Outsider')];
  db.prepare('INSERT INTO household (id, name) VALUES (?, ?), (?, ?)').run('house-a', 'Example', 'house-b', 'Other');
  const add = db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)');
  add.run(parentA, 'house-a', 'parent'); add.run(parentB, 'house-a', 'parent'); add.run(kid, 'house-a', 'kid'); add.run(kid2, 'house-a', 'kid');
  add.run(outsider, 'house-b', 'parent'); add.run(kid, 'house-b', 'kid');
  const signedIn = async (email: string) => {
    const response = await auth.handler(post('sign-in/email', { email, password: 'synthetic-password-123' }));
    return new Headers({ cookie: response.headers.get('set-cookie')!.split(';')[0], origin });
  };
  return { db, path, auth, parentA, parentB, kid, kid2, outsider, signedIn };
}

describe('member disabling', () => {
  it('lets a parent disable a child, recording actor and time, and keeps the account', async () => {
    const f = await fixture();
    expect(disableMember(f.db, f.parentA, 'house-a', f.kid)).toEqual({ changed: true });
    expect(f.db.prepare('SELECT disabled_by AS by, disabled_at IS NOT NULL AS at FROM membership WHERE user_id = ? AND household_id = ?').get(f.kid, 'house-a')).toEqual({ by: f.parentA, at: 1 });
    expect(f.db.prepare('SELECT count(*) AS n FROM user WHERE id = ?').get(f.kid)).toEqual({ n: 1 });
    expect(activeMembership(f.db, f.kid, 'house-a')).toBeNull();
  });

  it('rejects a child, an unrelated household parent, an outsider target and self-disable', async () => {
    const f = await fixture();
    expect(() => disableMember(f.db, f.kid, 'house-a', f.kid2)).toThrow(MemberDisableError);
    expect(() => disableMember(f.db, f.outsider, 'house-a', f.kid)).toThrow(MemberDisableError);
    expect(() => disableMember(f.db, f.parentA, 'house-a', f.outsider)).toThrow(MemberDisableError);
    expect(() => disableMember(f.db, f.parentA, 'house-a', f.parentA)).toThrow(expect.objectContaining({ code: 'self' }));
    expect(f.db.prepare('SELECT count(*) AS n FROM membership WHERE disabled_at IS NOT NULL').get()).toEqual({ n: 0 });
  });

  it('is predictable when repeated and never changes the original audit record', async () => {
    const f = await fixture();
    disableMember(f.db, f.parentA, 'house-a', f.kid);
    const first = f.db.prepare('SELECT disabled_at, disabled_by FROM membership WHERE user_id = ? AND household_id = ?').get(f.kid, 'house-a');
    expect(disableMember(f.db, f.parentB, 'house-a', f.kid)).toEqual({ changed: false });
    expect(f.db.prepare('SELECT disabled_at, disabled_by FROM membership WHERE user_id = ? AND household_id = ?').get(f.kid, 'house-a')).toEqual(first);
  });

  it('protects the last active parent and, serialized across connections, keeps one when two parents race', async () => {
    const f = await fixture();
    const other = new Database(f.path); dbs.push(other); other.pragma('foreign_keys = ON');
    expect(disableMember(f.db, f.parentA, 'house-a', f.parentB)).toEqual({ changed: true });
    // B's session is still valid, but B is no longer an active parent, so the reverse request fails.
    expect(() => disableMember(other, f.parentB, 'house-a', f.parentA)).toThrow(MemberDisableError);
    expect(f.db.prepare("SELECT count(*) AS n FROM active_membership WHERE household_id = 'house-a' AND role = 'parent'").get()).toEqual({ n: 1 });
  });

  it('enforces the last-parent invariant in the database even for direct writes', async () => {
    const f = await fixture();
    disableMember(f.db, f.parentA, 'house-a', f.parentB);
    expect(() => f.db.prepare("UPDATE membership SET disabled_at = 1, disabled_by = ? WHERE user_id = ? AND household_id = 'house-a'").run(f.kid, f.parentA)).toThrow(/active parent/);
    expect(() => f.db.prepare("UPDATE membership SET disabled_at = 1 WHERE user_id = ? AND household_id = 'house-a'").run(f.kid)).toThrow(/another member/);
  });

  it('does not change roles or other households', async () => {
    const f = await fixture();
    disableMember(f.db, f.parentA, 'house-a', f.kid);
    expect(f.db.prepare('SELECT role FROM membership WHERE user_id = ? AND household_id = ?').get(f.kid, 'house-a')).toEqual({ role: 'kid' });
    expect(activeMembership(f.db, f.kid, 'house-b')).toEqual({ householdId: 'house-b', role: 'kid' });
    expect(primaryActiveMembership(f.db, f.kid)).toEqual({ householdId: 'house-b', role: 'kid' });
  });

  it('rolls back cleanly when a later step fails', async () => {
    const f = await fixture();
    f.db.exec("CREATE TRIGGER fail_revoke BEFORE UPDATE OF revoked_at ON household_invitation BEGIN SELECT RAISE(ABORT, 'injected'); END");
    createInvitation(f.db, f.kid2 === '' ? f.parentB : f.parentB, 'house-a', 'kid');
    expect(() => disableMember(f.db, f.parentA, 'house-a', f.parentB)).toThrow('injected');
    expect(activeMembership(f.db, f.parentB, 'house-a')?.role).toBe('parent');
    expect(f.db.prepare('SELECT count(*) AS n FROM membership WHERE disabled_at IS NOT NULL').get()).toEqual({ n: 0 });
  });
});

describe('revocation is enforced for an already-authenticated session', () => {
  it('blocks every household read and mutation with a still-valid real session, while other households stay valid', async () => {
    const f = await fixture();
    const headers = await f.signedIn('kid-one@example.test');
    expect(await f.auth.api.getSession({ headers })).not.toBeNull();
    expect(await authorizeRequest(f.auth, f.db, headers, 'house-a', 'read')).toBe(true);
    disableMember(f.db, f.parentA, 'house-a', f.kid);
    expect(await f.auth.api.getSession({ headers })).not.toBeNull(); // the global session is untouched
    expect(await authorizeRequest(f.auth, f.db, headers, 'house-a', 'read')).toBe(false);
    expect((await parentAction(f.auth, f.db, new Request(origin, { headers }), 'house-a', origin)).status).toBe(403);
    expect(() => listGroceries(f.db, f.kid, 'house-a')).toThrow();
    expect(() => addGrocery(f.db, f.kid, 'house-a', { name: 'milk', quantity: '', unit: '' })).toThrow();
    expect(() => displayData(f.db, f.kid, 'house-a', '2026-01-01', '2026-01-08')).toThrow();
    expect(await authorizeRequest(f.auth, f.db, headers, 'house-b', 'read')).toBe(true);
  });

  it('blocks a disabled parent from every administrative action', async () => {
    const f = await fixture();
    const choreId = createChore(f.db, f.parentA, 'house-a', { title: 'Dishes', assigneeId: f.kid, dueDate: '2026-01-01', rewardCents: 300 });
    changeChore(f.db, f.kid, 'house-a', choreId, 'submit');
    disableMember(f.db, f.parentA, 'house-a', f.parentB);
    expect(() => createInvitation(f.db, f.parentB, 'house-a', 'kid')).toThrow();
    expect(() => listHouseholdAccess(f.db, f.parentB, 'house-a')).toThrow();
    expect(() => changeChore(f.db, f.parentB, 'house-a', choreId, 'verify')).toThrow();
    expect(() => createChore(f.db, f.parentB, 'house-a', { title: 'X', assigneeId: f.kid, dueDate: '2026-01-01' })).toThrow();
    expect(() => createSeries(f.db, f.parentB, 'house-a', { title: 'X', assigneeId: f.kid } as never)).toThrow();
    expect(() => setPayday(f.db, f.parentB, 'house-a', '2026-01-01', 7)).toThrow();
    expect(() => recordPayout(f.db, f.parentB, 'house-a', { childId: f.kid, amountCents: 1, date: '2026-01-01', note: '', requestId: 'r1' })).toThrow();
    expect(() => disableMember(f.db, f.parentB, 'house-a', f.kid)).toThrow(MemberDisableError);
  });

});

describe('invitations from a disabled issuer', () => {
  it('revokes outstanding links and rejects redemption even if the revocation were bypassed', async () => {
    const f = await fixture();
    const token = createInvitation(f.db, f.parentB, 'house-a', 'kid');
    disableMember(f.db, f.parentA, 'house-a', f.parentB);
    expect(f.db.prepare('SELECT revoked_at IS NOT NULL AS revoked FROM household_invitation').get()).toEqual({ revoked: 1 });
    await expect(redeemInvitation(f.db, config, token, { name: 'Late', email: 'late@example.test', password: 'synthetic-password-123' })).rejects.toThrow();
    f.db.exec('UPDATE household_invitation SET revoked_at = NULL');
    await expect(redeemInvitation(f.db, config, token, { name: 'Late', email: 'late@example.test', password: 'synthetic-password-123' })).rejects.toThrow();
    expect(f.db.prepare("SELECT count(*) AS n FROM user WHERE email = 'late@example.test'").get()).toEqual({ n: 0 });
  });

  it('does not link or re-enable an existing disabled account through a new invitation', async () => {
    const f = await fixture();
    disableMember(f.db, f.parentA, 'house-a', f.kid);
    const token = createInvitation(f.db, f.parentA, 'house-a', 'kid');
    await expect(redeemInvitation(f.db, config, token, { name: 'Kid One', email: 'kid-one@example.test', password: 'synthetic-password-123' })).rejects.toThrow();
    expect(activeMembership(f.db, f.kid, 'house-a')).toBeNull();
  });
});

describe('history is preserved', () => {
  it('keeps chores, transitions, earnings, payouts and balances unchanged', async () => {
    const f = await fixture();
    const choreId = createChore(f.db, f.parentA, 'house-a', { title: 'Dishes', assigneeId: f.kid, dueDate: '2026-01-01', rewardCents: 500 });
    changeChore(f.db, f.kid, 'house-a', choreId, 'submit');
    const pendingChore = createChore(f.db, f.parentA, 'house-a', { title: 'Pending', assigneeId: f.kid, dueDate: '2026-01-02', rewardCents: 200 });
    changeChore(f.db, f.kid, 'house-a', pendingChore, 'submit');
    changeChore(f.db, f.parentA, 'house-a', choreId, 'verify');
    recordPayout(f.db, f.parentA, 'house-a', { childId: f.kid, amountCents: 100, date: '2026-01-03', note: '', requestId: 'r1' });
    const snapshot = () => JSON.stringify(['chore', 'chore_transition', 'earning', 'payout'].map((t) => f.db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all()));
    const before = snapshot();
    disableMember(f.db, f.parentA, 'house-a', f.kid);
    disableMember(f.db, f.parentB, 'house-a', f.parentA);
    expect(snapshot()).toBe(before);
    expect(balance(f.db, 'house-a', f.kid)).toEqual({ earned: 500, paid: 100, owed: 400 });
    expect(f.db.prepare('SELECT actor_id FROM chore_transition WHERE chore_id = ? ORDER BY id').all(choreId).map((r) => (r as { actor_id: string }).actor_id)).toContain(f.parentA);
    expect(listHouseholdAccess(f.db, f.parentB, 'house-a').members.map((m) => [m.id, m.disabledAt !== null])).toEqual(expect.arrayContaining([[f.kid, true], [f.parentA, true]]));
  });
});

describe('migration and recovery', () => {
  it('preserves existing members as active and disabled state across backup and restore', async () => {
    const f = await fixture();
    expect(f.db.prepare('SELECT count(*) AS n FROM active_membership').get()).toEqual({ n: 6 });
    disableMember(f.db, f.parentA, 'house-a', f.kid);
    f.db.pragma('wal_checkpoint(TRUNCATE)');
    const restoredPath = join(dirs[0], 'restored.sqlite');
    await f.db.backup(restoredPath);
    const restored = new Database(restoredPath); dbs.push(restored); restored.pragma('foreign_keys = ON');
    await migrate(restored);
    expect(activeMembership(restored, f.kid, 'house-a')).toBeNull();
    expect(activeMembership(restored, f.parentB, 'house-a')?.role).toBe('parent');
    expect(restored.pragma('integrity_check', { simple: true })).toBe('ok');
    void copyFileSync;
  });
});
