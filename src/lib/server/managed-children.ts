import { hashPassword } from 'better-auth/crypto';
import type Database from 'better-sqlite3';
import type { createAuth } from './identity';
import { runOnboardingProvisioning } from './onboarding';

const usernamePattern = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const internalDomain = '@children.fleck.invalid';
type Config = { secret: string; origin: string };

export function isManagedEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith(internalDomain);
}

function requireParent(db: Database.Database, actor: string, householdId: string) {
  if (!db.prepare("SELECT 1 FROM active_membership WHERE user_id = ? AND household_id = ? AND role = 'parent'").get(actor, householdId)) {
    throw new Error('Not authorized');
  }
}

function childName(name: string) {
  const clean = name.trim();
  if (!clean || clean.length > 100) throw new Error('Enter a name of up to 100 characters.');
  return clean;
}

function credentials(username: string, password: string) {
  const normalized = username.trim().toLowerCase();
  if (!usernamePattern.test(normalized)) throw new Error('Use 3 to 32 letters, numbers, dots, underscores or dashes for the username.');
  if (password.length < 12 || password.length > 128) throw new Error('Choose a password with 12 to 128 characters.');
  return normalized;
}

export async function addManagedChild(db: Database.Database, config: Config, actor: string, householdId: string, input: { name: string; username: string; password: string }, requestId?: string) {
  requireParent(db, actor, householdId);
  const name = childName(input.name);
  const username = input.username.trim() || input.password ? credentials(input.username, input.password) : null;
  if (requestId && !/^[a-f0-9-]{36}$/.test(requestId)) throw new Error('Invalid request');
  const prior = () => requestId && db.prepare('SELECT user_id AS id FROM managed_child WHERE request_id = ? AND household_id = ? AND created_by = ?')
    .get(requestId, householdId, actor) as { id: string } | undefined;
  const previous = prior();
  if (previous) return previous.id;
  try {
    const { userId } = await runOnboardingProvisioning(db, config, { kind: 'child', actor, householdId, requestId: requestId ?? null, input: { name, username, password: input.password } });
    return userId;
  } catch (error) {
    requireParent(db, actor, householdId);
    const repeated = prior();
    if (repeated) return repeated.id;
    throw error;
  }
}

export function listManagedChildren(db: Database.Database, actor: string, householdId: string) {
  requireParent(db, actor, householdId);
  return db.prepare(`
    SELECT c.user_id AS id, u.name, c.username FROM managed_child c JOIN user u ON u.id = c.user_id
    JOIN active_membership m ON m.user_id = c.user_id AND m.household_id = c.household_id AND m.role = 'kid'
    WHERE c.household_id = ? ORDER BY u.name, c.user_id
  `).all(householdId) as { id: string; name: string; username: string | null }[];
}

function requireManagedChild(db: Database.Database, householdId: string, child: string) {
  if (!db.prepare(`
    SELECT 1 FROM managed_child c JOIN active_membership m
      ON m.user_id = c.user_id AND m.household_id = c.household_id AND m.role = 'kid'
    WHERE c.user_id = ? AND c.household_id = ?
  `).get(child, householdId)) throw new Error('Child profile unavailable');
}

export function renameManagedChild(db: Database.Database, actor: string, householdId: string, child: string, name: string) {
  const clean = childName(name);
  db.transaction(() => {
    requireParent(db, actor, householdId);
    requireManagedChild(db, householdId, child);
    db.prepare('UPDATE user SET name = ?, updatedAt = ? WHERE id = ?').run(clean, new Date().toISOString(), child);
  }).immediate();
}

export async function setChildSignIn(db: Database.Database, actor: string, householdId: string, child: string, username: string, password: string) {
  requireParent(db, actor, householdId);
  requireManagedChild(db, householdId, child);
  const normalized = credentials(username, password);
  const hash = await hashPassword(password);
  db.transaction(() => {
    requireParent(db, actor, householdId);
    requireManagedChild(db, householdId, child);
    const now = new Date().toISOString();
    const account = db.prepare("UPDATE account SET password = ?, updatedAt = ? WHERE userId = ? AND providerId = 'credential'").run(hash, now, child);
    if (account.changes !== 1) throw new Error('Child sign-in unavailable');
    db.prepare('UPDATE managed_child SET username = ?, version = version + 1 WHERE user_id = ?').run(normalized, child);
    db.prepare('DELETE FROM session WHERE userId = ?').run(child);
  }).immediate();
}

export async function signInChild(db: Database.Database, auth: ReturnType<typeof createAuth>, origin: string, headers: Headers, username: string, password: string) {
  if (headers.get('origin') !== origin) return new Response(null, { status: 403 });
  const normalized = username.trim().toLowerCase();
  if (!usernamePattern.test(normalized) || !password || password.length > 128) return new Response(null, { status: 401 });
  const findChild = () => db.prepare(`
    SELECT u.email, c.version FROM managed_child c JOIN user u ON u.id = c.user_id
    JOIN active_membership m ON m.user_id = c.user_id AND m.household_id = c.household_id AND m.role = 'kid'
    WHERE c.username = ?
  `).get(normalized) as { email: string; version: number } | undefined;
  const child = findChild();
  // Use the same Better Auth route and limiter for known and unknown usernames.
  const forwarded = new Headers({ 'content-type': 'application/json', origin, 'user-agent': headers.get('user-agent') ?? '' });
  const response = await auth.handler(new Request(new URL('/api/auth/sign-in/email', origin), {
    method: 'POST',
    headers: forwarded,
    body: JSON.stringify({ email: child?.email ?? 'unavailable' + internalDomain, password })
  }));
  if (!response.ok) return new Response(null, { status: response.status === 429 ? 429 : 401 });
  const result = await response.json() as { token?: string };
  const current = findChild();
  if (!child || current?.email !== child.email || current.version !== child.version) {
    // A reset or disable may have landed while Better Auth verified the password.
    // The session is still private and must never reach the browser.
    if (result.token) db.prepare('DELETE FROM session WHERE token = ?').run(result.token);
    return new Response(null, { status: 401 });
  }
  const output = new Headers();
  for (const cookie of response.headers.getSetCookie()) output.append('set-cookie', cookie);
  return new Response(null, { status: 204, headers: output });
}
