// Safe, repeatable restore rehearsal. It copies a backup file into a NEW private
// location, checks SQLite integrity, optionally applies migrations to the copy,
// and reports structural invariants as counts only. It never opens the active
// database or the backup, never overwrites anything, and prints no emails,
// names, ids, tokens, secrets or amounts.
import { chmodSync, constants, copyFileSync, existsSync, lstatSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { migrate } from '../../src/lib/server/identity';
import { balance } from '../../src/lib/server/payouts';
import { parseEnvFile } from './envfile.mjs';

export type Status = 'PASS' | 'WARN' | 'FAIL';
export interface Check { id: string; status: Status; message: string }
export interface Rehearsal { ok: boolean; checks: Check[] }
export interface RehearsalOptions { backup: string; destination: string; activeDatabase?: string; now?: number; migrate?: boolean }

const hasDotDot = (path: string) => path.split('/').includes('..');
const count = (db: Database.Database, sql: string, ...params: unknown[]) => (db.prepare(sql).get(...params) as { n: number }).n;

export async function rehearseRestore(options: RehearsalOptions): Promise<Rehearsal> {
  const checks: Check[] = [];
  const add = (id: string, status: Status, message: string) => { checks.push({ id, status, message }); };
  const done = () => ({ ok: !checks.some(check => check.status === 'FAIL'), checks });
  const { backup, destination } = options;
  const now = options.now ?? Date.now();

  // Guards: never write anywhere but one brand-new, private file.
  if (!isAbsolute(backup) || hasDotDot(backup)) { add('backup', 'FAIL', 'backup path must be absolute without ".." segments'); return done(); }
  const backupStat = existsSync(backup) ? lstatSync(backup) : undefined;
  if (!backupStat || !backupStat.isFile()) { add('backup', 'FAIL', 'backup must be an existing regular file'); return done(); }
  if (!isAbsolute(destination) || hasDotDot(destination)) { add('destination', 'FAIL', 'destination must be an absolute path without ".." segments'); return done(); }
  if (resolve(destination) === resolve(backup)) { add('destination', 'FAIL', 'destination is the backup itself'); return done(); }
  if (options.activeDatabase && [options.activeDatabase, `${options.activeDatabase}-wal`, `${options.activeDatabase}-shm`].some(path => resolve(path) === resolve(destination))) {
    add('destination', 'FAIL', 'destination is the active database; restores never overwrite it'); return done();
  }
  if (existsSync(destination) || (() => { try { lstatSync(destination); return true; } catch { return false; } })()) { add('destination', 'FAIL', 'destination already exists; choose a new path'); return done(); }
  const parent = dirname(destination);
  const parentStat = existsSync(parent) ? statSync(parent) : undefined;
  if (!parentStat || !parentStat.isDirectory()) { add('destination', 'FAIL', 'destination directory does not exist'); return done(); }
  if ((parentStat.mode & 0o077) !== 0) { add('destination', 'FAIL', 'destination directory must be private (chmod 700)'); return done(); }

  copyFileSync(backup, destination, constants.COPYFILE_EXCL);
  chmodSync(destination, 0o600);
  add('destination', 'PASS', 'copied the backup into a new owner-only file');

  let db: Database.Database | undefined;
  try {
    try {
      db = new Database(destination, { fileMustExist: true });
      const integrity = db.pragma('integrity_check', { simple: true });
      const foreignKeys = db.pragma('foreign_key_check') as unknown[];
      if (integrity !== 'ok') { add('integrity', 'FAIL', 'SQLite integrity_check failed on the restored copy'); return done(); }
      if (foreignKeys.length) { add('integrity', 'FAIL', 'SQLite foreign_key_check found violations'); return done(); }
      add('integrity', 'PASS', 'integrity_check and foreign_key_check passed on the restored copy');
    } catch { add('integrity', 'FAIL', 'the restored copy could not be opened as a SQLite database'); return done(); }

    if (options.migrate) {
      try { db.pragma('foreign_keys = ON'); await migrate(db); add('migration', 'PASS', 'migrations applied cleanly to the restored copy'); }
      catch { add('migration', 'FAIL', 'migrating the restored copy failed; keep the backup, preserve this copy for inspection and do not migrate the live database'); return done(); }
    } else add('migration', 'WARN', 'migrations not applied (re-run with --migrate to rehearse an upgrade)');

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
    const negative = kids.filter(kid => balance(db!, kid.h, kid.k).owed < 0).length;
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
  } finally { db?.close(); }
  return done();
}

export function formatRehearsal(report: Rehearsal, destination: string): string {
  const lines = report.checks.map(check => `[${check.status}] ${check.id}: ${check.message}`);
  lines.push('', report.ok ? 'Rehearsal result: structural checks passed. This does not prove the application starts on the copy or that anyone can sign in; see the manual steps.' : 'Rehearsal result: FAILED. Nothing live was changed.');
  lines.push('', 'WARNING: restoring an older snapshot brings back previously valid sessions, unused invitation links and paired-display credentials, and forgets later revocations and member disabling. After any real restore, review Household members, Household displays and invitations in the app, revoke what should not be active, and consider rotating AUTH_SECRET to end every session.');
  lines.push('', `Cleanup (synthetic or rehearsal artifacts only): stop anything using the copy, then remove ${destination} and any ${destination}-wal / ${destination}-shm files yourself. This tool never deletes files.`);
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
  if (configFile) options.activeDatabase = parseEnvFile(readFileSync(configFile, 'utf8')).values.DATABASE_PATH;
  else if (process.env.DATABASE_PATH) options.activeDatabase = process.env.DATABASE_PATH;
  const report = await rehearseRestore(options as RehearsalOptions);
  process.stdout.write(formatRehearsal(report, options.destination));
  process.exit(report.ok ? 0 : 1);
}
if (process.argv[1]?.endsWith('restore-rehearsal.ts')) await main();
