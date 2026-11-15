import { createHash, randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';

const setupCodeLifetime = 30 * 60 * 1000;

export function setupCodeHash(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export function needsInitialSetup(db: Database.Database): boolean {
  return Boolean(db.prepare(`
    SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM household)
      AND NOT EXISTS (SELECT 1 FROM user)
      AND NOT EXISTS (SELECT 1 FROM initial_setup WHERE consumed_at IS NOT NULL)
  `).get());
}

export function issueSetupCode(db: Database.Database): string {
  const code = randomBytes(32).toString('base64url');
  db.transaction(() => {
    if (!needsInitialSetup(db)) throw new Error('Initial setup is closed');
    db.prepare(`
      INSERT INTO initial_setup (id, code_hash, expires_at) VALUES (1, ?, ?)
      ON CONFLICT (id) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at
    `).run(setupCodeHash(code), Date.now() + setupCodeLifetime);
  }).immediate();
  return code;
}

export function usableSetupCode(db: Database.Database, hash: string): boolean {
  return needsInitialSetup(db) && Boolean(db.prepare(`
    SELECT 1 FROM initial_setup WHERE id = 1 AND code_hash = ? AND expires_at > ? AND consumed_at IS NULL
  `).get(hash, Date.now()));
}
