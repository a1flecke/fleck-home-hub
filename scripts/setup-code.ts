import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, type Stats } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { WriteStream } from 'node:tty';
import Database from 'better-sqlite3';
import { readIdentityConfig } from '../src/lib/server/config';
import { migrate } from '../src/lib/server/identity';
import { issueSetupCode } from '../src/lib/server/setup-code';
import { parseEnvFile } from './pilot/envfile.mjs';

function isPrivate(file: Stats) {
  return (file.mode & 0o077) === 0;
}

function configSource(args: string[]) {
  if (args.length === 0) return process.env;
  const [flag, path] = args;
  if (args.length !== 2 || flag !== '--config-file' || !isAbsolute(path)) throw new Error('Expected an absolute config file path');
  const file = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(file);
    if (!stat.isFile() || !isPrivate(stat) || stat.uid !== process.getuid?.()) throw new Error('Private configuration file required');
    const parsed = parseEnvFile(readFileSync(file, 'utf8'));
    if (parsed.errors.length) throw new Error('Invalid configuration file');
    return parsed.values;
  } finally { closeSync(file); }
}

try {
  // Use the controlling terminal directly. A redirected console or service log
  // must never receive a setup credential.
  const terminal = new WriteStream(openSync('/dev/tty', 'w'));
  if (!terminal.isTTY) throw new Error('Private terminal required');
  try {
    const config = readIdentityConfig(configSource(process.argv.slice(2)));
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
  console.error('A setup code could not be created. Use a private host terminal, private database directory and a private --config-file or service environment. Setup closes after the first household is created.');
  process.exitCode = 1;
}
