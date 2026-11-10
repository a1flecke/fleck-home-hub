import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runDatabaseWorkers } from './helpers/database-workers';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate as migrateDrizzle } from 'drizzle-orm/better-sqlite3/migrator';
import { migrate } from '../src/lib/server/identity';
import { createEvent } from '../src/lib/server/calendar';
import { createChore } from '../src/lib/server/chores';
import { createMeal } from '../src/lib/server/meals';
import { displayDataForDevice, setDisplayVisibility } from '../src/lib/server/display';
import { disableMember } from '../src/lib/server/household-access';
import { backupDatabase } from '../src/lib/server/backup';
import {
  DEVICE_TTL_MS, DisplayPairingError, MAX_PENDING_PAIRINGS, PAIRING_TTL_MS, createFailureLimiter, createPairing, listDisplays,
  redeemPairing, revokeDisplay, revokePairing, verifyDisplayCredential
} from '../src/lib/server/display-pairing';

const dbs: Database.Database[] = [];
const dirs: string[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function tempPath() {
  const dir = mkdtempSync(join(tmpdir(), 'hub-display-pairing-')); dirs.push(dir);
  return join(dir, 'synthetic.sqlite');
}

async function fixture(path = ':memory:') {
  const db = new Database(path); dbs.push(db);
  db.pragma('foreign_keys = ON');
  await migrate(db);
  for (const id of ['parent', 'parent2', 'kid', 'outsider', 'outsider2']) db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, `${id}@example.test`);
  db.prepare('INSERT INTO household VALUES (?, ?), (?, ?)').run('home', 'Home', 'other', 'Other');
  const add = db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)');
  add.run('parent', 'home', 'parent'); add.run('parent2', 'home', 'parent'); add.run('kid', 'home', 'kid');
  add.run('outsider', 'other', 'parent'); add.run('outsider2', 'other', 'parent');
  return db;
}

function pairedDevice(db: Database.Database, parent = 'parent', household = 'home', label = 'Kitchen screen', now = 1_000_000) {
  const pairing = createPairing(db, parent, household, label, now);
  const device = redeemPairing(db, pairing.secret, now + 1000);
  return { pairing, device };
}

describe('pairing creation', () => {
  it('lets an active parent create a short-lived secret that is stored only as a hash', async () => {
    const db = await fixture();
    const pairing = createPairing(db, 'parent', 'home', '  Kitchen screen  ', 5000);
    expect(pairing.secret).toMatch(/^([A-Z2-9]{4}-){5}[A-Z2-9]{4}$/);
    expect(pairing.expiresAt).toBe(5000 + PAIRING_TTL_MS);
    const row = db.prepare('SELECT * FROM display_pairing').get() as Record<string, unknown>;
    expect(row).toMatchObject({ household_id: 'home', created_by: 'parent', label: 'Kitchen screen', consumed_at: null, revoked_at: null });
    const compact = pairing.secret.replaceAll('-', '');
    expect(JSON.stringify(db.prepare('SELECT * FROM display_pairing').all())).not.toContain(compact);
    expect(String(row.secret_hash)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generates distinct high-entropy secrets', async () => {
    const db = await fixture();
    const secrets = new Set(Array.from({ length: MAX_PENDING_PAIRINGS }, () => createPairing(db, 'parent', 'home', 'Screen', 1).secret));
    expect(secrets.size).toBe(MAX_PENDING_PAIRINGS);
  });

  it.each([['kid', 'home'], ['outsider', 'home'], ['parent', 'other'], ['nobody', 'home']])('rejects %s creating a pairing for %s', async (actor, household) => {
    const db = await fixture();
    expect(() => createPairing(db, actor, household, 'Screen', 1)).toThrow(DisplayPairingError);
    expect(db.prepare('SELECT count(*) AS n FROM display_pairing').get()).toEqual({ n: 0 });
  });

  it('rejects a disabled parent', async () => {
    const db = await fixture(tempPath());
    await disableMember(db, { secret: 'synthetic-display-pairing-secret-over-32-characters', origin: 'http://localhost:3000' }, 'parent2', 'home', 'parent');
    expect(() => createPairing(db, 'parent', 'home', 'Screen', 1)).toThrow(DisplayPairingError);
  });

  it.each(['', '   ', 'x'.repeat(61), 'bad\nlabel', 'bad\u0000label'])('rejects label %j', async (label) => {
    const db = await fixture();
    expect(() => createPairing(db, 'parent', 'home', label, 1)).toThrow(expect.objectContaining({ code: 'invalid-label' }));
  });

  it('caps outstanding pairings per household without counting other households or expired ones', async () => {
    const db = await fixture();
    for (let i = 0; i < MAX_PENDING_PAIRINGS; i++) createPairing(db, 'parent', 'home', `Screen ${i}`, 1000);
    expect(() => createPairing(db, 'parent2', 'home', 'One too many', 1000)).toThrow(expect.objectContaining({ code: 'too-many' }));
    expect(() => createPairing(db, 'outsider', 'other', 'Independent', 1000)).not.toThrow();
    expect(() => createPairing(db, 'parent', 'home', 'After expiry', 1000 + PAIRING_TTL_MS)).not.toThrow();
  });
});

describe('pairing redemption', () => {
  it('issues one opaque credential, stored only as a hash, and consumes the secret', async () => {
    const db = await fixture();
    const { pairing, device } = pairedDevice(db);
    expect(device.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(device.expiresAt).toBe(1_001_000 + DEVICE_TTL_MS);
    const everything = JSON.stringify([db.prepare('SELECT * FROM display_device').all(), db.prepare('SELECT * FROM display_pairing').all()]);
    expect(everything).not.toContain(device.token);
    expect(everything).not.toContain(pairing.secret.replaceAll('-', ''));
    expect(db.prepare('SELECT consumed_at FROM display_pairing').get()).toEqual({ consumed_at: 1_001_000 });
    expect(verifyDisplayCredential(db, device.token, 1_002_000)).toMatchObject({ householdId: 'home', label: 'Kitchen screen' });
  });

  it('accepts the secret regardless of case, spacing and grouping', async () => {
    const db = await fixture();
    const pairing = createPairing(db, 'parent', 'home', 'Screen', 1000);
    expect(redeemPairing(db, ` ${pairing.secret.toLowerCase().replaceAll('-', ' ')} `, 2000).token).toBeTruthy();
  });

  it('is single use', async () => {
    const db = await fixture();
    const { pairing } = pairedDevice(db);
    expect(() => redeemPairing(db, pairing.secret, 2_000_000)).toThrow(expect.objectContaining({ code: 'invalid' }));
    expect(db.prepare('SELECT count(*) AS n FROM display_device').get()).toEqual({ n: 1 });
  });

  it('rejects expired, revoked, unknown and malformed secrets with the same generic error', async () => {
    const db = await fixture();
    const expired = createPairing(db, 'parent', 'home', 'Expired', 1000);
    const revoked = createPairing(db, 'parent', 'home', 'Revoked', 1000);
    const id = (db.prepare("SELECT id FROM display_pairing WHERE label = 'Revoked'").get() as { id: string }).id;
    revokePairing(db, 'parent', 'home', id, 1500);
    const messages = new Set<string>();
    for (const [secret, now] of [[expired.secret, 1000 + PAIRING_TTL_MS], [revoked.secret, 2000], ['AAAA-AAAA-AAAA-AAAA-AAAA-AAAA', 2000], ['short', 2000], ['', 2000], ['0'.repeat(24), 2000], ["'; DROP TABLE display_device;--", 2000]] as const) {
      try { redeemPairing(db, secret, now); throw new Error('should have failed'); }
      catch (error) { expect(error).toBeInstanceOf(DisplayPairingError); messages.add((error as Error).message); }
    }
    expect(messages.size).toBe(1);
    expect([...messages][0]).not.toMatch(/expired|revoked|hash|sql|household/i);
    expect(db.prepare('SELECT count(*) AS n FROM display_device').get()).toEqual({ n: 0 });
  });

  it('allows at most one session when several processes redeem the same secret at once', async () => {
    const path = tempPath();
    const db = await fixture(path); db.pragma('journal_mode = WAL');
    const pairing = createPairing(db, 'parent', 'home', 'Race', 1000);
    // Separate processes and connections, released together once every connection is open.
    const outcomes = await runDatabaseWorkers('tests/fixtures/redeem-pairing-worker.ts', Array.from({ length: 4 }, () => [path, pairing.secret, '2000']));
    expect(outcomes.sort()).toEqual(['invalid', 'invalid', 'invalid', 'redeemed']);
    expect(db.prepare('SELECT count(*) AS n FROM display_device').get()).toEqual({ n: 1 });
    expect(db.prepare('SELECT consumed_at FROM display_pairing').get()).toEqual({ consumed_at: 2000 });
  });

  it('rejects an invalid secret without waiting for the writer lock', async () => {
    const path = tempPath();
    const writer = await fixture(path); writer.pragma('journal_mode = WAL');
    const reader = new Database(path); dbs.push(reader); reader.pragma('busy_timeout = 0');
    const pairing = createPairing(writer, 'parent', 'home', 'Locked', 1000);
    writer.exec('BEGIN IMMEDIATE');
    try {
      // Unauthenticated garbage must not queue on (or fail with) the household writer lock.
      expect(() => redeemPairing(reader, 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA', 2000)).toThrow(DisplayPairingError);
      // A genuine code still needs the lock to be consumed, so it waits for other writers.
      expect(() => redeemPairing(reader, pairing.secret, 2000)).toThrow(/locked|busy/i);
    } finally { writer.exec('ROLLBACK'); }
    expect(redeemPairing(reader, pairing.secret, 2000).householdId).toBe('home');
  });

  it('is structurally limited to one device per pairing even if the consume check were bypassed', async () => {
    const db = await fixture();
    const { device } = pairedDevice(db);
    const row = db.prepare('SELECT * FROM display_device WHERE id = ?').get(device.deviceId) as Record<string, unknown>;
    expect(() => db.prepare('INSERT INTO display_device (id, pairing_id, token_hash, household_id, label, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run('second', row.pairing_id, 'another-hash', 'home', 'Dup', 'parent', 1, 2)).toThrow();
  });

  it('refuses redemption after the issuing parent was disabled', async () => {
    const db = await fixture();
    const pairing = createPairing(db, 'parent', 'home', 'Screen', 1000);
    db.prepare('UPDATE membership SET disabled_at = 5, disabled_by = ? WHERE user_id = ?').run('parent2', 'parent');
    expect(() => redeemPairing(db, pairing.secret, 2000)).toThrow(DisplayPairingError);
  });
});

describe('display credential verification', () => {
  it('rejects unknown, malformed and tampered credentials', async () => {
    const db = await fixture();
    const { device } = pairedDevice(db);
    for (const token of ['', 'x', 'A'.repeat(43), `${device.token}x`, device.token.slice(0, -1) + (device.token.endsWith('A') ? 'B' : 'A'), "' OR 1=1 --"]) expect(verifyDisplayCredential(db, token, 1_002_000)).toBeNull();
  });

  it('expires according to policy', async () => {
    const db = await fixture();
    const { device } = pairedDevice(db);
    expect(verifyDisplayCredential(db, device.token, device.expiresAt - 1)).not.toBeNull();
    expect(verifyDisplayCredential(db, device.token, device.expiresAt)).toBeNull();
  });

  it('records last access at most once per interval and never exposes the credential', async () => {
    const db = await fixture();
    const { device } = pairedDevice(db);
    expect(verifyDisplayCredential(db, device.token, 2_000_000)).not.toBeNull();
    verifyDisplayCredential(db, device.token, 2_000_100);
    const shown = listDisplays(db, 'parent', 'home', 2_000_200);
    expect(shown.devices).toHaveLength(1);
    expect(shown.devices[0]).toMatchObject({ label: 'Kitchen screen', status: 'active', pairedAt: 1_001_000, lastSeenAt: 2_000_000 });
    expect(JSON.stringify(shown)).not.toContain(device.token);
    expect(JSON.stringify(shown)).not.toMatch(/hash|token|secret/i);
  });

  it('serves a valid display without waiting for another writer to record last access', async () => {
    const path = tempPath();
    const writer = await fixture(path); writer.pragma('journal_mode = WAL');
    const { device } = pairedDevice(writer);
    // The production connection keeps better-sqlite3's default 5-second busy timeout.
    const server = new Database(path, { fileMustExist: true }); dbs.push(server);
    const timeout = server.pragma('busy_timeout', { simple: true });
    writer.exec('BEGIN IMMEDIATE');
    try {
      const started = performance.now();
      expect(verifyDisplayCredential(server, device.token, 2_000_000)).toMatchObject({ deviceId: device.deviceId });
      // A synchronous wait here would block every request on the Node event loop.
      expect(performance.now() - started).toBeLessThan(500);
    } finally { writer.exec('ROLLBACK'); }
    expect(server.pragma('busy_timeout', { simple: true })).toBe(timeout);
    // The skipped bookkeeping is retried on the next request once the writer is free.
    verifyDisplayCredential(server, device.token, 2_000_100);
    expect(writer.prepare('SELECT last_seen_at FROM display_device').get()).toEqual({ last_seen_at: 2_000_100 });
  });

  it('is not accepted when presented as a household member credential', async () => {
    const db = await fixture();
    const { device } = pairedDevice(db);
    expect(db.prepare('SELECT count(*) AS n FROM session WHERE token = ?').get(device.token)).toEqual({ n: 0 });
    expect(db.prepare('SELECT count(*) AS n FROM user').get()).toEqual({ n: 5 });
  });
});

describe('revocation and lifecycle', () => {
  it('lets any active parent in the household revoke a display immediately and idempotently', async () => {
    const db = await fixture();
    const { device } = pairedDevice(db);
    expect(revokeDisplay(db, 'parent2', 'home', device.deviceId, 3000)).toEqual({ changed: true });
    expect(verifyDisplayCredential(db, device.token, 3001)).toBeNull();
    expect(revokeDisplay(db, 'parent', 'home', device.deviceId, 4000)).toEqual({ changed: false });
    expect(db.prepare('SELECT revoked_at, revoked_by FROM display_device').get()).toEqual({ revoked_at: 3000, revoked_by: 'parent2' });
    expect(listDisplays(db, 'parent', 'home', 5000).devices[0].status).toBe('revoked');
  });

  it.each([['kid', 'home'], ['outsider', 'home'], ['outsider', 'other']])('does not let %s revoke a display of %s', async (actor, household) => {
    const db = await fixture();
    const { device } = pairedDevice(db);
    expect(() => revokeDisplay(db, actor, household, device.deviceId, 3000)).toThrow(DisplayPairingError);
    expect(verifyDisplayCredential(db, device.token, 3001)).not.toBeNull();
  });

  it('reports active, expired, revoked and pending displays', async () => {
    const db = await fixture();
    const active = pairedDevice(db, 'parent', 'home', 'Active', 1000);
    const expired = pairedDevice(db, 'parent', 'home', 'Expired', 1000);
    const revoked = pairedDevice(db, 'parent', 'home', 'Revoked', 1000);
    db.prepare('UPDATE display_device SET expires_at = 2000 WHERE id = ?').run(expired.device.deviceId);
    revokeDisplay(db, 'parent', 'home', revoked.device.deviceId, 3000);
    createPairing(db, 'parent', 'home', 'Waiting', 4000);
    const shown = listDisplays(db, 'parent', 'home', 5000);
    expect(Object.fromEntries(shown.devices.map(device => [device.label, device.status]))).toEqual({ Active: 'active', Expired: 'expired', Revoked: 'revoked' });
    expect(shown.pending.map(item => item.label)).toEqual(['Waiting']);
    expect(active.device.deviceId).toBeTruthy();
  });

  it('restricts listing and pairing revocation to parents of the household', async () => {
    const db = await fixture();
    const { device } = pairedDevice(db);
    createPairing(db, 'parent', 'home', 'Pending', 4000);
    const id = (db.prepare("SELECT id FROM display_pairing WHERE label = 'Pending'").get() as { id: string }).id;
    for (const [actor, household] of [['kid', 'home'], ['outsider', 'home']]) {
      expect(() => listDisplays(db, actor, household)).toThrow(DisplayPairingError);
      expect(() => revokePairing(db, actor, household, id)).toThrow(DisplayPairingError);
    }
    // A parent of another household reaches only their own household; the id does not cross over.
    expect(() => revokePairing(db, 'outsider', 'other', id)).toThrow(DisplayPairingError);
    expect(listDisplays(db, 'outsider', 'other').devices).toEqual([]);
    expect(verifyDisplayCredential(db, device.token, 5000)).not.toBeNull();
  });
});

describe('disabled parents', () => {
  it('revokes the disabled parent\'s pending pairings and displays, leaving other parents and households untouched', async () => {
    const db = await fixture(tempPath());
    const mine = pairedDevice(db, 'parent', 'home', 'Mine');
    const theirs = pairedDevice(db, 'parent2', 'home', 'Theirs');
    const foreign = pairedDevice(db, 'outsider', 'other', 'Foreign');
    const pending = createPairing(db, 'parent', 'home', 'Unredeemed', 1_100_000);
    await disableMember(db, { secret: 'synthetic-display-pairing-secret-over-32-characters', origin: 'http://localhost:3000' }, 'parent2', 'home', 'parent');
    expect(verifyDisplayCredential(db, mine.device.token, 1_200_000)).toBeNull();
    expect(() => redeemPairing(db, pending.secret, 1_200_000)).toThrow(DisplayPairingError);
    expect(verifyDisplayCredential(db, theirs.device.token, 1_200_000)).not.toBeNull();
    expect(verifyDisplayCredential(db, foreign.device.token, 1_200_000)).not.toBeNull();
    expect(db.prepare("SELECT count(*) AS n FROM display_device WHERE created_by = 'parent' AND revoked_at IS NOT NULL").get()).toEqual({ n: 1 });
  });

  it('also fails closed at verification if membership was changed without the revocation hook', async () => {
    const db = await fixture();
    const { device } = pairedDevice(db);
    db.prepare('UPDATE membership SET disabled_at = 5, disabled_by = ? WHERE user_id = ?').run('parent2', 'parent');
    expect(verifyDisplayCredential(db, device.token, 1_100_000)).toBeNull();
  });
});

describe('read-only projection', () => {
  it('returns only shared, non-private household records for the verified display household', async () => {
    const db = await fixture();
    const shown = createEvent(db, 'parent', 'home', { title: 'Shared event', date: '2026-11-07', allDay: true, description: 'PRIVATE-DESCRIPTION', location: 'PRIVATE-LOCATION', participants: ['kid'] });
    createEvent(db, 'parent', 'home', { title: 'Unshared event', date: '2026-11-07', allDay: true });
    createEvent(db, 'outsider', 'other', { title: 'Foreign event', date: '2026-11-07', allDay: true });
    const sharedChore = createChore(db, 'parent', 'home', { title: 'Shared chore', description: 'PRIVATE-CHORE', assigneeId: 'kid', dueDate: '2026-11-07', rewardCents: 987 });
    createChore(db, 'parent', 'home', { title: 'Unshared chore', assigneeId: 'kid', dueDate: '2026-11-07', rewardCents: 123 });
    setDisplayVisibility(db, 'parent', 'home', 'event', shown, true);
    setDisplayVisibility(db, 'parent', 'home', 'chore', sharedChore, true);
    createMeal(db, 'parent', 'home', { title: 'Shared meal', date: '2026-11-07', ingredients: 'rice', notes: 'PRIVATE-NOTE', shared: true });
    createMeal(db, 'parent', 'home', { title: 'Unshared meal', date: '2026-11-07', ingredients: 'secret', notes: 'PRIVATE-NOTE-2', shared: false });
    createMeal(db, 'outsider', 'other', { title: 'Foreign meal', date: '2026-11-07', ingredients: 'x', shared: true });
    const { device } = pairedDevice(db);
    const verified = verifyDisplayCredential(db, device.token, 1_002_000)!;
    const data = displayDataForDevice(db, verified, '2026-11-07', '2026-11-14');
    expect(data.events.map(event => event.title)).toEqual(['Shared event']);
    expect(data.chores.map(chore => chore.title)).toEqual(['Shared chore']);
    expect(data.meals.map(meal => meal.title)).toEqual(['Shared meal']);
    const body = JSON.stringify(data);
    expect(body).not.toMatch(/PRIVATE|987|rewardCents|reward|notes|assignee|participants|Unshared|Foreign|choices/i);
    expect(Object.keys(data).sort()).toEqual(['chores', 'events', 'meals']);
    expect(Object.keys(data.events[0]).sort()).toEqual(['allDay', 'date', 'endTime', 'id', 'startTime', 'title']);
  });

  it('follows another household\'s data only through its own verified credential', async () => {
    const db = await fixture();
    const homeEvent = createEvent(db, 'parent', 'home', { title: 'Home only', date: '2026-11-07', allDay: true });
    const otherEvent = createEvent(db, 'outsider', 'other', { title: 'Other only', date: '2026-11-07', allDay: true });
    setDisplayVisibility(db, 'parent', 'home', 'event', homeEvent, true);
    setDisplayVisibility(db, 'outsider', 'other', 'event', otherEvent, true);
    const home = verifyDisplayCredential(db, pairedDevice(db, 'parent', 'home').device.token, 1_002_000)!;
    const other = verifyDisplayCredential(db, pairedDevice(db, 'outsider', 'other', 'Other screen').device.token, 1_002_000)!;
    expect(displayDataForDevice(db, home, '2026-11-07', '2026-11-14').events.map(event => event.title)).toEqual(['Home only']);
    expect(displayDataForDevice(db, other, '2026-11-07', '2026-11-14').events.map(event => event.title)).toEqual(['Other only']);
  });
});

describe('failure limiter', () => {
  it('blocks after repeated failures within the window and recovers afterwards', () => {
    let now = 0;
    const limiter = createFailureLimiter(3, 1000, () => now);
    expect(limiter.blocked()).toBe(false);
    limiter.failure(); limiter.failure();
    expect(limiter.blocked()).toBe(false);
    limiter.failure();
    expect(limiter.blocked()).toBe(true);
    now = 1001;
    expect(limiter.blocked()).toBe(false);
  });
});

describe('persistence', () => {
  it('preserves pairing and revocation state through backup and restore', async () => {
    const path = tempPath();
    const db = await fixture(path); db.pragma('journal_mode = WAL');
    const active = pairedDevice(db, 'parent', 'home', 'Active', Date.now());
    const revoked = pairedDevice(db, 'parent', 'home', 'Revoked', Date.now());
    revokeDisplay(db, 'parent', 'home', revoked.device.deviceId);
    const destination = join(dirs[0], 'backup.sqlite');
    await backupDatabase(path, destination);
    const restored = new Database(destination, { fileMustExist: true }); dbs.push(restored);
    expect(verifyDisplayCredential(restored, active.device.token)).not.toBeNull();
    expect(verifyDisplayCredential(restored, revoked.device.token)).toBeNull();
  });

  it('upgrades a preexisting synthetic household without changing it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hub-display-migration-')); dirs.push(dir);
    const full = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8'));
    mkdirSync(join(dir, 'meta'));
    const entries = full.entries.filter((entry: { tag: string }) => entry.tag < '0012');
    for (const entry of entries) copyFileSync(`drizzle/${entry.tag}.sql`, join(dir, `${entry.tag}.sql`));
    writeFileSync(join(dir, 'meta/_journal.json'), JSON.stringify({ ...full, entries }));
    const db = new Database(':memory:'); dbs.push(db);
    db.pragma('foreign_keys = ON');
    db.exec('CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL)');
    migrateDrizzle(drizzle(db), { migrationsFolder: dir });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'display_device'").get()).toBeUndefined();
    db.prepare('INSERT INTO user VALUES (?)').run('synthetic');
    db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'Example');
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('synthetic', 'home', 'parent');
    migrateDrizzle(drizzle(db), { migrationsFolder: 'drizzle' });
    expect(db.prepare('SELECT role FROM membership WHERE user_id = ?').get('synthetic')).toEqual({ role: 'parent' });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name IN ('display_device', 'display_pairing') ORDER BY name").all()).toEqual([{ name: 'display_device' }, { name: 'display_pairing' }]);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });
});
