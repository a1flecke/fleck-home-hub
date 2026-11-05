import { afterEach, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAuth, migrate } from '../src/lib/server/identity';
import { createInvitation, listHouseholdAccess, redeemInvitation, revokeInvitation } from '../src/lib/server/invitations';

const secret = 'synthetic-invitation-test-secret-over-32-characters';
const origin = 'http://localhost:3000';
const config = { secret, origin };
const dbs: Database.Database[] = [];
const dirs: string[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'hub-invitation-test-')); dirs.push(dir);
  const db = new Database(join(dir, 'synthetic.sqlite')); dbs.push(db);
  db.pragma('foreign_keys = ON');
  await migrate(db);
  const auth = createAuth(db, { ...config, allowSignUp: true });
  const parent = await auth.api.signUpEmail({ body: { name: 'Parent', email: 'parent@example.test', password: 'synthetic-password-123' } });
  db.prepare('INSERT INTO household (id, name) VALUES (?, ?)').run('house-a', 'Example');
  db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(parent.user.id, 'house-a', 'parent');
  return { db, parent: parent.user.id };
}

it('redeems a parent invitation without storing its token, and rejects replay', async () => {
  const { db, parent } = await fixture();
  const token = createInvitation(db, parent, 'house-a', 'parent');
  expect(JSON.stringify(db.prepare('SELECT * FROM household_invitation').all()).includes(token)).toBe(false);
  const input = { name: 'Invitee', email: 'invitee@example.test', password: 'synthetic-password-123' };
  const userId = await redeemInvitation(db, config, token, input);
  expect(db.prepare('SELECT role FROM membership WHERE user_id = ? AND household_id = ?').get(userId, 'house-a')).toEqual({ role: 'parent' });
  expect(db.prepare('SELECT count(*) AS n FROM session WHERE userId = ?').get(userId)).toEqual({ n: 0 });
  await expect(redeemInvitation(db, config, token, { ...input, email: 'replay@example.test' })).rejects.toThrow();
  expect(db.prepare("SELECT count(*) AS n FROM user WHERE email = 'replay@example.test'").get()).toEqual({ n: 0 });
});

it('rolls back identity, credential, and invitation consumption when membership insertion fails', async () => {
  const { db, parent } = await fixture();
  const token = createInvitation(db, parent, 'house-a', 'kid');
  db.exec("CREATE TRIGGER reject_invited_member BEFORE INSERT ON membership BEGIN SELECT RAISE(ABORT, 'injected failure'); END");
  await expect(redeemInvitation(db, config, token, { name: 'Child', email: 'child@example.test', password: 'synthetic-password-123' })).rejects.toThrow();
  expect(db.prepare("SELECT count(*) AS n FROM user WHERE email = 'child@example.test'").get()).toEqual({ n: 0 });
  expect(db.prepare('SELECT count(*) AS n FROM account').get()).toEqual({ n: 1 });
  db.exec('DROP TRIGGER reject_invited_member');
  const userId = await redeemInvitation(db, config, token, { name: 'Child', email: 'child@example.test', password: 'synthetic-password-123' });
  expect(db.prepare('SELECT role FROM membership WHERE user_id = ?').get(userId)).toEqual({ role: 'kid' });
});

it('rejects child and cross-household invitation creation', async () => {
  const { db, parent } = await fixture();
  db.prepare("UPDATE membership SET role = 'kid' WHERE user_id = ?").run(parent);
  expect(() => createInvitation(db, parent, 'house-a', 'parent')).toThrow();
  db.prepare("UPDATE membership SET role = 'parent' WHERE user_id = ?").run(parent);
  expect(() => createInvitation(db, parent, 'house-b', 'kid')).toThrow();
  expect(db.prepare('SELECT count(*) AS n FROM household_invitation').get()).toEqual({ n: 0 });
});

it.each(['expired', 'revoked'])('rejects an %s invitation without leaving an identity', async (state) => {
  const { db, parent } = await fixture();
  const token = createInvitation(db, parent, 'house-a', 'kid');
  if (state === 'expired') db.prepare('UPDATE household_invitation SET expires_at = 0').run();
  else db.prepare('UPDATE household_invitation SET revoked_at = ?').run(Date.now());
  await expect(redeemInvitation(db, config, token, { name: 'Child', email: 'child@example.test', password: 'synthetic-password-123' })).rejects.toThrow();
  expect(db.prepare("SELECT count(*) AS n FROM user WHERE email = 'child@example.test'").get()).toEqual({ n: 0 });
});

it('allows at most one concurrent redemption using separate SQLite connections', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'hub-invitations-'));
  const path = join(dir, 'synthetic.sqlite');
  const first = new Database(path);
  const second = new Database(path);
  try {
    first.pragma('foreign_keys = ON'); second.pragma('foreign_keys = ON');
    first.pragma('journal_mode = WAL');
    await migrate(first);
    const auth = createAuth(first, { ...config, allowSignUp: true });
    const parent = await auth.api.signUpEmail({ body: { name: 'Parent', email: 'parent@example.test', password: 'synthetic-password-123' } });
    first.prepare('INSERT INTO household VALUES (?, ?)').run('house-a', 'Example');
    first.prepare('INSERT INTO membership VALUES (?, ?, ?)').run(parent.user.id, 'house-a', 'parent');
    const token = createInvitation(first, parent.user.id, 'house-a', 'kid');
    const results = await Promise.allSettled([
      redeemInvitation(first, config, token, { name: 'Child A', email: 'child-a@example.test', password: 'synthetic-password-123' }),
      redeemInvitation(second, config, token, { name: 'Child B', email: 'child-b@example.test', password: 'synthetic-password-123' })
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(first.prepare("SELECT count(*) AS n FROM membership WHERE role = 'kid'").get()).toEqual({ n: 1 });
    expect(first.prepare('SELECT count(*) AS n FROM user').get()).toEqual({ n: 2 });
  } finally { first.close(); second.close(); rmSync(dir, { recursive: true, force: true }); }
});


it('lists household members and pending invitations only for a parent', async () => {
  const { db, parent } = await fixture();
  createInvitation(db, parent, 'house-a', 'kid');
  const result = listHouseholdAccess(db, parent, 'house-a');
  expect(result.members).toEqual([{ id: parent, name: 'Parent', role: 'parent' }]);
  expect(result.invitations).toHaveLength(1);
  expect(result.invitations[0].role).toBe('kid');
  expect(JSON.stringify(result)).not.toContain('token_hash');
  expect(() => listHouseholdAccess(db, parent, 'house-b')).toThrow();
  db.prepare("UPDATE membership SET role = 'kid' WHERE user_id = ?").run(parent);
  expect(() => listHouseholdAccess(db, parent, 'house-a')).toThrow();
});

it('revokes only an invitation in the actor’s household and rejects its redemption', async () => {
  const { db, parent } = await fixture();
  const token = createInvitation(db, parent, 'house-a', 'kid');
  const id = listHouseholdAccess(db, parent, 'house-a').invitations[0].id;
  expect(() => revokeInvitation(db, parent, 'house-b', id)).toThrow();
  revokeInvitation(db, parent, 'house-a', id);
  expect(listHouseholdAccess(db, parent, 'house-a').invitations).toHaveLength(0);
  await expect(redeemInvitation(db, config, token, { name: 'Child', email: 'child@example.test', password: 'synthetic-password-123' })).rejects.toThrow();
});

it('rejects an invitation after its issuing parent loses household access', async () => {
  const { db, parent } = await fixture();
  const token = createInvitation(db, parent, 'house-a', 'parent');
  db.prepare('DELETE FROM membership WHERE user_id = ?').run(parent);
  await expect(redeemInvitation(db, config, token, { name: 'Invitee', email: 'invitee@example.test', password: 'synthetic-password-123' })).rejects.toThrow();
  expect(db.prepare('SELECT count(*) AS n FROM user').get()).toEqual({ n: 1 });
});

it('does not attach an existing account to a household when its email is submitted', async () => {
  const { db, parent } = await fixture();
  const token = createInvitation(db, parent, 'house-a', 'parent');
  await expect(redeemInvitation(db, config, token, { name: 'Forged', email: 'PARENT@example.test', password: 'synthetic-password-123' })).rejects.toThrow();
  expect(db.prepare('SELECT count(*) AS n FROM membership').get()).toEqual({ n: 1 });
  expect(db.prepare('SELECT consumed_at AS consumedAt FROM household_invitation').get()).toEqual({ consumedAt: null });
  const invited = await redeemInvitation(db, config, token, { name: 'New Parent', email: 'new-parent@example.test', password: 'synthetic-password-123' });
  expect(db.prepare('SELECT role FROM membership WHERE user_id = ?').get(invited)).toEqual({ role: 'parent' });
});

it('bounds simultaneous invitation redemption work', async () => {
  const { db, parent } = await fixture();
  const token = createInvitation(db, parent, 'house-a', 'kid');
  const input = { name: 'Child', email: 'child@example.test', password: 'synthetic-password-123' };
  const first = redeemInvitation(db, config, token, input);
  const second = redeemInvitation(db, config, token, input);
  const third = redeemInvitation(db, config, token, input);
  const results = await Promise.allSettled([first, second, third]);
  expect(results[2]).toMatchObject({ status: 'rejected', reason: { message: 'Too many invitation attempts' } });
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
});

it('preserves invitation and membership integrity through backup and restoration', async () => {
  const { backupDatabase } = await import('../src/lib/server/backup');
  const { db, parent } = await fixture();
  const directory = dirs[dirs.length - 1];
  const childToken = createInvitation(db, parent, 'house-a', 'kid');
  const child = await redeemInvitation(db, config, childToken, { name: 'Child', email: 'child@example.test', password: 'synthetic-password-123' });
  const pendingToken = createInvitation(db, parent, 'house-a', 'parent');
  const destination = join(directory, 'backup.sqlite');
  await backupDatabase(db.name, destination);
  const restored = new Database(destination); dbs.push(restored);
  restored.pragma('foreign_keys = ON');
  expect(restored.pragma('integrity_check', { simple: true })).toBe('ok');
  await migrate(restored);
  expect(restored.prepare('SELECT role FROM membership WHERE user_id = ? AND household_id = ?').get(child, 'house-a')).toEqual({ role: 'kid' });
  await expect(redeemInvitation(restored, config, childToken, { name: 'Replay', email: 'replay@example.test', password: 'synthetic-password-123' })).rejects.toThrow();
  const invited = await redeemInvitation(restored, config, pendingToken, { name: 'Second Parent', email: 'second@example.test', password: 'synthetic-password-123' });
  expect(restored.prepare('SELECT role FROM membership WHERE user_id = ? AND household_id = ?').get(invited, 'house-a')).toEqual({ role: 'parent' });
});


it.each(['forged', 'expired', 'revoked', 'issuer removed'])('rejects a %s token before competing for the SQLite writer', async (state) => {
  const { db, parent } = await fixture();
  let token = createInvitation(db, parent, 'house-a', 'kid');
  if (state === 'forged') token = 'a'.repeat(43);
  if (state === 'expired') db.prepare('UPDATE household_invitation SET expires_at = 0').run();
  if (state === 'revoked') db.prepare('UPDATE household_invitation SET revoked_at = 1').run();
  if (state === 'issuer removed') db.prepare('DELETE FROM membership WHERE user_id = ?').run(parent);
  const writer = new Database(db.name);
  writer.exec('BEGIN IMMEDIATE');
  try {
    await expect(redeemInvitation(db, config, token, { name: 'Rejected', email: 'rejected@example.test', password: 'synthetic-password-123' })).rejects.toThrow('Invalid invitation');
    expect(db.prepare('SELECT count(*) AS n FROM user').get()).toEqual({ n: 1 });
  } finally { writer.exec('ROLLBACK'); writer.close(); }
}, 10000);


it('rolls back membership and consumption when credential insertion fails afterward', async () => {
  const { db, parent } = await fixture();
  const token = createInvitation(db, parent, 'house-a', 'kid');
  db.exec("CREATE TRIGGER reject_credential BEFORE INSERT ON account BEGIN SELECT RAISE(ABORT, 'injected credential failure'); END");
  const input = { name: 'Child', email: 'credential-failure@example.test', password: 'synthetic-password-123' };
  await expect(redeemInvitation(db, config, token, input)).rejects.toThrow();
  expect(db.prepare('SELECT count(*) AS n FROM user').get()).toEqual({ n: 1 });
  expect(db.prepare('SELECT count(*) AS n FROM membership').get()).toEqual({ n: 1 });
  expect(db.prepare('SELECT consumed_at AS consumedAt FROM household_invitation').get()).toEqual({ consumedAt: null });
  db.exec('DROP TRIGGER reject_credential');
  const child = await redeemInvitation(db, config, token, input);
  expect(db.prepare('SELECT role FROM membership WHERE user_id = ?').get(child)).toEqual({ role: 'kid' });
});


it('upgrades the current main migration history without skipping invitations', async () => {
  const { readFileSync, writeFileSync, mkdirSync, copyFileSync } = await import('node:fs');
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const { migrate: migrateDrizzle } = await import('drizzle-orm/better-sqlite3/migrator');
  const directory = mkdtempSync(join(tmpdir(), 'hub-main-upgrade-')); dirs.push(directory);
  const previous = join(directory, 'previous'); mkdirSync(join(previous, 'meta'), { recursive: true });
  const fullJournal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8'));
  const journal = { ...fullJournal, entries: fullJournal.entries.filter((entry: { tag: string }) => entry.tag !== '0009_household_invitations' && entry.tag !== '0010_meal_recipe_details') };
  writeFileSync(join(previous, 'meta/_journal.json'), JSON.stringify(journal));
  for (const entry of journal.entries) copyFileSync(`drizzle/${entry.tag}.sql`, join(previous, `${entry.tag}.sql`));
  const db = new Database(join(directory, 'synthetic.sqlite')); dbs.push(db);
  db.exec(readFileSync('drizzle/auth/0001_better_auth.sql', 'utf8'));
  migrateDrizzle(drizzle(db), { migrationsFolder: previous });
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'household_invitation'").get()).toBeUndefined();
  await migrate(db);
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'household_invitation'").get()).toEqual({ name: 'household_invitation' });
  expect(db.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get()).toEqual({ n: fullJournal.entries.length });
});
