import Database from 'better-sqlite3';
import { readIdentityConfig } from '../src/lib/server/config';
import { migrate } from '../src/lib/server/identity';
try {
  const config = readIdentityConfig(process.env);
  const db = new Database(config.dbPath, { fileMustExist: true });
  try { db.pragma('foreign_keys = ON'); await migrate(db); }
  finally { db.close(); }
  console.log('Migrations completed.');
} catch {
  console.error('Migration failed. Keep your backup and inspect the database before retrying.');
  process.exitCode = 1;
}
