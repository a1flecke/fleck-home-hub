import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { backupDatabase } from '../../src/lib/server/backup';
import { addKid, bootstrap } from '../../src/lib/server/bootstrap';
import { changeChore, createChore } from '../../src/lib/server/chores';
import { createPairing, redeemPairing, revokeDisplay, verifyDisplayCredential } from '../../src/lib/server/display-pairing';
import { disableMember } from '../../src/lib/server/household-access';
import { createAuth, migrate } from '../../src/lib/server/identity';
import { createInvitation } from '../../src/lib/server/invitations';
import { balance, recordPayout, reversePayout } from '../../src/lib/server/payouts';
import { formatRehearsal, rehearseRestore } from '../../scripts/pilot/restore-rehearsal';

const secret = 'synthetic-rehearsal-secret-value-0123456789-SENTINEL';
const parent = { name: 'Rehearsal Parent', email: 'rehearsal-parent@example.test', password: 'synthetic-parent-password' };
const kid = { name: 'Rehearsal Kid', email: 'rehearsal-kid@example.test', password: 'synthetic-kid-password' };
const kid2 = { name: 'Disabled Kid', email: 'disabled-kid@example.test', password: 'synthetic-kid2-password' };

let dir = ''; let work = ''; let source = ''; let backup = ''; let household = '';
let activeDeviceToken = ''; let revokedDeviceToken = '';
let ids = { parent: '', kid: '', kid2: '' };
const config = () => ({ dbPath: source, origin: 'http://localhost:3000', secret });
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const signIn = async (db: Database.Database, user: { email: string; password: string }) => createAuth(db, config()).handler(new Request('http://localhost:3000/api/auth/sign-in/email', {
  method: 'POST', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' }, body: JSON.stringify({ email: user.email, password: user.password })
}));
const find = (report: { checks: { id: string; status: string; message: string }[] }, id: string) => report.checks.filter(c => c.id === id);

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'hub-rehearsal-'));
  work = join(dir, 'restore'); mkdirSync(work, { mode: 0o700 }); chmodSync(work, 0o700);
  source = join(dir, 'source.sqlite'); backup = join(dir, 'backup.sqlite');
  household = await bootstrap(config(), { ...parent, household: 'Rehearsal Home' });
  await addKid(config(), household, kid); await addKid(config(), household, kid2);
  const db = new Database(source); db.pragma('foreign_keys = ON'); db.pragma('journal_mode = WAL');
  const id = (email: string) => (db.prepare('SELECT id FROM user WHERE email = ?').get(email) as { id: string }).id;
  ids = { parent: id(parent.email), kid: id(kid.email), kid2: id(kid2.email) };
  const chore = createChore(db, ids.parent, household, { title: 'Synthetic chore', assigneeId: ids.kid, dueDate: '2026-10-30', rewardCents: 250 });
  changeChore(db, ids.kid, household, chore, 'submit'); changeChore(db, ids.parent, household, chore, 'verify');
  const wrong = recordPayout(db, ids.parent, household, { childId: ids.kid, amountCents: 50, date: '2026-10-30', note: '', requestId: 'r-wrong' });
  reversePayout(db, ids.parent, household, wrong, 'Recorded in error');
  recordPayout(db, ids.parent, household, { childId: ids.kid, amountCents: 100, date: '2026-10-30', note: '', requestId: 'r-paid' });
  await disableMember(db, config(), ids.parent, household, ids.kid2);
  const a = createPairing(db, ids.parent, household, 'Kitchen', Date.now()); activeDeviceToken = redeemPairing(db, a.secret, Date.now()).token;
  const b = createPairing(db, ids.parent, household, 'Garage', Date.now()); const rb = redeemPairing(db, b.secret, Date.now()); revokedDeviceToken = rb.token;
  revokeDisplay(db, ids.parent, household, rb.deviceId, Date.now());
  createInvitation(db, ids.parent, household, 'kid');
  expect((await signIn(db, parent)).status).toBe(200); expect((await signIn(db, kid)).status).toBe(200);
  db.close();
  await backupDatabase(source, backup);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('restore rehearsal', () => {
  it('restores into a new private file, checks integrity and invariants, and preserves auth, balances, memberships and display state', async () => {
    const activeBefore = sha(source);
    const destination = join(work, 'restored.sqlite');
    const report = await rehearseRestore({ backup, destination, activeDatabase: source, now: Date.now() });
    expect(report.ok).toBe(true);
    expect(find(report, 'integrity')[0].status).toBe('PASS');
    expect(find(report, 'earnings')[0].status).toBe('PASS');
    expect(find(report, 'balances')[0].status).toBe('PASS');
    expect(find(report, 'parents')[0].status).toBe('PASS');
    expect(statSync(destination).mode & 0o777).toBe(0o600);
    expect(sha(source)).toBe(activeBefore);

    const db = new Database(destination); db.pragma('foreign_keys = ON'); await migrate(db);
    try {
      expect((await signIn(db, parent)).status).toBe(200);
      expect((await signIn(db, kid)).status).toBe(200);
      expect(balance(db, household, ids.kid)).toEqual({ earned: 250, paid: 100, owed: 150 });
      expect(db.prepare('SELECT count(*) AS c FROM payout_reversal').get()).toEqual({ c: 1 });
      expect(db.prepare('SELECT disabled_at IS NOT NULL AS disabled FROM membership WHERE user_id = ?').get(ids.kid2)).toEqual({ disabled: 1 });
      expect(verifyDisplayCredential(db, activeDeviceToken)).not.toBeNull();
      expect(verifyDisplayCredential(db, revokedDeviceToken)).toBeNull();
    } finally { db.close(); }
  });

  it('warns that an older snapshot restores sessions, invitations and display credentials, and gives cleanup instructions, with no private values', async () => {
    const destination = join(work, 'restored.sqlite');
    const report = await rehearseRestore({ backup, destination, activeDatabase: source, now: Date.now() });
    const text = formatRehearsal(report, destination);
    expect(find(report, 'sessions')).toEqual([expect.objectContaining({ status: 'WARN', message: expect.stringContaining('2 unexpired personal session(s)') })]);
    expect(find(report, 'invitations')).toEqual([expect.objectContaining({ status: 'WARN', message: expect.stringContaining('1 unused, unexpired invitation link(s)') })]);
    expect(find(report, 'displays')).toEqual([expect.objectContaining({ status: 'WARN', message: expect.stringContaining('1 active display credential(s), 1 revoked, 0 unredeemed') })]);
    expect(text).toMatch(/previously valid sessions/i);
    expect(text).toMatch(/Household displays/);
    expect(text).toContain('Cleanup');
    expect(text).toContain(destination);
    for (const forbidden of [secret, parent.email, kid.email, parent.password, 'Rehearsal Home', household, activeDeviceToken, ids.parent]) expect(text).not.toContain(forbidden);
  });

  it('only creates the destination file and never opens or changes the backup', async () => {
    const backupHash = sha(backup);
    const before = readdirSync(dir).sort();
    await rehearseRestore({ backup, destination: join(work, 'restored.sqlite'), activeDatabase: source, now: Date.now() });
    expect(readdirSync(dir).sort()).toEqual(before);
    expect(readdirSync(work)).toEqual(['restored.sqlite']);
    expect(sha(backup)).toBe(backupHash);
  });

  it.each([
    ['an existing destination', () => { writeFileSync(join(work, 'restored.sqlite'), 'keep'); return { destination: join(work, 'restored.sqlite') }; }],
    ['the active database path', () => ({ destination: source })],
    ['the backup itself', () => ({ destination: backup })],
    ['a relative destination', () => ({ destination: 'restored.sqlite' })],
    ['a destination with ".." segments', () => ({ destination: `${work}/../restore/x.sqlite` })],
    ['a missing destination directory', () => ({ destination: join(dir, 'nope', 'x.sqlite') })],
    ['a group-readable destination directory', () => { chmodSync(work, 0o755); return { destination: join(work, 'x.sqlite') }; }],
    ['a missing backup', () => ({ destination: join(work, 'x.sqlite'), backup: join(dir, 'missing.sqlite') })]
  ])('refuses %s without touching existing files', async (_name, arrange) => {
    const patch = arrange() as { destination: string; backup?: string };
    const sourceHash = sha(source);
    const report = await rehearseRestore({ backup, activeDatabase: source, now: Date.now(), ...patch });
    expect(report.ok).toBe(false);
    expect(find(report, 'destination').concat(find(report, 'backup')).some(c => c.status === 'FAIL')).toBe(true);
    expect(sha(source)).toBe(sourceHash);
    if (existsSync(join(work, 'restored.sqlite'))) expect(readFileSync(join(work, 'restored.sqlite'), 'utf8')).toBe('keep');
  });

  it('rejects the configured live database as a backup, even through a hard link', async () => {
    const alias = join(dir, 'live-alias.sqlite');
    linkSync(source, alias);
    const before = sha(source);
    for (const input of [source, alias]) {
      const destination = join(work, 'restored.sqlite');
      const report = await rehearseRestore({ backup: input, destination, activeDatabase: source });
      expect(find(report, 'backup')).toEqual([expect.objectContaining({ status: 'FAIL' })]);
      expect(existsSync(destination)).toBe(false);
    }
    expect(sha(source)).toBe(before);
  });

  it('rejects an input with uncheckpointed commits without changing its WAL', async () => {
    const input = join(dir, 'not-a-standalone-backup.sqlite');
    copyFileSync(backup, input);
    const live = new Database(input);
    try {
      live.pragma('journal_mode = WAL');
      live.pragma('wal_checkpoint(TRUNCATE)');
      live.prepare("UPDATE household SET name = 'Only in the WAL'").run();
      const wal = input + '-wal';
      const before = sha(wal);
      const destination = join(work, 'restored.sqlite');
      const report = await rehearseRestore({ backup: input, destination, activeDatabase: source });
      expect(find(report, 'backup')).toEqual([expect.objectContaining({ status: 'FAIL' })]);
      expect(sha(wal)).toBe(before);
      expect(existsSync(destination)).toBe(false);
    } finally { live.close(); }
  });

  it.each(['-wal', '-shm', '-journal'])('rejects a destination with an existing %s before copying', async suffix => {
    const destination = join(work, 'restored.sqlite');
    const sidecar = destination + suffix;
    writeFileSync(sidecar, 'preserve');
    const report = await rehearseRestore({ backup, destination, activeDatabase: source });
    expect(find(report, 'destination')).toEqual([expect.objectContaining({ status: 'FAIL' })]);
    expect(readFileSync(sidecar, 'utf8')).toBe('preserve');
    expect(existsSync(destination)).toBe(false);
  });

  it('restores a closed legacy WAL-format backup as a standalone file', async () => {
    const legacy = new Database(backup);
    try { expect(legacy.pragma('journal_mode = WAL', { simple: true })).toBe('wal'); }
    finally { legacy.close(); }
    const before = sha(backup);
    const destination = join(work, 'restored.sqlite');
    const report = await rehearseRestore({ backup, destination, activeDatabase: source });
    expect(report.ok).toBe(true);
    expect(sha(backup)).toBe(before);
    expect(readdirSync(work)).toEqual(['restored.sqlite']);
    const copy = new Database(destination, { readonly: true, fileMustExist: true });
    try { expect(copy.pragma('journal_mode', { simple: true })).toBe('delete'); }
    finally { copy.close(); }
  });

  it('rejects a backup changed between path validation and the first descriptor read', async () => {
    const destination = join(work, 'restored.sqlite');
    const pending = rehearseRestore({ backup, destination, activeDatabase: source });
    const writer = new Database(backup, { fileMustExist: true });
    try { writer.prepare("UPDATE household SET name = 'Changed during the copy'").run(); }
    finally { writer.close(); }
    const after = sha(backup);
    const report = await pending;
    expect(find(report, 'backup')).toEqual([expect.objectContaining({ status: 'FAIL' })]);
    expect(sha(backup)).toBe(after);
    expect(readdirSync(work)).toEqual([]);
  });

  it('rejects a source companion file created while copying without touching it', async () => {
    const destination = join(work, 'restored.sqlite');
    const pending = rehearseRestore({ backup, destination, activeDatabase: source });
    writeFileSync(backup + '-journal', 'preserve', { flag: 'wx' });
    const report = await pending;
    expect(find(report, 'backup')).toEqual([expect.objectContaining({ status: 'FAIL' })]);
    expect(readFileSync(backup + '-journal', 'utf8')).toBe('preserve');
    expect(readdirSync(work)).toEqual([]);
  });

  it('leaves a destination created by a competing operation intact', async () => {
    const destination = join(work, 'restored.sqlite');
    const pending = rehearseRestore({ backup, destination, activeDatabase: source, migrate: true });
    const appearedEarly = existsSync(destination);
    if (!appearedEarly) writeFileSync(destination, 'competing writer', { flag: 'wx' });
    const report = await pending;
    expect(appearedEarly).toBe(false);
    expect(report.ok).toBe(false);
    expect(readFileSync(destination, 'utf8')).toBe('competing writer');
    expect(readdirSync(work)).toEqual(['restored.sqlite']);
  });

  it.each([false, true])('rejects an unrelated SQLite file with migrate %s', async migrateBackup => {
    const input = join(dir, 'unrelated.sqlite');
    const unrelated = new Database(input);
    try { unrelated.exec('CREATE TABLE unrelated (id INTEGER)'); }
    finally { unrelated.close(); }
    const destination = join(work, 'restored.sqlite');
    const report = await rehearseRestore({ backup: input, destination, activeDatabase: source, migrate: migrateBackup });
    expect(find(report, 'schema')).toEqual([expect.objectContaining({ status: 'FAIL' })]);
    expect(existsSync(destination)).toBe(false);
  });

  it('validates the CLI config before publishing and reports failures without config values', () => {
    const configFile = join(dir, 'synthetic.conf');
    const destination = join(work, 'restored.sqlite');
    const run = () => spawnSync(process.execPath, [
      '--import', 'tsx', 'scripts/pilot/restore-rehearsal.ts',
      '--backup', backup, '--destination', destination, '--config-file', configFile, '--migrate'
    ], { encoding: 'utf8' });
    writeFileSync(configFile, `DATABASE_PATH=${source}\nDATABASE_PATH=${backup}\nAUTH_SECRET=${secret}\n`, { mode: 0o600 });
    const rejected = run();
    expect(rejected.status).toBe(64);
    expect(rejected.stderr.trim()).toBe('Could not read a valid restore configuration.');
    expect(rejected.stdout).toBe('');
    expect(existsSync(destination)).toBe(false);

    writeFileSync(configFile, `DATABASE_PATH=${source}\n`);
    const restored = run();
    expect(restored.status).toBe(0);
    expect(restored.stderr).toBe('');
    expect(restored.stdout).toContain('published the verified copy');
    expect(existsSync(destination)).toBe(true);
  });

  it('fails a corrupt backup at the integrity check', async () => {
    const corrupt = join(dir, 'corrupt.sqlite'); writeFileSync(corrupt, 'not a database '.repeat(1000));
    const report = await rehearseRestore({ backup: corrupt, destination: join(work, 'restored.sqlite'), activeDatabase: source, now: Date.now() });
    expect(report.ok).toBe(false);
    expect(find(report, 'integrity')[0].status).toBe('FAIL');
  });

  it('reports a failed migration on a restored copy and leaves the earlier good restore usable', async () => {
    const good = await rehearseRestore({ backup, destination: join(work, 'good.sqlite'), activeDatabase: source, now: Date.now(), migrate: true });
    expect(good.ok).toBe(true);
    const db = new Database(source); db.exec('ALTER TABLE user ADD COLUMN unreviewed_schema_change TEXT'); db.close();
    const bad = join(dir, 'bad-backup.sqlite'); await backupDatabase(source, bad);
    const failed = await rehearseRestore({ backup: bad, destination: join(work, 'bad.sqlite'), activeDatabase: source, now: Date.now(), migrate: true });
    expect(failed.ok).toBe(false);
    expect(find(failed, 'migration')[0].status).toBe('FAIL');
    expect(existsSync(join(work, 'bad.sqlite'))).toBe(false);
    expect(JSON.stringify(failed)).not.toContain('unreviewed_schema_change');
    const restored = new Database(join(work, 'good.sqlite'), { readonly: true });
    expect(restored.pragma('integrity_check', { simple: true })).toBe('ok'); restored.close();
  });

  it('flags a household without an active parent and a verified chore without an earning', async () => {
    const tampered = join(dir, 'tampered.sqlite'); copyFileSync(backup, tampered);
    const db = new Database(tampered);
    db.pragma('foreign_keys = OFF');
    db.exec('DROP TRIGGER IF EXISTS membership_keep_active_parent');
    db.prepare("UPDATE membership SET disabled_at = 1, disabled_by = ? WHERE role = 'parent'").run(ids.kid);
    db.exec('DROP TRIGGER earning_no_delete'); db.exec('DELETE FROM earning');
    db.close();
    const report = await rehearseRestore({ backup: tampered, destination: join(work, 't.sqlite'), activeDatabase: source, now: Date.now() });
    expect(report.ok).toBe(false);
    expect(find(report, 'parents')[0].status).toBe('FAIL');
    expect(find(report, 'earnings')[0].status).toBe('FAIL');
  });
});
