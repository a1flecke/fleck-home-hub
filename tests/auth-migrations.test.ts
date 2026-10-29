import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { getMigrations } from 'better-auth/db/migration';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate as migrateDrizzle } from 'drizzle-orm/better-sqlite3/migrator';
import { createAuth, migrate } from '../src/lib/server/identity';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrap } from '../src/lib/server/bootstrap';
import { backupDatabase } from '../src/lib/server/backup';

const secret = 'synthetic-migration-secret-only-over-32-characters';
const origin = 'http://localhost:3000';

it('records reviewed auth migrations and can run repeatedly', async () => {
  const db = new Database(':memory:');
  try {
    await migrate(db);
    await migrate(db);
    expect(db.prepare('SELECT version FROM __auth_migrations').all()).toEqual([{ version: 1 }]);
  } finally { db.close(); }
});

it('upgrades the previous auth schema without changing accounts or memberships', async () => {
  const db = new Database(':memory:');
  try {
    const legacy = await getMigrations({ database: db, secret, baseURL: origin, emailAndPassword: { enabled: true } });
    await legacy.runMigrations();
    migrateDrizzle(drizzle(db), { migrationsFolder: 'drizzle' });
    const auth = createAuth(db, { secret, origin, allowSignUp: true });
    const user = await auth.api.signUpEmail({ body: { name: 'Parent', email: 'legacy@example.test', password: 'synthetic-password-123' } });
    db.prepare('INSERT INTO household VALUES (?, ?)').run('house-a', 'Example');
    db.prepare('INSERT INTO membership VALUES (?, ?, ?)').run(user.user.id, 'house-a', 'parent');
    await migrate(db);
    expect(db.prepare('SELECT email FROM user WHERE id = ?').get(user.user.id)).toEqual({ email: 'legacy@example.test' });
    expect(db.prepare('SELECT role FROM membership WHERE user_id = ?').get(user.user.id)).toEqual({ role: 'parent' });
    expect(db.prepare('SELECT version FROM __auth_migrations').all()).toEqual([{ version: 1 }]);
  } finally { db.close(); }
});

it('fails without mutating an incompatible existing authentication schema', async () => {
  const db = new Database(':memory:');
  try {
    db.exec('CREATE TABLE user (id text PRIMARY KEY)');
    await expect(migrate(db)).rejects.toThrow();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all()).toEqual([{ name: 'user' }]);
  } finally { db.close(); }
});

it('rejects an existing schema that lacks the unique email constraint', async () => {
  const db = new Database(':memory:');
  try {
    const baseline = readFileSync('drizzle/auth/0001_better_auth.sql', 'utf8');
    db.exec(baseline.replace('"email" text not null unique', '"email" text not null'));
    await expect(migrate(db)).rejects.toThrow('Authentication schema');
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = '__auth_migrations'").get()).toBeUndefined();
  } finally { db.close(); }
});

it('recovers a synthetic account and membership from a verified backup after a failed migration', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-auth-recovery-'));
  const source = join(dir, 'source.sqlite');
  const backup = join(dir, 'backup.sqlite');
  const restored = join(dir, 'restored.sqlite');
  const password = 'synthetic-password-123';
  try {
    const householdId = await bootstrap({ dbPath: source, secret, origin }, { name: 'Parent', email: 'parent@example.test', password, household: 'Synthetic' });
    await backupDatabase(source, backup);
    const broken = new Database(source);
    try {
      broken.exec('ALTER TABLE user ADD COLUMN unexpected TEXT');
      await expect(migrate(broken)).rejects.toThrow('Authentication schema');
    } finally { broken.close(); }
    copyFileSync(backup, restored);
    const db = new Database(restored);
    try {
      await migrate(db);
      const auth = createAuth(db, { secret, origin });
      const result = await auth.api.signInEmail({ body: { email: 'parent@example.test', password } });
      expect(db.prepare('SELECT role FROM membership WHERE user_id = ? AND household_id = ?').get(result.user.id, householdId)).toEqual({ role: 'parent' });
    } finally { db.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
