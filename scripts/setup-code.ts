import { closeSync, openSync, type Stats, lstatSync } from 'node:fs';
import { dirname } from 'node:path';
import { WriteStream } from 'node:tty';
import Database from 'better-sqlite3';
import { readIdentityConfig } from '../src/lib/server/config';
import { migrate } from '../src/lib/server/identity';
import { issueSetupCode } from '../src/lib/server/setup-code';

function isPrivate(file: Stats) {
  return (file.mode & 0o077) === 0;
}

try {
  // Use the controlling terminal directly. A redirected console or service log
  // must never receive a setup credential.
  const terminal = new WriteStream(openSync('/dev/tty', 'w'));
  if (!terminal.isTTY) throw new Error('Private terminal required');
  try {
    const config = readIdentityConfig(process.env);
    const folder = lstatSync(dirname(config.dbPath));
    if (!folder.isDirectory() || !isPrivate(folder)) throw new Error('Private database folder required');
    try {
      closeSync(openSync(config.dbPath, 'wx', 0o600));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const file = lstatSync(config.dbPath);
    if (!file.isFile() || !isPrivate(file)) throw new Error('Private database file required');
    const db = new Database(config.dbPath, { fileMustExist: true });
    try {
      db.pragma('foreign_keys = ON');
      // Do not upgrade or change a previously configured database when an
      // operator requests setup by mistake.
      for (const table of ['household', 'user']) {
        if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) &&
            db.prepare('SELECT 1 FROM ' + table + ' LIMIT 1').get()) throw new Error('Initial setup is closed');
      }
      await migrate(db);
      const code = issueSetupCode(db);
      await new Promise<void>((resolve, reject) => {
        terminal.write('Open Fleck Home Hub and enter this setup code within 30 minutes.\n' + code + '\n', error => {
          if (error) reject(error);
          else resolve();
        });
      });
    } finally { db.close(); }
  } finally { terminal.end(); }
} catch {
  console.error('A setup code could not be created. Use a private host terminal and database directory. Setup closes after the first household is created.');
  process.exitCode = 1;
}
