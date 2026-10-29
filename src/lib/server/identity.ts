import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate as migrateDrizzle } from 'drizzle-orm/better-sqlite3/migrator';
import type Database from 'better-sqlite3';
import { authorize, type Principal } from './authorization';

type Options = { secret: string; origin: string; allowSignUp?: boolean };

function options(database: Database.Database, config: Options) {
  return {
    database,
    secret: config.secret,
    baseURL: config.origin,
    emailAndPassword: { enabled: true, disableSignUp: !config.allowSignUp },
    advanced: { useSecureCookies: config.origin.startsWith('https://') }
  };
}

export function createAuth(database: Database.Database, config: Options) {
  return betterAuth(options(database, config));
}

export async function migrate(database: Database.Database) {
  const plan = await getMigrations(options(database, { secret: 'migration-only-not-used-to-sign-any-session', origin: 'http://localhost:3000' }));
  await plan.runMigrations();
  migrateDrizzle(drizzle(database), { migrationsFolder: 'drizzle' });
}

export async function authorizeRequest(auth: ReturnType<typeof createAuth>, database: Database.Database, headers: Headers, householdId: string, action: 'read' | 'manage') {
  const session = await auth.api.getSession({ headers });
  if (!session) return false;
  const row = database.prepare('SELECT household_id AS householdId, role FROM membership WHERE user_id = ? AND household_id = ?').get(session.user.id, householdId) as Principal | undefined;
  return authorize(row ?? null, householdId, action);
}

export async function parentAction(auth: ReturnType<typeof createAuth>, database: Database.Database, request: Request, householdId: string) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response(null, { status: 401 });
  if (!await authorizeRequest(auth, database, request.headers, householdId, 'manage')) return new Response(null, { status: 403 });
  return new Response(null, { status: 204 });
}
