import type Database from 'better-sqlite3';
import { Worker } from 'node:worker_threads';
import workerSource from './member-disable-worker.js?raw';

export type HouseholdRole = 'parent' | 'kid';
export type HouseholdMember = { id: string; name: string; role: HouseholdRole; disabledAt: number | null; disabledByName: string | null };

export class MemberDisableError extends Error {
  constructor(readonly code: 'not-authorized' | 'self' | 'unavailable' | 'last-parent') { super(code); }
}

/** The caller's active membership in one household, or null. A valid session alone never authorizes. */
export function activeMembership(db: Database.Database, userId: string, householdId: string) {
  return db.prepare('SELECT household_id AS householdId, role FROM active_membership WHERE user_id = ? AND household_id = ?').get(userId, householdId) as { householdId: string; role: HouseholdRole } | undefined ?? null;
}

/** The caller's first active household (deterministic order); disabled households are skipped. */
export function primaryActiveMembership(db: Database.Database, userId: string) {
  return db.prepare('SELECT household_id AS householdId, role FROM active_membership WHERE user_id = ? ORDER BY household_id LIMIT 1').get(userId) as { householdId: string; role: HouseholdRole } | undefined ?? null;
}

/** All members, including disabled ones, for a household's parents only. */
export function listMembers(db: Database.Database, actorId: string, householdId: string): HouseholdMember[] {
  if (activeMembership(db, actorId, householdId)?.role !== 'parent') throw new MemberDisableError('not-authorized');
  return db.prepare(`SELECT u.id, u.name, m.role, m.disabled_at AS disabledAt, d.name AS disabledByName
    FROM membership m JOIN user u ON u.id = m.user_id LEFT JOIN user d ON d.id = m.disabled_by
    WHERE m.household_id = ? ORDER BY (m.disabled_at IS NOT NULL), m.role, u.name, u.id`).all(householdId) as HouseholdMember[];
}

/**
 * Disable one membership and end the account's existing sessions if this was
 * its final active membership. The worker owns the entire writer transaction.
 */
export async function disableMember(db: Database.Database, config: { secret: string; origin: string }, actorId: string, householdId: string, targetId: string): Promise<{ changed: boolean }> {
  if (db.memory || db.inTransaction) throw new Error('Member disabling requires a file-backed database outside an open transaction');
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerSource, {
      eval: true, env: {}, workerData: { path: db.name, config: { secret: config.secret, origin: config.origin }, actorId, householdId, targetId }, stdout: true, stderr: true
    });
    let result: unknown;
    worker.on('message', (message: unknown) => { result = message; });
    const failed = () => reject(new Error('Member access could not be disabled'));
    worker.on('error', failed);
    worker.on('exit', (code) => {
      if (code !== 0) return failed();
      if (result === 'changed' || result === 'unchanged') return resolve({ changed: result === 'changed' });
      if (result === 'not-authorized' || result === 'self' || result === 'unavailable' || result === 'last-parent') {
        return reject(new MemberDisableError(result));
      }
      failed();
    });
  });
}
