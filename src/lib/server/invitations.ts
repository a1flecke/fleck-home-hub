import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { Worker } from 'node:worker_threads';
import workerSource from './invitation-worker.js?raw';

type Role = 'parent' | 'kid';
type Input = { name: string; email: string; password: string };
type Config = { secret: string; origin: string };
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
let activeRedemptions = 0;

export function createInvitation(db: Database.Database, actorId: string, householdId: string, role: Role) {
  if (role !== 'parent' && role !== 'kid') throw new Error('Invalid role');
  const token = randomBytes(32).toString('base64url');
  db.transaction(() => {
    const actor = db.prepare('SELECT role FROM membership WHERE user_id = ? AND household_id = ?').get(actorId, householdId) as { role: Role } | undefined;
    if (actor?.role !== 'parent') throw new Error('Not authorized');
    db.prepare('INSERT INTO household_invitation (id, token_hash, household_id, role, created_by, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), digest(token), householdId, role, actorId, Date.now() + 7 * 24 * 60 * 60 * 1000);
  }).immediate();
  return token;
}

// A worker owns the async authentication transaction so synchronous SQLite waits
// on the HTTP event loop cannot prevent that transaction from committing.
export async function redeemInvitation(db: Database.Database, config: Config, token: string, input: Input): Promise<string> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !input.name.trim() || input.password.length < 12) throw new Error('Invalid invitation or input');
  // Reject unusable bearer tokens before spawning auth work or requesting a
  // writer lock. Redemption still rechecks authorization inside its transaction.
  const usable = db.prepare("SELECT 1 FROM household_invitation i JOIN membership m ON m.user_id = i.created_by AND m.household_id = i.household_id AND m.role = 'parent' WHERE i.token_hash = ? AND i.consumed_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > ?").get(digest(token), Date.now());
  if (!usable) throw new Error('Invalid invitation');
  if (activeRedemptions >= 2) throw new Error('Too many invitation attempts');
  activeRedemptions++;
  try { return await new Promise((resolve, reject) => {
    const worker = new Worker(workerSource, { eval: true, workerData: { path: db.name, config, token, input }, stdout: true, stderr: true });
    let result: string | undefined;
    worker.on('message', (message) => { if (typeof message === 'string') result = message; });
    worker.on('error', () => reject(new Error('Invitation could not be accepted')));
    worker.on('exit', (code) => { if (code === 0 && result) resolve(result); else reject(new Error('Invitation could not be accepted')); });
  }); } finally { activeRedemptions--; }
}

function requireParent(db: Database.Database, actorId: string, householdId: string) {
  const actor = db.prepare('SELECT role FROM membership WHERE user_id = ? AND household_id = ?').get(actorId, householdId) as { role: Role } | undefined;
  if (actor?.role !== 'parent') throw new Error('Not authorized');
}

export function listHouseholdAccess(db: Database.Database, actorId: string, householdId: string) {
  requireParent(db, actorId, householdId);
  const members = db.prepare('SELECT user.id, user.name, membership.role FROM membership JOIN user ON user.id = membership.user_id WHERE membership.household_id = ? ORDER BY user.name, user.id').all(householdId) as { id: string; name: string; role: Role }[];
  const invitations = db.prepare('SELECT id, role, expires_at AS expiresAt FROM household_invitation WHERE household_id = ? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ? ORDER BY expires_at, id').all(householdId, Date.now()) as { id: string; role: Role; expiresAt: number }[];
  return { members, invitations };
}

export function revokeInvitation(db: Database.Database, actorId: string, householdId: string, id: string) {
  db.transaction(() => {
    requireParent(db, actorId, householdId);
    const result = db.prepare('UPDATE household_invitation SET revoked_at = ? WHERE id = ? AND household_id = ? AND revoked_at IS NULL AND consumed_at IS NULL AND expires_at > ?').run(Date.now(), id, householdId, Date.now());
    if (result.changes !== 1) throw new Error('Invitation unavailable');
  }).immediate();
}
