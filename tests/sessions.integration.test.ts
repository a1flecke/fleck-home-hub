import { afterEach, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { createAuth, migrate, authorizeRequest } from '../src/lib/server/identity';
import { SessionManagementError, listAccountSessions, revokeAccountSession, revokeOtherAccountSessions } from '../src/lib/server/sessions';
import { disableMember } from '../src/lib/server/household-access';

const origin = 'http://localhost:3000';
const dbs: Database.Database[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });
const post = (path: string, body: unknown) => new Request(`${origin}/api/auth/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin, 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1' }, body: JSON.stringify(body) });

async function fixture() {
  const db = new Database(':memory:'); dbs.push(db); db.pragma('foreign_keys = ON');
  await migrate(db);
  const auth = createAuth(db, { secret: 'synthetic-session-test-secret-over-32-characters', origin, allowSignUp: true, autoSignIn: false });
  const make = async (name: string, email: string) => (await auth.api.signUpEmail({ body: { name, email, password: 'synthetic-password-123' } })).user.id;
  const parent = await make('Parent', 'parent@example.test'), kid = await make('Kid', 'kid@example.test');
  db.prepare('INSERT INTO household (id, name) VALUES (?, ?), (?, ?)').run('house-a', 'A', 'house-b', 'B');
  const add = db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)');
  add.run(parent, 'house-a', 'parent'); add.run(kid, 'house-a', 'kid'); add.run(kid, 'house-b', 'kid');
  const signIn = async (email: string) => new Headers({ cookie: (await auth.handler(post('sign-in/email', { email, password: 'synthetic-password-123' }))).headers.get('set-cookie')!.split(';')[0], origin });
  return { db, auth, parent, kid, signIn };
}

it('lists only the caller\'s sessions, marks the current one and never exposes a token', async () => {
  const f = await fixture();
  const phone = await f.signIn('kid@example.test'), laptop = await f.signIn('kid@example.test'), parentSession = await f.signIn('parent@example.test');
  const sessions = await listAccountSessions(f.auth, phone);
  expect(sessions).toHaveLength(2);
  expect(sessions.filter((s) => s.current)).toHaveLength(1);
  expect(sessions[0].device).toBe('Safari on iOS');
  const tokens = (f.db.prepare('SELECT token FROM session').all() as { token: string }[]).map((r) => r.token);
  for (const token of tokens) expect(JSON.stringify(sessions).includes(token)).toBe(false);
  expect((await listAccountSessions(f.auth, parentSession))).toHaveLength(1);
  void laptop;
});

it('revokes one other session, refuses another account\'s id and the current session, and tolerates repeats', async () => {
  const f = await fixture();
  const phone = await f.signIn('kid@example.test'), laptop = await f.signIn('kid@example.test'), parentSession = await f.signIn('parent@example.test');
  const [other] = (await listAccountSessions(f.auth, phone)).filter((s) => !s.current);
  const [parentRow] = await listAccountSessions(f.auth, parentSession);
  expect(await revokeAccountSession(f.auth, phone, parentRow.id)).toEqual({ revoked: false });
  expect(await f.auth.api.getSession({ headers: parentSession })).not.toBeNull();
  const [self] = (await listAccountSessions(f.auth, phone)).filter((s) => s.current);
  expect(await revokeAccountSession(f.auth, phone, self.id)).toEqual({ revoked: false });
  expect(await revokeAccountSession(f.auth, phone, other.id)).toEqual({ revoked: true });
  expect(await revokeAccountSession(f.auth, phone, other.id)).toEqual({ revoked: false });
  expect(await f.auth.api.getSession({ headers: laptop })).toBeNull();
  expect(await f.auth.api.getSession({ headers: phone })).not.toBeNull();
});

it('signs out other devices across every household without touching membership or other accounts', async () => {
  const f = await fixture();
  const phone = await f.signIn('kid@example.test'), laptop = await f.signIn('kid@example.test'), parentSession = await f.signIn('parent@example.test');
  const members = JSON.stringify(f.db.prepare('SELECT * FROM membership ORDER BY 1, 2').all());
  await revokeOtherAccountSessions(f.auth, phone);
  expect(await f.auth.api.getSession({ headers: laptop })).toBeNull();
  expect(await authorizeRequest(f.auth, f.db, laptop, 'house-a', 'read')).toBe(false);
  expect(await authorizeRequest(f.auth, f.db, laptop, 'house-b', 'read')).toBe(false);
  expect(await authorizeRequest(f.auth, f.db, phone, 'house-b', 'read')).toBe(true);
  expect(await f.auth.api.getSession({ headers: parentSession })).not.toBeNull();
  expect(JSON.stringify(f.db.prepare('SELECT * FROM membership ORDER BY 1, 2').all())).toBe(members);
});

it('keeps session management separate from household membership', async () => {
  const f = await fixture();
  const kid = await f.signIn('kid@example.test');
  disableMember(f.db, f.parent, 'house-a', f.kid);
  expect(await listAccountSessions(f.auth, kid)).toHaveLength(1);
  expect(await authorizeRequest(f.auth, f.db, kid, 'house-a', 'read')).toBe(false);
  expect(await authorizeRequest(f.auth, f.db, kid, 'house-b', 'read')).toBe(true);
});

it('rejects anonymous callers and asks an old session to sign in again', async () => {
  const f = await fixture();
  await expect(listAccountSessions(f.auth, new Headers())).rejects.toMatchObject({ code: 'signed-out' });
  const headers = await f.signIn('kid@example.test');
  f.db.prepare('UPDATE session SET createdAt = ?').run(Date.now() - 3 * 24 * 60 * 60 * 1000);
  await expect(listAccountSessions(f.auth, headers)).rejects.toBeInstanceOf(SessionManagementError);
  await expect(listAccountSessions(f.auth, headers)).rejects.toMatchObject({ code: 'reauthenticate' });
});
