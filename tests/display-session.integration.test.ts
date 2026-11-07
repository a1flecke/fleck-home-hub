import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAuth, migrate, authorizeRequest, parentAction } from '../src/lib/server/identity';
import { createEvent } from '../src/lib/server/calendar';
import { createChore } from '../src/lib/server/chores';
import { createMeal } from '../src/lib/server/meals';
import { setDisplayVisibility } from '../src/lib/server/display';
import { createPairing, redeemPairing, revokeDisplay } from '../src/lib/server/display-pairing';
import { displayCookieName, displayCookieOptions, readDisplayToken } from '../src/lib/server/display-session';
import { loadDisplay, resolveDisplayView } from '../src/lib/server/display-view';
import { disableMember } from '../src/lib/server/household-access';

const secret = 'synthetic-display-session-secret-over-32-chars';
const origin = 'http://localhost:3000';
let dir: string;
let db: Database.Database;
let auth: ReturnType<typeof createAuth>;
let services: { db: Database.Database; auth: typeof auth; origin: string };
const ids: Record<string, string> = {};

const post = (path: string, body: unknown) => new Request(`${origin}/api/auth/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) });
const request = (cookie?: string) => new Request(`${origin}/display/data`, { headers: cookie ? { cookie } : {} });
const today = () => new Date().toISOString().slice(0, 10);
const weather = async () => ({ status: 'unavailable' as const });

async function signUp(name: string) {
  const response = await auth.handler(post('sign-up/email', { name, email: `${name}@example.test`, password: 'synthetic-password-123' }));
  ids[name] = (await response.json()).user.id;
}
async function signIn(name: string) {
  const response = await auth.handler(post('sign-in/email', { email: `${name}@example.test`, password: 'synthetic-password-123' }));
  return response.headers.get('set-cookie')!.split(';')[0];
}
const pair = (household: string, parent: string, label = 'Kitchen') => redeemPairing(db, createPairing(db, ids[parent], household, label).secret).token;
const displayCookie = (token: string) => `${displayCookieName(origin)}=${token}`;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'hub-display-session-'));
  db = new Database(join(dir, 'synthetic.sqlite'));
  db.pragma('foreign_keys = ON');
  await migrate(db);
  auth = createAuth(db, { secret, origin, allowSignUp: true });
  services = { db, auth, origin };
  for (const name of ['parentA', 'parentB', 'kid', 'parentOther']) await signUp(name);
  db.prepare('INSERT INTO household VALUES (?, ?), (?, ?)').run('home', 'Home', 'other', 'Other');
  const add = db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)');
  add.run(ids.parentA, 'home', 'parent'); add.run(ids.parentB, 'home', 'parent'); add.run(ids.kid, 'home', 'kid'); add.run(ids.parentOther, 'other', 'parent');
  const event = createEvent(db, ids.parentA, 'home', { title: 'Shared event', date: today(), allDay: true, description: 'PRIVATE-DESC' });
  setDisplayVisibility(db, ids.parentA, 'home', 'event', event, true);
  const chore = createChore(db, ids.parentA, 'home', { title: 'Shared chore', assigneeId: ids.kid, dueDate: today(), rewardCents: 4321 });
  setDisplayVisibility(db, ids.parentA, 'home', 'chore', chore, true);
  createMeal(db, ids.parentA, 'home', { title: 'Shared meal', date: today(), ingredients: 'rice', notes: 'PRIVATE-NOTE', shared: true });
  const foreign = createEvent(db, ids.parentOther, 'other', { title: 'Foreign event', date: today(), allDay: true });
  setDisplayVisibility(db, ids.parentOther, 'other', 'event', foreign, true);
});
afterAll(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

describe('display cookie', () => {
  it('is HttpOnly, SameSite=Strict, scoped to /display and Secure on HTTPS', () => {
    expect(displayCookieOptions('https://hub.example.test', 5000)).toMatchObject({ path: '/display', httpOnly: true, secure: true, sameSite: 'strict' });
    expect(displayCookieOptions(origin, 5000)).toMatchObject({ path: '/display', httpOnly: true, secure: false, sameSite: 'strict' });
    expect(displayCookieName('https://hub.example.test')).toBe('__Secure-fleck_display');
  });
  it('reads only its own cookie and ignores look-alikes', () => {
    const headers = (cookie: string) => new Headers({ cookie });
    expect(readDisplayToken(headers('a=1; fleck_display=abc; b=2'), origin)).toBe('abc');
    expect(readDisplayToken(headers('xfleck_display=abc; better-auth.session_token=zzz'), origin)).toBeNull();
    expect(readDisplayToken(headers('fleck_display=abc'), 'https://hub.example.test')).toBeNull();
    expect(readDisplayToken(new Headers(), origin)).toBeNull();
  });
});

describe('paired display view', () => {
  it('serves only shared household data in device mode, with no management controls or private fields', async () => {
    const token = pair('home', 'parentA');
    const view = await resolveDisplayView(request(displayCookie(token)), { services, weather });
    expect(view).toMatchObject({ mode: 'device', canManage: false });
    if (view.mode === 'unpaired') throw new Error('unexpected');
    expect(view.events.map(item => item.title)).toEqual(['Shared event']);
    expect(view.chores.map(item => item.title)).toEqual(['Shared chore']);
    expect(view.meals.map(item => item.title)).toEqual(['Shared meal']);
    const body = JSON.stringify(view);
    expect(body).not.toMatch(/PRIVATE|4321|reward|notes|assignee|choices|Foreign|token|secret|email/i);
    expect(body).not.toContain(token);
  });

  it('isolates households', async () => {
    const token = pair('other', 'parentOther', 'Other kitchen');
    const view = await resolveDisplayView(request(displayCookie(token)), { services, weather });
    if (view.mode !== 'device') throw new Error('expected device');
    expect(view.events.map(item => item.title)).toEqual(['Foreign event']);
    expect(view.chores).toEqual([]);
    expect(view.meals).toEqual([]);
  });

  it('keeps anonymous requests redirecting to sign-in and rejects the display loader strictly', async () => {
    await expect(resolveDisplayView(request(), { services, weather })).rejects.toMatchObject({ status: 303, location: '/sign-in' });
    await expect(loadDisplay(request(`${displayCookieName(origin)}=${'A'.repeat(43)}`), { services, weather })).rejects.toMatchObject({ status: 401 });
  });

  it.each(['garbage', 'A'.repeat(43), `${'A'.repeat(42)}%`])('treats credential %j as unpaired', async (token) => {
    const view = await resolveDisplayView(request(`${displayCookieName(origin)}=${token}`), { services, weather });
    expect(view).toEqual({ mode: 'unpaired' });
  });

  it('stops serving data on the very next request after revocation, expiry or parent disabling', async () => {
    const revoked = pair('home', 'parentA', 'Revoked');
    expect((await resolveDisplayView(request(displayCookie(revoked)), { services, weather })).mode).toBe('device');
    const id = (db.prepare('SELECT id FROM display_device WHERE token_hash = ?').get(createHash('sha256').update(revoked).digest('hex')) as { id: string }).id;
    revokeDisplay(db, ids.parentB, 'home', id);
    expect(await resolveDisplayView(request(displayCookie(revoked)), { services, weather })).toEqual({ mode: 'unpaired' });

    const expired = pair('home', 'parentA', 'Expired');
    db.prepare("UPDATE display_device SET expires_at = 1 WHERE label = 'Expired'").run();
    expect(await resolveDisplayView(request(displayCookie(expired)), { services, weather })).toEqual({ mode: 'unpaired' });
  });

  it('invalidates the displays of a parent who is disabled, but not the other parent\'s', async () => {
    const mine = pair('home', 'parentA', 'Mine');
    const theirs = pair('home', 'parentB', 'Theirs');
    disableMember(db, ids.parentB, 'home', ids.parentA);
    expect(await resolveDisplayView(request(displayCookie(mine)), { services, weather })).toEqual({ mode: 'unpaired' });
    expect((await resolveDisplayView(request(displayCookie(theirs)), { services, weather })).mode).toBe('device');
  });
});

describe('display credential is never a household credential', () => {
  it('is rejected by Better Auth under any cookie name and by every authorization helper', async () => {
    const token = pair('home', 'parentB', 'Probe');
    for (const name of [displayCookieName(origin), 'better-auth.session_token', '__Secure-better-auth.session_token']) {
      const headers = new Headers({ cookie: `${name}=${token}`, origin });
      expect(await auth.api.getSession({ headers })).toBeNull();
      expect(await authorizeRequest(auth, db, headers, 'home', 'read')).toBe(false);
      expect(await authorizeRequest(auth, db, headers, 'home', 'manage')).toBe(false);
    }
    const response = await parentAction(auth, db, new Request(`${origin}/x`, { method: 'POST', headers: { cookie: displayCookie(token), origin } }), 'home', origin);
    expect(response.status).toBe(401);
  });

  it('does not let a display credential ride along on a real session to gain or lose anything', async () => {
    const token = pair('home', 'parentB', 'Ride along');
    const cookie = await signIn('kid');
    const view = await resolveDisplayView(request(`${cookie}; ${displayCookie(token)}`), { services, weather });
    expect(view).toMatchObject({ mode: 'member', canManage: false });
  });

  it('creates no accounts, sessions or memberships when a display is paired', async () => {
    const counts = () => [db.prepare('SELECT count(*) AS n FROM user').get(), db.prepare('SELECT count(*) AS n FROM account').get(), db.prepare('SELECT count(*) AS n FROM membership').get()];
    const before = counts();
    const sessions = db.prepare('SELECT count(*) AS n FROM session').get();
    pair('home', 'parentB', 'Counted');
    expect(counts()).toEqual(before);
    expect(db.prepare('SELECT count(*) AS n FROM session').get()).toEqual(sessions);
  });
});
