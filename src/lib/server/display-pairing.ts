import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

/**
 * Restricted display sessions. A display is NOT a household member: it has no Better Auth
 * account, no `membership` row and no role. A parent mints a one-time pairing secret; redeeming
 * it yields an opaque display credential that `verifyDisplayCredential` accepts and nothing
 * else in the application does. Both secrets are 120/256-bit random values stored only as
 * SHA-256 digests (adequate for high-entropy secrets; no password hashing needed).
 *
 * Authority comes from the parent who paired the display. If that parent is no longer an
 * active parent of the household, the display stops working (revoked eagerly by
 * `revokeDisplayAuthorityOf` and re-checked at every verification).
 */
export const PAIRING_TTL_MS = 10 * 60 * 1000;
export const DEVICE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const MAX_PENDING_PAIRINGS = 5;
const LAST_SEEN_INTERVAL_MS = 5 * 60 * 1000;
// 32 unambiguous symbols: 256 % 32 === 0, so masking a random byte is unbiased.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SECRET_LENGTH = 24;

export class DisplayPairingError extends Error {
  constructor(readonly code: 'not-authorized' | 'invalid-label' | 'too-many' | 'invalid' | 'unavailable') { super(messages[code]); }
}
// Fixed, non-descriptive messages: a failed redemption never says why it failed.
const messages = {
  'not-authorized': 'Not authorized', 'invalid-label': 'Invalid display name', 'too-many': 'Too many pending pairings',
  invalid: 'Invalid pairing code', unavailable: 'Display unavailable'
} as const;

export type VerifiedDisplay = Readonly<{ deviceId: string; householdId: string; label: string }>;
export type DisplayStatus = 'active' | 'expired' | 'revoked';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

function requireParent(db: Database.Database, actorId: string, householdId: string) {
  const row = db.prepare("SELECT 1 FROM active_membership WHERE user_id = ? AND household_id = ? AND role = 'parent'").get(actorId, householdId);
  if (!row) throw new DisplayPairingError('not-authorized');
}

function cleanLabel(label: string) {
  const value = label.trim();
  if (!value || value.length > 60 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value)) throw new DisplayPairingError('invalid-label');
  return value;
}

function newSecret() {
  const bytes = randomBytes(SECRET_LENGTH);
  const chars = Array.from(bytes, byte => ALPHABET[byte & 31]).join('');
  return chars.match(/.{4}/g)!.join('-');
}

/** Returns the canonical compact form, or null if the input cannot be a pairing secret. */
function normalizeSecret(input: string) {
  const compact = input.toUpperCase().replace(/[\s-]/g, '');
  return compact.length === SECRET_LENGTH && [...compact].every(char => ALPHABET.includes(char)) ? compact : null;
}

/** Mints a one-time pairing secret. The plaintext is returned once and never stored. */
export function createPairing(db: Database.Database, actorId: string, householdId: string, label: string, now = Date.now()) {
  const name = cleanLabel(label);
  const secret = newSecret();
  const id = randomUUID();
  db.transaction(() => {
    requireParent(db, actorId, householdId);
    const pending = db.prepare('SELECT count(*) AS n FROM display_pairing WHERE household_id = ? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?').get(householdId, now) as { n: number };
    if (pending.n >= MAX_PENDING_PAIRINGS) throw new DisplayPairingError('too-many');
    db.prepare('INSERT INTO display_pairing (id, secret_hash, household_id, label, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, digest(secret.replaceAll('-', '')), householdId, name, actorId, now, now + PAIRING_TTL_MS);
  }).immediate();
  return { id, secret, expiresAt: now + PAIRING_TTL_MS };
}

/**
 * Consumes a pairing secret and issues the display credential in one immediate transaction.
 * The consuming UPDATE only matches an unconsumed row, so concurrent redemptions through
 * separate connections serialize on the writer lock and exactly one sees `changes === 1`;
 * `display_device.pairing_id` is also UNIQUE as a structural backstop.
 */
export function redeemPairing(db: Database.Database, secret: string, now = Date.now()) {
  const compact = normalizeSecret(secret);
  if (!compact) throw new DisplayPairingError('invalid');
  const token = randomBytes(32).toString('base64url');
  const deviceId = randomUUID();
  return db.transaction(() => {
    const pairing = db.prepare(`SELECT p.id, p.household_id AS householdId, p.label, p.created_by AS createdBy FROM display_pairing p
      JOIN active_membership m ON m.user_id = p.created_by AND m.household_id = p.household_id AND m.role = 'parent'
      WHERE p.secret_hash = ? AND p.consumed_at IS NULL AND p.revoked_at IS NULL AND p.expires_at > ?`).get(digest(compact), now) as { id: string; householdId: string; label: string; createdBy: string } | undefined;
    if (!pairing) throw new DisplayPairingError('invalid');
    const consumed = db.prepare('UPDATE display_pairing SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL AND revoked_at IS NULL').run(now, pairing.id);
    if (consumed.changes !== 1) throw new DisplayPairingError('invalid');
    const expiresAt = now + DEVICE_TTL_MS;
    db.prepare('INSERT INTO display_device (id, pairing_id, token_hash, household_id, label, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(deviceId, pairing.id, digest(token), pairing.householdId, pairing.label, pairing.createdBy, now, expiresAt);
    return { token, deviceId, householdId: pairing.householdId, expiresAt };
  }).immediate();
}

/**
 * The only place a display credential is accepted. Rechecked on every request, so revocation,
 * expiry and the pairing parent's disabling take effect on the next read.
 */
export function verifyDisplayCredential(db: Database.Database, token: string, now = Date.now()): VerifiedDisplay | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const row = db.prepare(`SELECT d.id AS deviceId, d.household_id AS householdId, d.label, d.last_seen_at AS lastSeenAt FROM display_device d
    JOIN active_membership m ON m.user_id = d.created_by AND m.household_id = d.household_id AND m.role = 'parent'
    WHERE d.token_hash = ? AND d.revoked_at IS NULL AND d.expires_at > ?`).get(digest(token), now) as (VerifiedDisplay & { lastSeenAt: number | null }) | undefined;
  if (!row) return null;
  if (row.lastSeenAt === null || now - row.lastSeenAt >= LAST_SEEN_INTERVAL_MS) {
    // Bookkeeping must never turn a valid read into a failure (e.g. a busy writer).
    try { db.prepare('UPDATE display_device SET last_seen_at = ? WHERE id = ?').run(now, row.deviceId); } catch { /* best effort */ }
  }
  return { deviceId: row.deviceId, householdId: row.householdId, label: row.label };
}

export function listDisplays(db: Database.Database, actorId: string, householdId: string, now = Date.now()) {
  requireParent(db, actorId, householdId);
  const rows = db.prepare('SELECT id, label, created_at AS pairedAt, last_seen_at AS lastSeenAt, expires_at AS expiresAt, revoked_at AS revokedAt FROM display_device WHERE household_id = ? ORDER BY created_at DESC, id').all(householdId) as { id: string; label: string; pairedAt: number; lastSeenAt: number | null; expiresAt: number; revokedAt: number | null }[];
  const devices = rows.map(({ revokedAt, ...row }) => ({ ...row, revokedAt, status: (revokedAt !== null ? 'revoked' : row.expiresAt <= now ? 'expired' : 'active') as DisplayStatus }));
  const pending = db.prepare('SELECT id, label, expires_at AS expiresAt FROM display_pairing WHERE household_id = ? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ? ORDER BY expires_at, id').all(householdId, now) as { id: string; label: string; expiresAt: number }[];
  return { devices, pending };
}

/** Any active parent of the household may revoke any of its displays. Repeating it changes nothing. */
export function revokeDisplay(db: Database.Database, actorId: string, householdId: string, deviceId: string, now = Date.now()) {
  return db.transaction(() => {
    requireParent(db, actorId, householdId);
    const result = db.prepare('UPDATE display_device SET revoked_at = ?, revoked_by = ? WHERE id = ? AND household_id = ? AND revoked_at IS NULL').run(now, actorId, deviceId, householdId);
    if (result.changes === 1) return { changed: true };
    if (!db.prepare('SELECT 1 FROM display_device WHERE id = ? AND household_id = ?').get(deviceId, householdId)) throw new DisplayPairingError('unavailable');
    return { changed: false };
  }).immediate();
}

export function revokePairing(db: Database.Database, actorId: string, householdId: string, pairingId: string, now = Date.now()) {
  db.transaction(() => {
    requireParent(db, actorId, householdId);
    const result = db.prepare('UPDATE display_pairing SET revoked_at = ? WHERE id = ? AND household_id = ? AND revoked_at IS NULL AND consumed_at IS NULL AND expires_at > ?').run(now, pairingId, householdId, now);
    if (result.changes !== 1) throw new DisplayPairingError('unavailable');
  }).immediate();
}

/**
 * Called inside the member-disable transaction: everything a parent authorized stops working
 * with them. Other parents' displays and other households are untouched.
 */
export function revokeDisplayAuthorityOf(db: Database.Database, householdId: string, userId: string, revokedBy: string, now: number) {
  db.prepare('UPDATE display_pairing SET revoked_at = ? WHERE household_id = ? AND created_by = ? AND consumed_at IS NULL AND revoked_at IS NULL').run(now, householdId, userId);
  db.prepare('UPDATE display_device SET revoked_at = ?, revoked_by = ? WHERE household_id = ? AND created_by = ? AND revoked_at IS NULL').run(now, revokedBy, householdId, userId);
}

/**
 * Process-wide failed-redemption throttle. Pairing codes carry 120 bits, so guessing is not the
 * threat; this keeps an unauthenticated endpoint from being a cheap hammering target. Client
 * addresses are deliberately not used because proxy headers are not trusted here.
 */
export function createFailureLimiter(max: number, windowMs: number, clock: () => number = Date.now) {
  let failures: number[] = [];
  const prune = () => { const cutoff = clock() - windowMs; failures = failures.filter(at => at > cutoff); };
  return {
    blocked() { prune(); return failures.length >= max; },
    failure() { prune(); failures.push(clock()); },
    reset() { failures = []; }
  };
}
