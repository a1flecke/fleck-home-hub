import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate as migrateDrizzle } from 'drizzle-orm/better-sqlite3/migrator';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { authorize, type Principal } from './authorization';

type Options = { secret: string; origin: string; allowSignUp?: boolean };

function options(database: Database.Database, config: Options) {
  return {
    database,
    secret: config.secret,
    baseURL: config.origin,
    emailAndPassword: { enabled: true, disableSignUp: !config.allowSignUp },
    // Do not trust client-supplied proxy headers until a verified proxy boundary exists.
    advanced: { useSecureCookies: config.origin.startsWith('https://'), ipAddress: { ipAddressHeaders: [] as string[] } }
  };
}

export function createAuth(database: Database.Database, config: Options) {
  return betterAuth(options(database, config));
}

function verifyAuthSchema(database: Database.Database, sql: string) {
  const expected = new Database(':memory:');
  try {
    expected.exec(sql);
    for (const table of ['user', 'session', 'account', 'verification']) {
      const describe = (db: Database.Database) => {
        const columns = db.prepare(`PRAGMA table_info("${table}")`).all();
        const foreignKeys = db.prepare(`PRAGMA foreign_key_list("${table}")`).all();
        const indexes = db.prepare(`PRAGMA index_list("${table}")`).all() as { name: string; unique: number; origin: string; partial: number }[];
        const unique = indexes.filter((index) => index.unique).map((index) => {
          const name = index.name.replaceAll('"', '""');
          return db.prepare(`PRAGMA index_info("${name}")`).all().map((column: unknown) => (column as { name: string }).name);
        }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
        return JSON.stringify({ columns, foreignKeys, unique });
      };
      if (describe(database) !== describe(expected)) throw new Error(`Authentication schema for ${table} differs from the reviewed migration`);
    }
  } finally {
    expected.close();
  }
}

export async function migrate(database: Database.Database) {
  const config = options(database, { secret: 'migration-only-not-used-to-sign-any-session', origin: 'http://localhost:3000' });
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('user', 'session', 'account', 'verification')").all();
  if (tables.length !== 0 && tables.length !== 4) throw new Error('Incomplete authentication schema; review and restore before migration');
  if (tables.length === 4) {
    const existing = await getMigrations(config);
    if (existing.toBeCreated.length || existing.toBeAdded.length) throw new Error('Authentication schema requires a reviewed migration');
  }
  const sql = readFileSync('drizzle/auth/0001_better_auth.sql', 'utf8');
  database.exec('BEGIN IMMEDIATE');
  try {
    database.exec(sql);
    verifyAuthSchema(database, sql);
    const plan = await getMigrations(config);
    if (plan.toBeCreated.length || plan.toBeAdded.length) throw new Error('Authentication schema requires a reviewed migration');
    database.exec('CREATE TABLE IF NOT EXISTS __auth_migrations (version integer PRIMARY KEY NOT NULL)');
    database.prepare('INSERT OR IGNORE INTO __auth_migrations (version) VALUES (1)').run();
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  // Drizzle manages its own transaction; keep it separate so SQLite does not
  // attempt to nest BEGIN statements. Both migration steps are repeatable.
  migrateDrizzle(drizzle(database), { migrationsFolder: 'drizzle' });
}

export async function authorizeRequest(auth: ReturnType<typeof createAuth>, database: Database.Database, headers: Headers, householdId: string, action: 'read' | 'manage') {
  const session = await auth.api.getSession({ headers });
  if (!session) return false;
  const row = database.prepare('SELECT household_id AS householdId, role FROM membership WHERE user_id = ? AND household_id = ?').get(session.user.id, householdId) as Principal | undefined;
  return authorize(row ?? null, householdId, action);
}

export async function parentAction(auth: ReturnType<typeof createAuth>, database: Database.Database, request: Request, householdId: string, trustedOrigin: string) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response(null, { status: 401 });
  if (request.headers.get('origin') !== trustedOrigin) return new Response(null, { status: 403 });
  if (!await authorizeRequest(auth, database, request.headers, householdId, 'manage')) return new Response(null, { status: 403 });
  return new Response(null, { status: 204 });
}
