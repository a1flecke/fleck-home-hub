import { closeSync, openSync } from 'node:fs';
import Database from 'better-sqlite3';

export async function backupDatabase(source: string, destination: string) {
  const db = new Database(source, { readonly: true, fileMustExist: true });
  try {
    const fd = openSync(destination, 'wx', 0o600);
    closeSync(fd);
    await db.backup(destination);
    const copy = new Database(destination, { readonly: true, fileMustExist: true });
    try {
      if (copy.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Backup integrity check failed');
    } finally { copy.close(); }
  } finally { db.close(); }
}
