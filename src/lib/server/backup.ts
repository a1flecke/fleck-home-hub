import Database from 'better-sqlite3';
import { stageSqliteSnapshot } from './sqlite-snapshot';

export async function backupDatabase(source: string, destination: string) {
  const snapshot = stageSqliteSnapshot(destination);
  try {
    const db = new Database(source, { readonly: true, fileMustExist: true });
    try { await db.backup(snapshot.path); }
    finally { db.close(); }

    const copy = new Database(snapshot.path, { fileMustExist: true });
    try {
      if (copy.pragma('journal_mode = DELETE', { simple: true }) !== 'delete') {
        throw new Error('Backup could not be made standalone');
      }
      if (copy.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Backup integrity check failed');
    } finally { copy.close(); }
    snapshot.publish();
  } finally { snapshot.cleanup(); }
}
