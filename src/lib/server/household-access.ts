import type Database from 'better-sqlite3';

export type HouseholdRole = 'parent' | 'kid';
export type HouseholdMember = { id: string; name: string; role: HouseholdRole; disabledAt: number | null; disabledByName: string | null };

/**
 * The only module that reads or writes the `membership` table directly. Every other
 * reader uses the `active_membership` view, so a disabled member is never authorized
 * by a missed `disabled_at` check. `tests/architecture/membership-access.test.ts` pins this.
 */
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
 * Soft-disables one member of one household. History, ledger rows and audit actors are
 * untouched; the global account and the member's other households are unaffected.
 * Disabling is permanent in the application: there is deliberately no re-enable path yet.
 * Self-disable is refused. The actor is re-checked inside a writer transaction, so two
 * parents disabling each other serialize and the second is rejected as no longer active.
 */
export function disableMember(db: Database.Database, actorId: string, householdId: string, targetId: string): { changed: boolean } {
  try {
    return db.transaction(() => {
      if (activeMembership(db, actorId, householdId)?.role !== 'parent') throw new MemberDisableError('not-authorized');
      if (actorId === targetId) throw new MemberDisableError('self');
      const target = db.prepare('SELECT role, disabled_at AS disabledAt FROM membership WHERE user_id = ? AND household_id = ?').get(targetId, householdId) as { role: HouseholdRole; disabledAt: number | null } | undefined;
      if (!target) throw new MemberDisableError('unavailable');
      if (target.disabledAt !== null) return { changed: false };
      const now = Date.now();
      db.prepare('UPDATE membership SET disabled_at = ?, disabled_by = ? WHERE user_id = ? AND household_id = ? AND disabled_at IS NULL').run(now, actorId, targetId, householdId);
      // Links the disabled member issued are unusable at redemption anyway; revoking makes that visible.
      db.prepare('UPDATE household_invitation SET revoked_at = ? WHERE household_id = ? AND created_by = ? AND consumed_at IS NULL AND revoked_at IS NULL').run(now, householdId, targetId);
      return { changed: true };
    }).immediate();
  } catch (error) {
    if (error instanceof MemberDisableError) throw error;
    if (error instanceof Error && error.message.includes('keep an active parent')) throw new MemberDisableError('last-parent');
    throw error;
  }
}
