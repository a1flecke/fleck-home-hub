import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAuth, migrate } from '../src/lib/server/identity';
import { disableMember } from '../src/lib/server/household-access';
import { handleAuthRequest } from '../src/lib/server/auth-request';

const secret = 'synthetic-auth-request-secret-over-32-characters';
const origin = 'http://localhost:3000';
const config = { secret, origin };
const dbs: Database.Database[] = [];
const dirs: string[] = [];

afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'hub-auth-request-'));
  dirs.push(dir);
  const path = join(dir, 'synthetic.sqlite');
  const db = new Database(path);
  dbs.push(db);
  db.pragma('foreign_keys = ON');
  await migrate(db);
  const provisioning = createAuth(db, { ...config, allowSignUp: true, autoSignIn: false });
  const make = async (name: string, email: string) =>
    (await provisioning.api.signUpEmail({ body: { name, email, password: 'synthetic-password-123' } })).user.id;
  const parent = await make('Parent One', 'parent@example.test');
  const single = await make('Single Member', 'single@example.test');
  const multi = await make('Multi Member', 'multi@example.test');
  db.prepare('INSERT INTO household (id, name) VALUES (?, ?), (?, ?)').run('house-a', 'Home A', 'house-b', 'Home B');
  const add = db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)');
  add.run(parent, 'house-a', 'parent');
  add.run(single, 'house-a', 'kid');
  add.run(multi, 'house-a', 'kid');
  add.run(multi, 'house-b', 'kid');
  const auth = createAuth(db, { ...config, allowSignUp: false });
  const send = (req: Request) => handleAuthRequest(req, new URL(req.url).pathname, { auth, db }, () => auth.handler(req));
  const post = (apiPath: string, body: unknown, cookie?: string) => new Request(`${origin}/api/auth/${apiPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body)
  });
  return { db, auth, parent, single, multi, send, post };
}

describe('disabled member auth endpoint enforcement', () => {
  it('blocks a disabled ex-member with no active households from signing in or mutating their user record', async () => {
    const f = await setup();
    await disableMember(f.db, config, f.parent, 'house-a', f.single);

    // Signing back in through /api/auth/sign-in/email must fail without issuing a session cookie or keeping a session row.
    const signIn = await f.send(f.post('sign-in/email', { email: 'single@example.test', password: 'synthetic-password-123' }));
    expect(signIn.status).toBe(401);
    expect(signIn.headers.get('set-cookie')).toBeNull();
    expect(f.db.prepare('SELECT count(*) AS n FROM session WHERE userId = ?').get(f.single)).toEqual({ n: 0 });

    // Even if a session existed (e.g., created during a disable race), Better Auth mutation endpoints must reject it with 403.
    const racing = await f.auth.handler(f.post('sign-in/email', { email: 'single@example.test', password: 'synthetic-password-123' }));
    const cookie = racing.headers.get('set-cookie')!.split(';')[0];

    const update = await f.send(f.post('update-user', { name: 'Vandalized Name' }, cookie));
    expect(update.status).toBe(403);
    expect(f.db.prepare('SELECT name FROM user WHERE id = ?').get(f.single)).toEqual({ name: 'Single Member' });

    const passwordChange = await f.send(f.post('change-password', { currentPassword: 'synthetic-password-123', newPassword: 'new-synthetic-password-456' }, cookie));
    expect(passwordChange.status).toBe(403);

    // Sign-out remains available so a stale browser can clear its cookie.
    const signOut = await f.send(f.post('sign-out', {}, cookie));
    expect(signOut.status).toBe(200);
  });

  it('still allows sign-in and account updates for a member disabled in one household who remains active in another', async () => {
    const f = await setup();
    await disableMember(f.db, config, f.parent, 'house-a', f.multi);

    const signIn = await f.send(f.post('sign-in/email', { email: 'multi@example.test', password: 'synthetic-password-123' }));
    expect(signIn.status).toBe(200);
    const cookie = signIn.headers.get('set-cookie')!.split(';')[0];

    const update = await f.send(f.post('update-user', { name: 'Updated Multi' }, cookie));
    expect(update.status).toBe(200);
    expect(f.db.prepare('SELECT name FROM user WHERE id = ?').get(f.multi)).toEqual({ name: 'Updated Multi' });
  });
});
