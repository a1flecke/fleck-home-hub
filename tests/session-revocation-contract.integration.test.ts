import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { betterAuth } from 'better-auth';
import { createAuthEndpoint } from 'better-auth/api';
import { migrate } from '../src/lib/server/identity';

it('keeps server-only session revocation inside the SQLite transaction', async () => {
  const db = new Database(':memory:');
  try {
    await migrate(db);
    let target = '';
    const auth = betterAuth({
      database: db,
      secret: 'synthetic-contract-secret-with-at-least-32-characters',
      baseURL: 'http://localhost:3000',
      logger: { disabled: true },
      emailAndPassword: { enabled: true, autoSignIn: false },
      plugins: [{ id: 'synthetic-revocation-contract', endpoints: {
        revokeSynthetic: createAuthEndpoint.serverOnly({ method: 'POST' }, async (ctx) => {
          await ctx.context.internalAdapter.deleteUserSessions(target);
          return { ok: true };
        })
      } }]
    });
    const password = 'synthetic-contract-password-123';
    target = (await auth.api.signUpEmail({ body: { name: 'Target', email: 'target@example.test', password } })).user.id;
    await auth.api.signUpEmail({ body: { name: 'Other', email: 'other@example.test', password } });
    const signIn = async (email: string) => {
      const response = await auth.handler(new Request('http://localhost:3000/api/auth/sign-in/email', {
        method: 'POST', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' }, body: JSON.stringify({ email, password })
      }));
      expect(response.status).toBe(200);
      return new Headers({ cookie: response.headers.get('set-cookie')!.split(';')[0] });
    };
    const targetHeaders = await signIn('target@example.test');
    const otherHeaders = await signIn('other@example.test');
    expect(Boolean(await auth.api.getSession({ headers: targetHeaders }))).toBe(true);
    const response = await auth.handler(new Request('http://localhost:3000/api/auth/revoke-synthetic', { method: 'POST', headers: { origin: 'http://localhost:3000' } }));
    expect(response.status).toBe(404);
    db.exec('BEGIN IMMEDIATE');
    await auth.api.revokeSynthetic();
    expect(Boolean(await auth.api.getSession({ headers: targetHeaders }))).toBe(false);
    db.exec('ROLLBACK');
    expect(Boolean(await auth.api.getSession({ headers: targetHeaders }))).toBe(true);
    db.exec('BEGIN IMMEDIATE');
    await auth.api.revokeSynthetic();
    db.exec('COMMIT');
    expect(Boolean(await auth.api.getSession({ headers: targetHeaders }))).toBe(false);
    expect(Boolean(await auth.api.getSession({ headers: otherHeaders }))).toBe(true);
  } finally { db.close(); }
});
