import { constants, createWriteStream, lstatSync, readFileSync, realpathSync, statSync, type BigIntStats } from 'node:fs';
import { open } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import Database from 'better-sqlite3';
import { migrate } from '../../src/lib/server/identity';
import { balance } from '../../src/lib/server/payouts';
import { assertNoSqliteSidecars, stageSqliteSnapshot } from '../../src/lib/server/sqlite-snapshot';
import { parseEnvFile } from './envfile.mjs';

export type Status = 'PASS' | 'WARN' | 'FAIL';
export interface Check { id: string; status: Status; message: string }
export interface Rehearsal { ok: boolean; checks: Check[] }
export interface RehearsalOptions { backup: string; destination: string; activeDatabase?: string; now?: number; migrate?: boolean }

const hasDotDot = (path: string) => path.split('/').includes('..');
const count = (db: Database.Database, sql: string, ...params: unknown[]) => (db.prepare(sql).get(...params) as { n: number }).n;

type AddCheck = (id: string, status: Status, message: string) => void;

function canonicalDestination(path: string) {
  const parent = dirname(path);
  return statSync(parent, { throwIfNoEntry: false }) ? join(realpathSync(parent), basename(path)) : resolve(path);
}

function sameSnapshot(first: BigIntStats, second: BigIntStats) {
  return first.dev === second.dev && first.ino === second.ino && first.size === second.size &&
    first.mtimeNs === second.mtimeNs && first.ctimeNs === second.ctimeNs;
}

async function copyStandaloneBackup(backup: string, staged: string, activeDatabase?: string) {
  const expected = lstatSync(backup, { bigint: true, throwIfNoEntry: false });
  if (!expected?.isFile()) throw new Error('Expected a regular backup file');
  const sourcePath = realpathSync(backup);
  assertNoSqliteSidecars(sourcePath);
  const source = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await source.stat({ bigint: true });
    const live = activeDatabase && statSync(activeDatabase, { bigint: true, throwIfNoEntry: false });
    if (!before.isFile() || !sameSnapshot(expected, before) || before.nlink !== 1n || (live && before.dev === live.dev && before.ino === live.ino)) {
      throw new Error('Expected a standalone backup, separate from the active database');
    }
    await pipeline(source.createReadStream({ autoClose: false }), createWriteStream(staged, { flags: 'wx', mode: 0o600 }));
    const after = lstatSync(backup, { bigint: true });
    assertNoSqliteSidecars(sourcePath);
    if (!after.isFile() || !sameSnapshot(before, after)) {
      throw new Error('The backup changed during the copy');
    }
  } finally {
    await source.close();
  }
}

function checkIntegrity(db: Database.Database) {
  return db.pragma('integrity_check', { simple: true }) === 'ok' &&
    (db.pragma('foreign_key_check') as unknown[]).length === 0;
}

function inspectSnapshot(db: Database.Database, now: number, add: AddCheck) {
  // Memberships
  const households = count(db, 'SELECT count(*) AS n FROM household');
  const withoutParent = count(db, "SELECT count(*) AS n FROM household h WHERE NOT EXISTS (SELECT 1 FROM active_membership m WHERE m.household_id = h.id AND m.role = 'parent')");
  add('parents', withoutParent ? 'FAIL' : 'PASS', withoutParent ? `${withoutParent} household(s) have no active parent` : `${households} household(s), each with at least one active parent`);
  const active = count(db, 'SELECT count(*) AS n FROM active_membership');
  const disabled = count(db, 'SELECT count(*) AS n FROM membership WHERE disabled_at IS NOT NULL');
  add('memberships', 'PASS', `${active} active and ${disabled} disabled membership(s) restored (disabled members stay disabled)`);

  // Chore / earning / payout invariants
  const missing = count(db, "SELECT count(*) AS n FROM chore c WHERE c.status = 'verified' AND c.reward_cents > 0 AND NOT EXISTS (SELECT 1 FROM earning e WHERE e.chore_id = c.id)");
  const unverified = count(db, "SELECT count(*) AS n FROM earning e JOIN chore c ON c.id = e.chore_id WHERE c.status <> 'verified'");
  add('earnings', missing || unverified ? 'FAIL' : 'PASS', missing || unverified
    ? `${missing} verified rewarded chore(s) lack an earning; ${unverified} earning(s) belong to unverified chores`
    : 'every verified rewarded chore has exactly one earning and no earning belongs to an unverified chore');
  const kids = db.prepare("SELECT household_id AS h, user_id AS k FROM membership WHERE role = 'kid'").all() as { h: string; k: string }[];
  const negative = kids.filter(kid => balance(db, kid.h, kid.k).owed < 0).length;
  add('balances', negative ? 'WARN' : 'PASS', negative ? `${negative} child balance(s) are negative (paid exceeds earned); review before trusting the restore` : `balances computed for ${kids.length} child membership(s); none negative (amounts not shown)`);

  // Credentials a restore may bring back
  const sessionColumns = (db.prepare('PRAGMA table_info("session")').all() as { name: string }[]).map(column => column.name);
  const expiry = ['expiresAt', 'expires_at'].find(name => sessionColumns.includes(name));
  const sessions = expiry ? count(db, `SELECT count(*) AS n FROM session WHERE (typeof("${expiry}") IN ('integer','real') AND "${expiry}" > ?) OR (typeof("${expiry}") = 'text' AND "${expiry}" > ?)`, now, new Date(now).toISOString()) : 0;
  add('sessions', expiry ? (sessions ? 'WARN' : 'PASS') : 'WARN', expiry
    ? `${sessions} unexpired personal session(s) are in this snapshot and would be valid again if it became live`
    : 'could not read session expiry; assume sessions in this snapshot are valid again');
  const invitations = count(db, 'SELECT count(*) AS n FROM household_invitation WHERE consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?', now);
  add('invitations', invitations ? 'WARN' : 'PASS', `${invitations} unused, unexpired invitation link(s) are in this snapshot`);
  const devices = count(db, 'SELECT count(*) AS n FROM display_device WHERE revoked_at IS NULL AND expires_at > ?', now);
  const revoked = count(db, 'SELECT count(*) AS n FROM display_device WHERE revoked_at IS NOT NULL');
  const pending = count(db, 'SELECT count(*) AS n FROM display_pairing WHERE consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?', now);
  add('displays', devices || pending ? 'WARN' : 'PASS', `${devices} active display credential(s), ${revoked} revoked, ${pending} unredeemed pairing code(s) are in this snapshot`);
}

export async function rehearseRestore(options: RehearsalOptions): Promise<Rehearsal> {
  const checks: Check[] = [];
  const add: AddCheck = (id, status, message) => { checks.push({ id, status, message }); };
  const done = () => ({ ok: !checks.some(check => check.status === 'FAIL'), checks });
  const { backup, destination, activeDatabase } = options;
  if (!isAbsolute(backup) || hasDotDot(backup)) { add('backup', 'FAIL', 'backup path must be absolute without ".." segments'); return done(); }
  if (activeDatabase !== undefined && (!isAbsolute(activeDatabase) || hasDotDot(activeDatabase))) {
    add('backup', 'FAIL', 'active database path must be absolute without ".." segments');
    return done();
  }

  let snapshot: ReturnType<typeof stageSqliteSnapshot>;
  try {
    if (!isAbsolute(destination) || hasDotDot(destination) ||
        (activeDatabase && canonicalDestination(activeDatabase) === canonicalDestination(destination))) {
      throw new Error('Unsafe restore destination');
    }
    snapshot = stageSqliteSnapshot(destination);
  } catch {
    add('destination', 'FAIL', 'choose a new absolute path in a private directory, separate from the live database and any SQLite companion files');
    return done();
  }

  try {
    try {
      await copyStandaloneBackup(backup, snapshot.path, activeDatabase);
    } catch {
      add('backup', 'FAIL', 'could not copy an unchanged standalone backup. Use a completed backup file separate from the active database and its SQLite companion files');
      return done();
    }

    let db: Database.Database | undefined;
    try {
      try {
        db = new Database(snapshot.path, { fileMustExist: true });
        if (!checkIntegrity(db)) {
          add('integrity', 'FAIL', 'SQLite integrity or foreign key checks failed');
          return done();
        }
      } catch {
        add('integrity', 'FAIL', 'the restored copy could not be verified as a SQLite database');
        return done();
      }

      try {
        // Check the original snapshot before migration can create these tables.
        const tables = count(db, "SELECT count(*) AS n FROM sqlite_schema WHERE type = 'table' AND name IN ('user', 'account', 'session', 'household', 'membership')");
        if (tables !== 5 || count(db, 'SELECT count(*) AS n FROM household') === 0) throw new Error('Missing household data');
      } catch {
        add('schema', 'FAIL', 'the backup is missing Fleck Home Hub household or account data');
        return done();
      }

      if (options.migrate) {
        try {
          db.pragma('foreign_keys = ON');
          await migrate(db);
          if (!checkIntegrity(db)) throw new Error('Integrity checks failed after migration');
          add('migration', 'PASS', 'migrations and integrity checks passed on the restored copy');
        } catch {
          add('migration', 'FAIL', 'the staged restore failed migration or integrity checks');
          return done();
        }
      } else add('migration', 'WARN', 'migrations not applied (re-run with --migrate to rehearse an upgrade)');

      try {
        if (db.pragma('journal_mode = DELETE', { simple: true }) !== 'delete') throw new Error('Could not make the copy standalone');
        inspectSnapshot(db, options.now ?? Date.now(), add);
        add('integrity', 'PASS', 'integrity_check and foreign_key_check passed on the restored copy');
      } catch {
        add('schema', 'FAIL', 'could not verify the restored household schema or data');
      }
    } finally { db?.close(); }

    if (done().ok) {
      try {
        snapshot.publish();
        add('destination', 'PASS', 'published the verified copy as a new owner-only file');
      } catch {
        add('destination', 'FAIL', 'could not publish the copy. Choose a fresh destination and check its SQLite companion files');
      }
    }
    return done();
  } finally {
    snapshot.cleanup();
  }
}

export function formatRehearsal(report: Rehearsal, destination: string): string {
  const lines = report.checks.map(check => `[${check.status}] ${check.id}: ${check.message}`);
  lines.push('', report.ok ? 'Rehearsal result: structural checks passed. This does not prove the application starts on the copy or that anyone can sign in; see the manual steps.' : 'Rehearsal result: FAILED. Nothing live was changed.');
  lines.push('', 'WARNING: restoring an older snapshot brings back previously valid sessions, unused invitation links and paired-display credentials, and forgets later revocations and member disabling. After any real restore, review Household members, Household displays and invitations in the app, revoke what should not be active, and consider rotating AUTH_SECRET to end every session.');
  if (report.ok) lines.push('', `Cleanup (synthetic or rehearsal artifacts only): stop anything using the copy, then remove ${destination} and its SQLite companion files yourself.`);
  return lines.join('\n') + '\n';
}

async function main() {
  const args = process.argv.slice(2);
  const options: Partial<RehearsalOptions> = {}; let configFile: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--backup' && args[i + 1]) options.backup = args[++i];
    else if (args[i] === '--destination' && args[i + 1]) options.destination = args[++i];
    else if (args[i] === '--config-file' && args[i + 1]) configFile = args[++i];
    else if (args[i] === '--migrate') options.migrate = true;
    else { console.error('Usage: restore-rehearsal.ts --backup PATH --destination NEW_PATH [--config-file PATH] [--migrate]'); process.exit(64); }
  }
  if (!options.backup || !options.destination) { console.error('Usage: restore-rehearsal.ts --backup PATH --destination NEW_PATH [--config-file PATH] [--migrate]'); process.exit(64); }
  if (configFile) {
    try {
      const { errors, values } = parseEnvFile(readFileSync(configFile, 'utf8'));
      if (errors.length || !values.DATABASE_PATH) throw new Error('Missing valid database path');
      options.activeDatabase = values.DATABASE_PATH;
    } catch {
      console.error('Could not read a valid restore configuration.');
      process.exit(64);
    }
  } else if (process.env.DATABASE_PATH) options.activeDatabase = process.env.DATABASE_PATH;
  const report = await rehearseRestore(options as RehearsalOptions);
  process.stdout.write(formatRehearsal(report, options.destination));
  process.exit(report.ok ? 0 : 1);
}
if (process.argv[1]?.endsWith('restore-rehearsal.ts')) await main();
