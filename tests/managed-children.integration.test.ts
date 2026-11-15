import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { bootstrap } from '../src/lib/server/bootstrap';
import { createAuth } from '../src/lib/server/identity';
import { addManagedChild, setChildSignIn, signInChild } from '../src/lib/server/managed-children';

test('parents can add deferred and active child profiles and rotate sign-in with session revocation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fleck-managed-children-'));
  const config = { origin: 'http://localhost:3000', dbPath: join(directory, 'hub.sqlite'), secret: 'synthetic-managed-children-only-secret' };
  const household = await bootstrap(config, { household: 'Example', name: 'Parent', email: 'parent@example.test', password: 'synthetic-parent-password' });
  const db = new Database(config.dbPath);
  try {
    db.pragma('foreign_keys = ON');
    const parent = (db.prepare('SELECT user_id AS id FROM membership').get() as { id: string }).id;
    const pending = await addManagedChild(db, config, parent, household, { name: 'Jules', username: '', password: '' });
    const child = await addManagedChild(db, config, parent, household, { name: 'Jules', username: 'jules-family', password: 'synthetic-child-password' });
    expect(child).not.toBe(pending);
    expect(db.prepare("SELECT COUNT(*) AS count FROM active_membership WHERE role = 'kid'").get()).toEqual({ count: 2 });
    await expect(addManagedChild(db, config, child, household, { name: 'Denied', username: '', password: '' })).rejects.toThrow();
    await expect(addManagedChild(db, config, parent, 'different-household', { name: 'Denied', username: '', password: '' })).rejects.toThrow();
    await expect(addManagedChild(db, config, parent, household, { name: 'Duplicate', username: 'Jules-Family', password: 'synthetic-child-password' })).rejects.toThrow();
    expect(db.prepare("SELECT COUNT(*) AS count FROM active_membership WHERE role = 'kid'").get()).toEqual({ count: 2 });

    const auth = createAuth(db, config);
    const signIn = (username: string, password: string) => signInChild(db, auth, config.origin, new Headers({ origin: config.origin }), username, password);
    const signedIn = await signIn('Jules-Family', 'synthetic-child-password');
    expect(signedIn.status).toBe(204);
    expect(await signedIn.text()).toBe('');
    const headers = new Headers({ cookie: signedIn.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; ') });
    expect((await auth.api.getSession({ headers }))?.user.id).toBe(child);

    await expect(setChildSignIn(db, child, household, pending, 'new-user', 'synthetic-reset-password')).rejects.toThrow();
    await setChildSignIn(db, parent, household, child, 'jules-family', 'synthetic-reset-password');
    expect(await auth.api.getSession({ headers })).toBeNull();
    expect((await signIn('jules-family', 'synthetic-child-password')).status).toBe(401);
    expect((await signIn('jules-family', 'synthetic-reset-password')).status).toBe(204);
    await setChildSignIn(db, parent, household, pending, 'jules-two', 'synthetic-second-child-password');
    expect((await signIn('jules-two', 'synthetic-second-child-password')).status).toBe(204);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
