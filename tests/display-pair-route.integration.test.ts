import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAuth, migrate } from '../src/lib/server/identity';
import { createPairing } from '../src/lib/server/display-pairing';

const origin = 'http://localhost:3000';
const secret = 'synthetic-pair-route-secret-over-32-characters';
let dir: string;
let db: Database.Database;
let parent: string;
let route: typeof import('../src/routes/display/pair/+page.server');
let auth: ReturnType<typeof createAuth>;

function cookiesDouble() {
  const set: { name: string; value: string; options: Record<string, unknown> }[] = [];
  return { set, api: { set: (name: string, value: string, options: Record<string, unknown>) => { set.push({ name, value, options }); } } };
}
function submit(code: string, headers: Record<string, string> = { origin }) {
  return new Request(`${origin}/display/pair`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams({ code }) });
}
async function run(request: Request) {
  const cookies = cookiesDouble();
  try {
    const result = await route.actions.default({ request, cookies: cookies.api } as never);
    return { kind: 'result' as const, result, cookies: cookies.set };
  } catch (thrown) { return { kind: 'thrown' as const, thrown: thrown as { status?: number; location?: string }, cookies: cookies.set }; }
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'hub-pair-route-'));
  const path = join(dir, 'synthetic.sqlite');
  db = new Database(path);
  db.pragma('foreign_keys = ON');
  await migrate(db);
  auth = createAuth(db, { secret, origin, allowSignUp: true });
  const created = await auth.api.signUpEmail({ body: { name: 'Parent', email: 'parent@example.test', password: 'synthetic-password-123' } });
  parent = created.user.id;
  db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'Home');
  db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(parent, 'home', 'parent');
  Object.assign(process.env, { DATABASE_PATH: path, AUTH_SECRET: secret, AUTH_ORIGIN: origin });
  route = await import('../src/routes/display/pair/+page.server');
});
afterAll(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

describe('pairing route', () => {
  it('redeems a valid code once, sets a restricted cookie and redirects to the display', async () => {
    const { secret: code } = createPairing(db, parent, 'home', 'Kitchen');
    const first = await run(submit(code));
    expect(first.thrown).toMatchObject({ status: 303, location: '/display' });
    expect(first.cookies).toHaveLength(1);
    expect(first.cookies[0]).toMatchObject({ name: 'fleck_display', options: { path: '/display', httpOnly: true, sameSite: 'strict', secure: false } });
    expect(first.cookies[0].value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const replay = await run(submit(code));
    expect(replay.kind).toBe('result');
    expect(replay.cookies).toEqual([]);
    expect(JSON.stringify(replay)).not.toContain(code);
  });

  it('rejects cross-origin and origin-less submissions without consuming the code', async () => {
    const { secret: code } = createPairing(db, parent, 'home', 'Cross');
    for (const headers of [{ origin: 'https://attacker.example.test' }, {}] as Record<string, string>[]) {
      const response = await run(submit(code, headers));
      expect(response.result).toMatchObject({ status: 403 });
      expect(response.cookies).toEqual([]);
    }
    expect(db.prepare("SELECT consumed_at FROM display_pairing WHERE label = 'Cross'").get()).toEqual({ consumed_at: null });
  });

  it('refuses to pair a device that has a normal signed-in session, leaving the code unused', async () => {
    const { secret: code } = createPairing(db, parent, 'home', 'Signed in');
    const signIn = await auth.handler(new Request(`${origin}/api/auth/sign-in/email`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ email: 'parent@example.test', password: 'synthetic-password-123' }) }));
    const cookie = signIn.headers.get('set-cookie')!.split(';')[0];
    const response = await run(submit(code, { origin, cookie }));
    expect(response.result).toMatchObject({ status: 409, data: { signedIn: true } });
    expect(response.cookies).toEqual([]);
    expect(db.prepare("SELECT consumed_at FROM display_pairing WHERE label = 'Signed in'").get()).toEqual({ consumed_at: null });
  });

  it('answers every invalid code identically and throttles repeated failures', async () => {
    const messages = new Set<string>();
    let last: { status?: number } = {};
    for (let i = 0; i < 12; i++) {
      const response = await run(submit(i % 2 ? 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA' : `bad code ${i}`));
      last = response.result as { status?: number };
      if ((last.status ?? 0) === 400) messages.add(JSON.stringify(response.result));
    }
    expect(messages.size).toBe(1);
    expect(last.status).toBe(429);
    const { secret: code } = createPairing(db, parent, 'home', 'Throttled');
    expect((await run(submit(code))).result).toMatchObject({ status: 429 });
    expect(db.prepare("SELECT consumed_at FROM display_pairing WHERE label = 'Throttled'").get()).toEqual({ consumed_at: null });
  });
});
