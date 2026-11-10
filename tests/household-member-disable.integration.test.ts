import { createPairing, redeemPairing, verifyDisplayCredential } from '../src/lib/server/display-pairing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Worker, WorkerOptions } from 'node:worker_threads';
import Database from 'better-sqlite3';
import { betterAuth } from 'better-auth';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAuth, migrate, authorizeRequest, parentAction } from '../src/lib/server/identity';
import { createInvitation, listHouseholdAccess, redeemInvitation } from '../src/lib/server/invitations';
import { MemberDisableError, activeMembership, disableMember, primaryActiveMembership } from '../src/lib/server/household-access';
import { addGrocery, changeGrocery, listGroceries, removeGrocery } from '../src/lib/server/groceries';
import { changeChore, createChore } from '../src/lib/server/chores';
import { createSeries, generateOccurrences, setHouseholdTimezone } from '../src/lib/server/recurring';
import { balance, recordPayout, setPayday } from '../src/lib/server/payouts';
import { displayData } from '../src/lib/server/display';
import { addUnscheduled, archiveUnscheduled, cancelEvent, createEvent, updateUnscheduled } from '../src/lib/server/calendar';
import { createMeal, updateMeal } from '../src/lib/server/meals';
import { backupDatabase } from '../src/lib/server/backup';

// Pause the real worker immediately before a SQLite boundary. No production
// hook is needed, and the worker still uses the real adapter and database.
const gates = vi.hoisted(() => ({
  next: undefined as { phase: 'BEGIN IMMEDIATE' | 'COMMIT'; state: Int32Array; worker?: Worker } | undefined
}));

vi.mock('node:worker_threads', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:worker_threads')>();
  return {
    ...actual,
    Worker: class extends actual.Worker {
      constructor(source: string, options?: WorkerOptions) {
        const gate = gates.next;
        if (!gate) { super(source, options); return; }
        const barrier = `
          {
            const { workerData: { barrier } } = require('node:worker_threads');
            const Database = require('better-sqlite3');
            const exec = Database.prototype.exec;
            Database.prototype.exec = function(sql) {
              if (sql === barrier.phase) {
                Atomics.store(barrier.state, 0, 1);
                Atomics.notify(barrier.state, 0);
                if (Atomics.wait(barrier.state, 1, 0, 10000) === 'timed-out') throw new Error('Test barrier timed out');
              }
              const result = exec.call(this, sql);
              if (sql === 'COMMIT') {
                Atomics.store(barrier.state, 2, 1);
                Atomics.notify(barrier.state, 2);
              }
              return result;
            };
          }
        `;
        super(barrier + source, { ...options, workerData: { ...options?.workerData, barrier: { phase: gate.phase, state: gate.state } } });
        gate.worker = this;
      }
    }
  };
});

function pauseWorker<T>(phase: NonNullable<typeof gates.next>['phase'], start: () => Promise<T>) {
  const state = new Int32Array(new SharedArrayBuffer(3 * Int32Array.BYTES_PER_ELEMENT));
  const gate: NonNullable<typeof gates.next> = { phase, state };
  gates.next = gate;
  let result: Promise<T>;
  try { result = start(); }
  finally { gates.next = undefined; }
  // Some tests deliberately fail or terminate a worker before awaiting the result.
  void result.catch(() => {});
  return {
    result,
    async reached() {
      await Atomics.waitAsync(state, 0, 0, 5000).value;
      expect(Atomics.load(state, 0), 'worker reached the selected SQLite boundary').toBe(1);
    },
    release() {
      Atomics.store(state, 1, 1);
      Atomics.notify(state, 1);
    },
    waitForCommit() {
      Atomics.wait(state, 2, 0, 5000);
      expect(Atomics.load(state, 2), 'worker committed before the competing write').toBe(1);
    },
    terminate: () => gate.worker!.terminate()
  };
}

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
    expect(await disableMember(f.db, config, f.parentA, 'house-a', f.kid)).toEqual({ changed: true });
    expect(f.db.prepare('SELECT disabled_by AS by, disabled_at IS NOT NULL AS at FROM membership WHERE user_id = ? AND household_id = ?').get(f.kid, 'house-a')).toEqual({ by: f.parentA, at: 1 });
    expect(f.db.prepare('SELECT count(*) AS n FROM user WHERE id = ?').get(f.kid)).toEqual({ n: 1 });
    expect(activeMembership(f.db, f.kid, 'house-a')).toBeNull();
  });

  it.each([
    ['a child actor', 'kid', 'kid2', 'not-authorized'],
    ['an unrelated household parent', 'outsider', 'kid', 'not-authorized'],
    ['an outsider target', 'parentA', 'outsider', 'unavailable'],
    ['self-disable', 'parentA', 'parentA', 'self']
  ] as const)('rejects %s without changing membership', async (_scenario, actor, target, code) => {
    const f = await fixture();
    await expect(disableMember(f.db, config, f[actor], 'house-a', f[target])).rejects.toThrow(expect.objectContaining({ code }));
    expect(f.db.prepare('SELECT count(*) AS n FROM membership WHERE disabled_at IS NOT NULL').get()).toEqual({ n: 0 });
  });

  it('is predictable when repeated and never changes the original audit record', async () => {
    const f = await fixture();
    await disableMember(f.db, config, f.parentA, 'house-a', f.kid);
    const first = f.db.prepare('SELECT disabled_at, disabled_by FROM membership WHERE user_id = ? AND household_id = ?').get(f.kid, 'house-a');
    expect(await disableMember(f.db, config, f.parentB, 'house-a', f.kid)).toEqual({ changed: false });
    expect(f.db.prepare('SELECT disabled_at, disabled_by FROM membership WHERE user_id = ? AND household_id = ?').get(f.kid, 'house-a')).toEqual(first);
  });

  it('keeps one active parent when two parents disable each other', async () => {
    const f = await fixture();
    const first = pauseWorker('COMMIT', () => disableMember(f.db, config, f.parentA, 'house-a', f.parentB));
    const second = pauseWorker('BEGIN IMMEDIATE', () => disableMember(f.db, config, f.parentB, 'house-a', f.parentA));
    try { await Promise.all([first.reached(), second.reached()]); }
    finally { second.release(); first.release(); }
    const [winner, loser] = await Promise.allSettled([first.result, second.result]);
    expect(winner).toEqual({ status: 'fulfilled', value: { changed: true } });
    expect(loser).toMatchObject({ status: 'rejected', reason: { code: 'not-authorized' } });
    expect(f.db.prepare("SELECT user_id AS id FROM active_membership WHERE household_id = 'house-a' AND role = 'parent'").all()).toEqual([{ id: f.parentA }]);
  }, 15000);

  it('enforces the last-parent invariant in the database even for direct writes', async () => {
    const f = await fixture();
    await disableMember(f.db, config, f.parentA, 'house-a', f.parentB);
    expect(() => f.db.prepare("UPDATE membership SET disabled_at = 1, disabled_by = ? WHERE user_id = ? AND household_id = 'house-a'").run(f.kid, f.parentA)).toThrow(/active parent/);
    expect(() => f.db.prepare("UPDATE membership SET disabled_at = 1 WHERE user_id = ? AND household_id = 'house-a'").run(f.kid)).toThrow(/another member/);
  });

  it('does not change roles or other households', async () => {
    const f = await fixture();
    await disableMember(f.db, config, f.parentA, 'house-a', f.kid);
    expect(f.db.prepare('SELECT role FROM membership WHERE user_id = ? AND household_id = ?').get(f.kid, 'house-a')).toEqual({ role: 'kid' });
    expect(activeMembership(f.db, f.kid, 'house-b')).toEqual({ householdId: 'house-b', role: 'kid' });
    expect(primaryActiveMembership(f.db, f.kid)).toEqual({ householdId: 'house-b', role: 'kid' });
  });
});

describe('revocation is enforced for an already-authenticated session', () => {
  it('revokes existing sessions when a member loses their final household', async () => {
    const f = await fixture();
    const headers = await f.signedIn('kid-two@example.test');
    const secondDevice = await f.signedIn('kid-two@example.test');
    expect(Boolean(await f.auth.api.getSession({ headers }))).toBe(true);
    expect(Boolean(await f.auth.api.getSession({ headers: secondDevice }))).toBe(true);
    await disableMember(f.db, config, f.parentA, 'house-a', f.kid2);
    expect(Boolean(await f.auth.api.getSession({ headers }))).toBe(false);
    expect(Boolean(await f.auth.api.getSession({ headers: secondDevice }))).toBe(false);
    const next = await f.signedIn('kid-two@example.test');
    expect(await authorizeRequest(f.auth, f.db, next, 'house-a', 'read')).toBe(false);
  });

  it.each([
    ['membership', 'UPDATE OF disabled_at'],
    ['household_invitation', 'UPDATE OF revoked_at'],
    ['display_pairing', 'UPDATE OF revoked_at'],
    ['display_device', 'UPDATE OF revoked_at'],
    ['session', 'DELETE']
  ])('rolls back all access state when writing %s fails', async (table, operation) => {
    const f = await fixture();
    const headers = await f.signedIn('parent-b@example.test');
    createInvitation(f.db, f.parentB, 'house-a', 'kid');
    createPairing(f.db, f.parentB, 'house-a', 'Spare display');
    const device = redeemPairing(f.db, createPairing(f.db, f.parentB, 'house-a', 'Kitchen').secret);
    const snapshot = () => ({
      memberships: f.db.prepare('SELECT * FROM membership ORDER BY user_id, household_id').all(),
      invitations: f.db.prepare('SELECT id, consumed_at, revoked_at FROM household_invitation ORDER BY id').all(),
      pairings: f.db.prepare('SELECT id, consumed_at, revoked_at FROM display_pairing ORDER BY id').all(),
      devices: f.db.prepare('SELECT id, revoked_at, revoked_by FROM display_device ORDER BY id').all(),
      sessions: f.db.prepare('SELECT id, userId FROM session ORDER BY id').all()
    });
    const before = snapshot();
    f.db.exec(`CREATE TRIGGER fail_disable_write AFTER ${operation} ON ${table} BEGIN SELECT RAISE(ABORT, 'injected'); END`);
    await expect(disableMember(f.db, config, f.parentA, 'house-a', f.parentB)).rejects.toThrow('Member access could not be disabled');
    expect(snapshot()).toEqual(before);
    expect(Boolean(verifyDisplayCredential(f.db, device.token))).toBe(true);
    expect(Boolean(await f.auth.api.getSession({ headers }))).toBe(true);

    f.db.exec('DROP TRIGGER fail_disable_write');
    expect(await disableMember(f.db, config, f.parentA, 'house-a', f.parentB)).toEqual({ changed: true });
    expect(listHouseholdAccess(f.db, f.parentA, 'house-a').invitations).toHaveLength(0);
    expect(Boolean(verifyDisplayCredential(f.db, device.token))).toBe(false);
    expect(Boolean(await f.auth.api.getSession({ headers }))).toBe(false);
    expect(f.db.pragma('foreign_key_check')).toEqual([]);
  });

  it('blocks every household read and mutation with a still-valid real session, while other households stay valid', async () => {
    const f = await fixture();
    const headers = await f.signedIn('kid-one@example.test');
    expect(Boolean(await f.auth.api.getSession({ headers }))).toBe(true);
    expect(await authorizeRequest(f.auth, f.db, headers, 'house-a', 'read')).toBe(true);
    await disableMember(f.db, config, f.parentA, 'house-a', f.kid);
    expect(Boolean(await f.auth.api.getSession({ headers }))).toBe(true); // the global session is untouched
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
    await disableMember(f.db, config, f.parentA, 'house-a', f.parentB);
    expect(() => createInvitation(f.db, f.parentB, 'house-a', 'kid')).toThrow();
    expect(() => listHouseholdAccess(f.db, f.parentB, 'house-a')).toThrow();
    expect(() => changeChore(f.db, f.parentB, 'house-a', choreId, 'verify')).toThrow();
    expect(() => createChore(f.db, f.parentB, 'house-a', { title: 'X', assigneeId: f.kid, dueDate: '2026-01-01' })).toThrow();
    expect(() => createSeries(f.db, f.parentB, 'house-a', { title: 'X', assigneeId: f.kid, startDate: '2026-01-01', weekdays: [4] })).toThrow();
    expect(() => setPayday(f.db, f.parentB, 'house-a', '2026-01-01', 7)).toThrow();
    expect(() => recordPayout(f.db, f.parentB, 'house-a', { childId: f.kid, amountCents: 1, date: '2026-01-01', note: '', requestId: 'r1' })).toThrow();
    await expect(disableMember(f.db, config, f.parentB, 'house-a', f.kid)).rejects.toThrow(MemberDisableError);
  });

});

describe('invitations from a disabled issuer', () => {
  it('revokes outstanding links and rejects redemption even if the revocation were bypassed', async () => {
    const f = await fixture();
    const token = createInvitation(f.db, f.parentB, 'house-a', 'kid');
    await disableMember(f.db, config, f.parentA, 'house-a', f.parentB);
    expect(f.db.prepare('SELECT revoked_at IS NOT NULL AS revoked FROM household_invitation').get()).toEqual({ revoked: 1 });
    await expect(redeemInvitation(f.db, config, token, { name: 'Late', email: 'late@example.test', password: 'synthetic-password-123' })).rejects.toThrow();
    f.db.exec('UPDATE household_invitation SET revoked_at = NULL');
    await expect(redeemInvitation(f.db, config, token, { name: 'Late', email: 'late@example.test', password: 'synthetic-password-123' })).rejects.toThrow();
    expect(f.db.prepare("SELECT count(*) AS n FROM user WHERE email = 'late@example.test'").get()).toEqual({ n: 0 });
  });

  it('lets disabling the pairing parent win over a display redeeming that parent\'s code at the same time', async () => {
    const f = await fixture();
    const pairing = createPairing(f.db, f.parentB, 'house-a', 'Racing display');
    const other = createPairing(f.db, f.outsider, 'house-b', 'Other household display');
    const display = new Database(f.path); dbs.push(display);
    display.pragma('foreign_keys = ON'); display.pragma('busy_timeout = 0');
    const disabling = pauseWorker('COMMIT', () => disableMember(f.db, config, f.parentA, 'house-a', f.parentB));
    try {
      await disabling.reached();
      // The disable transaction holds the writer lock, so the redemption cannot slip in before it.
      expect(() => redeemPairing(display, pairing.secret)).toThrow(/locked|busy/i);
    } finally { disabling.release(); }
    disabling.waitForCommit();
    await expect(disabling.result).resolves.toEqual({ changed: true });
    expect(() => redeemPairing(display, pairing.secret)).toThrow(expect.objectContaining({ code: 'invalid' }));
    expect(f.db.prepare("SELECT count(*) AS n FROM display_device WHERE household_id = 'house-a'").get()).toEqual({ n: 0 });
    // Another household's pending code is untouched and still redeems exactly once.
    expect(redeemPairing(display, other.secret).householdId).toBe('house-b');
  }, 15000);

  it('does not link or re-enable an existing disabled account through a new invitation', async () => {
    const f = await fixture();
    await disableMember(f.db, config, f.parentA, 'house-a', f.kid);
    const token = createInvitation(f.db, f.parentA, 'house-a', 'kid');
    await expect(redeemInvitation(f.db, config, token, { name: 'Kid One', email: 'kid-one@example.test', password: 'synthetic-password-123' })).rejects.toThrow();
    expect(activeMembership(f.db, f.kid, 'house-a')).toBeNull();
  });
});

type DisableFixture = Awaited<ReturnType<typeof fixture>>;

describe('transactions competing with member disabling', () => {
  it.each(['disable', 'redeem'] as const)('keeps invitations and accounts consistent when %s commits first', async (first) => {
    const f = await fixture();
    const token = createInvitation(f.db, f.parentB, 'house-a', 'kid');
    const input = { name: 'Invitee', email: 'invitee@example.test', password: 'synthetic-password-123' };
    const disable = () => disableMember(f.db, config, f.parentA, 'house-a', f.parentB);
    const redeem = () => redeemInvitation(f.db, config, token, input);
    const winner = pauseWorker('COMMIT', async () => first === 'disable' ? disable() : redeem());
    const loser = pauseWorker('BEGIN IMMEDIATE', async () => first === 'disable' ? redeem() : disable());
    try {
      await Promise.all([winner.reached(), loser.reached()]);
    } finally {
      loser.release();
      winner.release();
    }
    const outcomes = await Promise.allSettled([winner.result, loser.result]);
    expect(outcomes.map(({ status }) => status)).toEqual(first === 'disable' ? ['fulfilled', 'rejected'] : ['fulfilled', 'fulfilled']);
    expect(activeMembership(f.db, f.parentB, 'house-a')).toBeNull();
    const account = f.db.prepare(`SELECT u.id, a.providerId AS provider FROM user u
      LEFT JOIN account a ON a.userId = u.id WHERE u.email = ?`).get(input.email) as { id: string; provider: string } | undefined;
    const invitation = f.db.prepare('SELECT consumed_at IS NOT NULL AS consumed, revoked_at IS NOT NULL AS revoked FROM household_invitation').get();
    if (first === 'disable') {
      expect(account).toBeUndefined();
      expect(invitation).toEqual({ consumed: 0, revoked: 1 });
      expect(f.db.prepare('SELECT count(*) AS n FROM membership').get()).toEqual({ n: 6 });
    } else {
      expect(account?.provider).toBe('credential');
      expect(activeMembership(f.db, account!.id, 'house-a')?.role).toBe('kid');
      expect(invitation).toEqual({ consumed: 1, revoked: 0 });
    }
  }, 15000);

  it.each(['sign-in', 'disable'] as const)('denies household access when %s commits first', async (first) => {
    const f = await fixture();
    const prior = await f.signedIn('kid-two@example.test');
    const signInDb = new Database(f.path, { fileMustExist: true }); dbs.push(signInDb);
    const disable = pauseWorker(first === 'sign-in' ? 'BEGIN IMMEDIATE' : 'COMMIT', () => disableMember(f.db, config, f.parentA, 'house-a', f.kid2));
    let reachedSessionWrite = false;
    const contender = betterAuth({
      database: signInDb, secret, baseURL: origin,
      emailAndPassword: { enabled: true, disableSignUp: true },
      databaseHooks: { session: { create: { before: async () => {
        reachedSessionWrite = true;
        if (first === 'disable') {
          disable.release();
          disable.waitForCommit();
        }
      } } } }
    });
    let response: Response;
    try {
      await disable.reached();
      response = await contender.handler(post('sign-in/email', { email: 'kid-two@example.test', password: 'synthetic-password-123' }));
      expect(response.status).toBe(200);
      expect(reachedSessionWrite).toBe(true);
    } finally {
      disable.release();
      await disable.result;
    }
    const racing = new Headers({ cookie: response.headers.get('set-cookie')!.split(';')[0] });
    expect(Boolean(await f.auth.api.getSession({ headers: prior }))).toBe(false);
    expect(Boolean(await f.auth.api.getSession({ headers: racing }))).toBe(first === 'disable');
    expect(await authorizeRequest(f.auth, f.db, racing, 'house-a', 'read')).toBe(false);
  }, 15000);

  it('recovers all access state if the disable worker exits before commit', async () => {
    const f = await fixture();
    const headers = await f.signedIn('parent-b@example.test');
    createInvitation(f.db, f.parentB, 'house-a', 'kid');
    const device = redeemPairing(f.db, createPairing(f.db, f.parentB, 'house-a', 'Kitchen').secret);
    const pending = pauseWorker('COMMIT', () => disableMember(f.db, config, f.parentA, 'house-a', f.parentB));
    try { await pending.reached(); }
    finally { await pending.terminate(); }
    await expect(pending.result).rejects.toThrow('Member access could not be disabled');
    const reopened = new Database(f.path, { fileMustExist: true }); dbs.push(reopened);
    expect(activeMembership(reopened, f.parentB, 'house-a')?.role).toBe('parent');
    expect(listHouseholdAccess(reopened, f.parentA, 'house-a').invitations).toHaveLength(1);
    expect(Boolean(verifyDisplayCredential(reopened, device.token))).toBe(true);
    expect(Boolean(await createAuth(reopened, config).api.getSession({ headers }))).toBe(true);
    expect(reopened.pragma('foreign_key_check')).toEqual([]);
  }, 15000);

  async function expectDisableWins(
    f: DisableFixture, target: string, write: () => unknown, tables: string[], denial = 'Not authorized'
  ) {
    const snapshot = () => tables.map(table => f.db.prepare(`SELECT * FROM ${table} ORDER BY 1, 2`).all());
    const before = snapshot();
    const pending = pauseWorker('COMMIT', () => disableMember(f.db, config, f.parentA, 'house-a', target));
    try {
      await pending.reached();
      const prepare = f.db.prepare.bind(f.db);
      const transaction = f.db.transaction.bind(f.db);
      let competingWriteReached = false;
      const letDisableCommit = () => {
        competingWriteReached = true;
        pending.release();
        pending.waitForCommit();
      };
      const startWrite = vi.spyOn(f.db, 'transaction').mockImplementationOnce((callback) => {
        letDisableCommit();
        return transaction(callback);
      });
      const prepareWrite = vi.spyOn(f.db, 'prepare').mockImplementation((sql) => {
        // Catch a mutation that omits an explicit transaction too.
        if (!f.db.inTransaction && /^(INSERT|UPDATE|DELETE) /.test(sql)) letDisableCommit();
        return prepare(sql);
      });
      try {
        expect(write).toThrow(denial);
        expect(competingWriteReached).toBe(true);
        expect(snapshot()).toEqual(before);
      } finally {
        prepareWrite.mockRestore();
        startWrite.mockRestore();
      }
    } finally {
      pending.release();
      await pending.result;
    }
  }

  it.each(['add', 'change', 'remove'] as const)('rejects grocery %s after disable wins the writer lock', async (action) => {
    const f = await fixture();
    const input = { name: 'Race milk', quantity: '', unit: '' };
    const id = addGrocery(f.db, f.parentA, 'house-a', input);
    const [{ version }] = listGroceries(f.db, f.parentA, 'house-a');
    const write = () => {
      if (action === 'add') return addGrocery(f.db, f.kid2, 'house-a', input, true);
      if (action === 'change') return changeGrocery(f.db, f.kid2, 'house-a', id, version, { ...input, completed: true });
      return removeGrocery(f.db, f.kid2, 'house-a', id, version);
    };
    await expectDisableWins(f, f.kid2, write, ['grocery_item']);
  }, 15000);

  const date = '2026-01-01';
  const seriesInput = (assigneeId: string) => ({ title: 'Synthetic series', assigneeId, startDate: date, weekdays: [4] });
  const choreInput = (assigneeId: string) => ({ title: 'Synthetic chore', assigneeId, dueDate: date });
  const meal = { title: 'Synthetic meal', date, ingredients: '', shared: false, submissionKey: 'synthetic-meal-key' };

  it.each([
    ['calendar cancellation', ['calendar_event'], (f) => {
      const id = createEvent(f.db, f.parentA, 'house-a', { title: 'Synthetic event', date, allDay: true });
      return () => cancelEvent(f.db, f.parentB, 'house-a', id);
    }],
    ['calendar inbox addition', ['calendar_inbox'], (f) =>
      () => addUnscheduled(f.db, f.parentB, 'house-a', { title: 'Synthetic inbox item', ownerId: f.kid })],
    ['calendar inbox edit', ['calendar_inbox'], (f) => {
      const id = addUnscheduled(f.db, f.parentA, 'house-a', { title: 'Synthetic inbox item' });
      return () => updateUnscheduled(f.db, f.parentB, 'house-a', id, { title: 'Changed item', ownerId: f.kid });
    }],
    ['calendar inbox archive', ['calendar_inbox'], (f) => {
      const id = addUnscheduled(f.db, f.parentA, 'house-a', { title: 'Synthetic inbox item' });
      return () => archiveUnscheduled(f.db, f.parentB, 'house-a', id);
    }],
    ['chore creation', ['chore', 'chore_transition'], (f) =>
      () => createChore(f.db, f.parentB, 'house-a', choreInput(f.kid))],
    ['timezone change', ['household_settings'], (f) =>
      () => setHouseholdTimezone(f.db, f.parentB, 'house-a', 'America/Chicago')],
    ['recurring series creation', ['recurring_series'], (f) =>
      () => createSeries(f.db, f.parentB, 'house-a', seriesInput(f.kid))],
    ['recurring occurrence generation', ['chore', 'chore_transition', 'recurring_occurrence'], (f) => {
      createSeries(f.db, f.parentA, 'house-a', seriesInput(f.kid));
      return () => generateOccurrences(f.db, f.parentB, 'house-a', date, date);
    }],
    ['payday change', ['payday_schedule'], (f) =>
      () => setPayday(f.db, f.parentB, 'house-a', date, 7)],
    ['meal creation', ['meal'], (f) =>
      () => createMeal(f.db, f.parentB, 'house-a', meal)],
    ['idempotent meal submission', ['meal'], (f) => {
      createMeal(f.db, f.parentA, 'house-a', meal);
      return () => createMeal(f.db, f.parentB, 'house-a', meal);
    }],
    ['meal edit', ['meal'], (f) => {
      const id = createMeal(f.db, f.parentA, 'house-a', meal);
      return () => updateMeal(f.db, f.parentB, 'house-a', id, { ...meal, title: 'Changed meal' });
    }]
  ] satisfies [string, string[], (f: DisableFixture) => () => unknown][])(
    'rejects %s after disable wins the writer lock', async (_operation, tables, prepare) => {
      const f = await fixture();
      await expectDisableWins(f, f.parentB, prepare(f), tables);
    }, 15000
  );

  it('cannot assign a new chore to a child disabled before the write', async () => {
    const f = await fixture();
    await expectDisableWins(f, f.kid, () => createChore(f.db, f.parentA, 'house-a', choreInput(f.kid)), ['chore', 'chore_transition']);
  }, 15000);

  it('cannot assign an inbox item to a member disabled before the write', async () => {
    const f = await fixture();
    await expectDisableWins(f, f.kid, () => addUnscheduled(f.db, f.parentA, 'house-a', { title: 'Synthetic inbox item', ownerId: f.kid }), ['calendar_inbox'], 'Invalid item');
  }, 15000);

  it.each(['creator', 'assignee'] as const)('skips a series with a disabled %s and generates other occurrences', async (disabled) => {
    const f = await fixture();
    const stopped = createSeries(f.db, f.parentB, 'house-a', seriesInput(f.kid));
    const healthy = createSeries(f.db, f.parentA, 'house-a', seriesInput(f.kid2));
    await disableMember(f.db, config, f.parentA, 'house-a', disabled === 'creator' ? f.parentB : f.kid);
    expect(f.db.prepare('SELECT id FROM recurring_series WHERE id = ?').get(stopped)).toEqual({ id: stopped });
    expect(() => generateOccurrences(f.db, f.parentA, 'house-a', date, date)).not.toThrow();
    expect(f.db.prepare('SELECT series_id FROM recurring_occurrence').all()).toEqual([{ series_id: healthy }]);
  });
});

describe('history is preserved', () => {
  it('preserves chores, rewards and calendar records', async () => {
    const f = await fixture();
    const choreId = createChore(f.db, f.parentA, 'house-a', { title: 'Dishes', assigneeId: f.kid, dueDate: '2026-01-01', rewardCents: 500 });
    changeChore(f.db, f.kid, 'house-a', choreId, 'submit');
    const pendingChore = createChore(f.db, f.parentA, 'house-a', { title: 'Pending', assigneeId: f.kid, dueDate: '2026-01-02', rewardCents: 200 });
    changeChore(f.db, f.kid, 'house-a', pendingChore, 'submit');
    changeChore(f.db, f.parentA, 'house-a', choreId, 'verify');
    recordPayout(f.db, f.parentA, 'house-a', { childId: f.kid, amountCents: 100, date: '2026-01-03', note: '', requestId: 'r1' });
    createEvent(f.db, f.parentA, 'house-a', { title: 'Synthetic event', date: '2026-01-03', allDay: true, participants: [f.kid] });
    const snapshot = () => ['chore', 'chore_transition', 'earning', 'payout', 'calendar_event', 'calendar_participant']
      .map(table => f.db.prepare(`SELECT * FROM ${table} ORDER BY 1, 2`).all());
    const before = snapshot();
    await disableMember(f.db, config, f.parentA, 'house-a', f.kid);
    await disableMember(f.db, config, f.parentB, 'house-a', f.parentA);
    expect(snapshot()).toEqual(before);
    expect(balance(f.db, 'house-a', f.kid)).toEqual({ earned: 500, paid: 100, owed: 400 });
    expect(f.db.prepare('SELECT actor_id FROM chore_transition WHERE chore_id = ? ORDER BY id').all(choreId).map((r) => (r as { actor_id: string }).actor_id)).toContain(f.parentA);
    expect(listHouseholdAccess(f.db, f.parentB, 'house-a').members.map((m) => [m.id, m.disabledAt !== null])).toEqual(expect.arrayContaining([[f.kid, true], [f.parentA, true]]));
  });
});

describe('migration and recovery', () => {
  it('preserves membership and session revocation through backup, restore and migration', async () => {
    const f = await fixture();
    const multiHousehold = await f.signedIn('kid-one@example.test');
    const finalHousehold = await f.signedIn('kid-two@example.test');
    await disableMember(f.db, config, f.parentA, 'house-a', f.kid);
    await disableMember(f.db, config, f.parentA, 'house-a', f.kid2);
    const restoredPath = join(dirs[0], 'restored.sqlite');
    await backupDatabase(f.path, restoredPath);
    const restored = new Database(restoredPath, { fileMustExist: true }); dbs.push(restored);
    restored.pragma('foreign_keys = ON');
    await migrate(restored);
    await migrate(restored);
    const auth = createAuth(restored, config);
    expect(activeMembership(restored, f.kid, 'house-a')).toBeNull();
    expect(activeMembership(restored, f.kid2, 'house-a')).toBeNull();
    expect(activeMembership(restored, f.parentB, 'house-a')?.role).toBe('parent');
    expect(await authorizeRequest(auth, restored, multiHousehold, 'house-a', 'read')).toBe(false);
    expect(await authorizeRequest(auth, restored, multiHousehold, 'house-b', 'read')).toBe(true);
    expect(Boolean(await auth.api.getSession({ headers: finalHousehold }))).toBe(false);
    expect(restored.pragma('foreign_key_check')).toEqual([]);
    expect(restored.pragma('integrity_check', { simple: true })).toBe('ok');
  });
});
