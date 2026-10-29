import Database from 'better-sqlite3';
import { readIdentityConfig } from './config';
import { createAuth } from './identity';

let services: { db: Database.Database; auth: ReturnType<typeof createAuth>; origin: string } | undefined;
export function getIdentityServices() {
  if (!services) {
    const config = readIdentityConfig(process.env);
    const db = new Database(config.dbPath, { fileMustExist: true });
    db.pragma('foreign_keys = ON');
    services = { db, auth: createAuth(db, config), origin: config.origin };
  }
  return services;
}
