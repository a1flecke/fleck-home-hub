import { closeSync, lstatSync, openSync, type Stats } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { WriteStream } from 'node:tty';
import Database from 'better-sqlite3';
import { readIdentityConfig } from '../src/lib/server/config';
import { migrate } from '../src/lib/server/identity';
import { issueSetupCode, needsInitialSetup } from '../src/lib/server/setup-code';
import { readPrivateConfig } from './pilot/envfile.mjs';

function isPrivate(file: Stats) {
  return (file.mode & 0o077) === 0 && file.uid === process.getuid?.();
}

async function prepareDatabase(dbPath: string, mode: 'prepare' | 'if-needed' | 'issue' | 'status') {
  const folder = lstatSync(dirname(dbPath));
  if (!isAbsolute(dbPath) || !folder.isDirectory() || !isPrivate(folder)) throw new Error('Private database folder required');
  if (mode === 'prepare' || mode === 'issue') {
    try { closeSync(openSync(dbPath, 'wx', 0o600)); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  const file = lstatSync(dbPath);
  if (!file.isFile() || !isPrivate(file)) throw new Error('Private database file required');
  const db = new Database(dbPath, { fileMustExist: true, timeout: 5_000, readonly: mode === 'status' });
  try {
    db.pragma('foreign_keys = ON');
    let configured = false;
    // Preserve populated databases and the permanent closure marker, including
    // when an operator reruns the installer on a household with no active users.
    for (const table of ['household', 'user', 'initial_setup']) {
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)) continue;
      const where = table === 'initial_setup' ? ' WHERE consumed_at IS NOT NULL' : '';
      if (db.prepare('SELECT 1 FROM ' + table + where + ' LIMIT 1').get()) configured = true;
    }
    if (mode === 'status') return configured ? 'configured' : 'pending';
    if (configured) {
      if (mode === 'issue') throw new Error('Initial setup is closed');
      return;
    }
    if (mode !== 'if-needed') await migrate(db);
    if (mode === 'prepare') return;
    if (!needsInitialSetup(db)) {
      if (mode === 'issue') throw new Error('Initial setup is closed');
      return;
    }
    return issueSetupCode(db);
  } finally { db.close(); }
}

async function main(args: string[]) {
  const mode = args[2] === '--prepare' ? 'prepare' :
    args[2] === '--if-needed' ? 'if-needed' : args[2] === '--status' ? 'status' : 'issue';
  if (args.length > 0 && (args[0] !== '--config-file' || args.length !== (mode === 'issue' ? 2 : 3))) {
    throw new Error('Invalid setup arguments');
  }
  const config = readIdentityConfig(args.length ? readPrivateConfig(args[1]) : process.env);
  if (mode === 'prepare' || mode === 'status') {
    const result = await prepareDatabase(config.dbPath, mode);
    if (mode === 'status') console.log(result);
    return;
  }
  // Only the controlling terminal may receive a setup credential.
  const terminal = new WriteStream(openSync('/dev/tty', 'w'));
  try {
    if (!terminal.isTTY) throw new Error('Private terminal required');
    const code = await prepareDatabase(config.dbPath, mode);
    if (!code) return;
    await new Promise<void>((resolve, reject) => {
      terminal.write('Enter this one-time setup code within 30 minutes.\n' + code + '\n', error => {
        if (error) reject(error);
        else resolve();
      });
    });
  } finally { terminal.end(); }
}

try { await main(process.argv.slice(2)); } catch {
  console.error('Setup code unavailable. Use a private terminal and service configuration. A configured household cannot be reopened.');
  process.exitCode = 1;
}
