import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { createAuth, migrate, authorizeRequest, parentAction } from '../src/lib/server/identity';

const databases: Database.Database[] = [];
const secret = 'a-long-random-test-secret-for-synthetic-fixtures-only';
const origin = 'http://localhost:3000';
const credentials = { name: 'Synthetic Parent', email: 'parent@example.test', password: 'synthetic-password-123' };
const post = (path: string, body: unknown, cookie?: string) => new Request(`${origin}/api/auth/${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', origin, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body)
});
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

describe('real identity boundary', () => {
  it('blocks public registration and revokes access on sign out', async () => {
    const db = new Database(':memory:'); databases.push(db);
    await migrate(db);
    const provisioning = createAuth(db, { secret, origin, allowSignUp: true });
    const created = await provisioning.handler(post('sign-up/email', credentials));
    expect(created.status).toBe(200);
    const user = (await created.json()).user;
    db.prepare('INSERT INTO household (id, name) VALUES (?, ?)').run('home-a', 'Test');
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(user.id, 'home-a', 'parent');
    const auth = createAuth(db, { secret, origin, allowSignUp: false });
    expect((await auth.handler(post('sign-up/email', { ...credentials, email: 'other@example.test' }))).status).not.toBe(200);
    expect(await authorizeRequest(auth, db, new Headers(), 'home-a', 'manage')).toBe(false);
    expect((await parentAction(auth, db, new Request(origin), 'home-a', origin)).status).toBe(401);
    const login = await auth.handler(post('sign-in/email', { email: credentials.email, password: credentials.password }));
    expect(login.status).toBe(200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const headers = new Headers({ cookie, origin });
    const forged = new Headers({ cookie, origin: 'https://attacker.example.test' });
    expect((await parentAction(auth, db, new Request(origin, { headers: forged }), 'home-a', origin)).status).toBe(403);
    expect((await parentAction(auth, db, new Request(origin, { headers: { cookie } }), 'home-a', origin)).status).toBe(403);
    expect(await authorizeRequest(auth, db, headers, 'home-a', 'manage')).toBe(true);
    expect((await parentAction(auth, db, new Request(origin, { headers }), 'home-a', origin)).status).toBe(204);
    expect((await parentAction(auth, db, new Request(origin, { headers }), 'home-b', origin)).status).toBe(403);
    expect(await authorizeRequest(auth, db, headers, 'home-b', 'read')).toBe(false);
    db.prepare("UPDATE membership SET role='kid' WHERE user_id=?").run(user.id);
    expect(await authorizeRequest(auth, db, headers, 'home-a', 'manage')).toBe(false);
    expect((await parentAction(auth, db, new Request(origin, { headers }), 'home-a', origin)).status).toBe(403);
    expect(await authorizeRequest(auth, db, headers, 'home-a', 'read')).toBe(true);
    expect((await auth.handler(post('sign-out', {}, cookie))).status).toBe(200);
    expect(await authorizeRequest(auth, db, headers, 'home-a', 'read')).toBe(false);
  });
});

it('enforces membership foreign keys and permits repeat migration', async () => {
  const db = new Database(':memory:'); databases.push(db);
  await migrate(db);
  await migrate(db);
  expect(() => db.prepare("INSERT INTO membership (user_id, household_id, role) VALUES ('missing', 'missing', 'parent')").run()).toThrow();
});
