import { afterEach, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../src/lib/server/identity';
import { addGrocery, changeGrocery, listGroceries } from '../src/lib/server/groceries';
import { getIdentityServices } from '../src/lib/server/runtime';
import { actions } from '../src/routes/groceries/+page.server';

vi.mock('../src/lib/server/runtime', () => ({ getIdentityServices: vi.fn() }));
afterEach(() => vi.resetAllMocks());

const origin = 'http://localhost';

async function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  await migrate(db);
  for (const id of ['parent', 'kid', 'outsider', 'disabled']) {
    db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, `${id}@example.test`);
  }
  for (const id of ['home', 'other']) db.prepare('INSERT INTO household VALUES (?, ?)').run(id, id);
  db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('parent', 'home', 'parent');
  db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('kid', 'home', 'kid');
  db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('outsider', 'other', 'parent');
  db.prepare('INSERT INTO membership (user_id, household_id, role, disabled_at, disabled_by) VALUES (?, ?, ?, ?, ?)').run('disabled', 'home', 'parent', Date.now(), 'parent');
  return db;
}

function useSession(db: Database.Database, userId: string | null) {
  vi.mocked(getIdentityServices).mockReturnValue({
    auth: { api: { getSession: async () => userId ? { user: { id: userId } } : null } },
    db,
    origin
  } as unknown as ReturnType<typeof getIdentityServices>);
}

function bought(db: Database.Database, actor: string, household: string, name: string) {
  const id = addGrocery(db, actor, household, { name, quantity: '', unit: '' });
  changeGrocery(db, actor, household, id, 1, { name, quantity: '', unit: '', completed: true });
  return { id, version: 2 };
}

type ClearAction = (event: { request: Request }) => Promise<unknown>;

function request(fields: Array<[string, string]>, options: { origin?: string | null; contentLength?: string; cookie?: string } = {}) {
  const body = new URLSearchParams();
  for (const [name, value] of fields) body.append(name, value);
  const headers = new Headers({ 'content-type': 'application/x-www-form-urlencoded' });
  if (options.origin !== null) headers.set('origin', options.origin ?? origin);
  if (options.contentLength !== undefined) headers.set('content-length', options.contentLength);
  if (options.cookie !== undefined) headers.set('cookie', options.cookie);
  return new Request(`${origin}/groceries?/clearBought`, { method: 'POST', headers, body });
}

async function submit(fields: Array<[string, string]>, options?: { origin?: string | null; contentLength?: string; cookie?: string }) {
  return (actions.clearBought as ClearAction)({ request: request(fields, options) });
}

function selectionFields(selection: Array<{ id: string; version: number }>): Array<[string, string]> {
  return selection.flatMap(item => [['id', item.id], ['version', String(item.version)]] as Array<[string, string]>);
}

it('clears reviewed bought rows for a parent and returns the cleared count', async () => {
  const db = await setup();
  try {
    const apples = addGrocery(db, 'parent', 'home', { name: 'Synthetic action apples', quantity: '2', unit: 'bags' });
    const bread = bought(db, 'parent', 'home', 'Synthetic action bread');
    const milk = bought(db, 'parent', 'home', 'Synthetic action milk');
    useSession(db, 'parent');

    const result = await submit(selectionFields([bread, milk])) as { clear: { ok: boolean; cleared: number } };
    expect(result).toEqual({ clear: { ok: true, cleared: 2 } });
    expect(listGroceries(db, 'kid', 'home')).toMatchObject([{ id: apples, completed: false }]);
  } finally { db.close(); }
});

it('rejects anonymous, child, disabled and cross-origin clear requests', async () => {
  const db = await setup();
  try {
    const bread = bought(db, 'parent', 'home', 'Synthetic guarded bread');
    const fields = selectionFields([bread]);

    useSession(db, null);
    await expect(submit(fields)).rejects.toMatchObject({ status: 303, location: '/sign-in' });
    await expect(submit(fields, { cookie: 'fleck_display=synthetic-display-token' })).rejects.toMatchObject({ status: 303, location: '/sign-in' });

    useSession(db, 'kid');
    expect(await submit(fields)).toMatchObject({ status: 403, data: { message: 'Request not authorized.' } });
    expect(await submit(fields, { origin: 'https://other.example.test' })).toMatchObject({ status: 403 });

    useSession(db, 'disabled');
    await expect(submit(fields)).rejects.toMatchObject({ status: 403 });

    useSession(db, 'outsider');
    expect(await submit(selectionFields([bread]))).toMatchObject({ status: 409 });

    expect(listGroceries(db, 'parent', 'home')).toMatchObject([{ id: bread.id, completed: true }]);
  } finally { db.close(); }
});

it('reports a concurrent change without deleting the reviewed rows', async () => {
  const db = await setup();
  try {
    const bread = bought(db, 'parent', 'home', 'Synthetic conflict bread');
    const milk = bought(db, 'parent', 'home', 'Synthetic conflict milk');
    useSession(db, 'parent');
    changeGrocery(db, 'kid', 'home', bread.id, bread.version, { name: 'Synthetic conflict bread', quantity: '', unit: '', completed: false });

    const result = await submit(selectionFields([bread, milk])) as { status: number; data: { clear: { ok: boolean; changed: boolean; message: string } } };
    expect(result.status).toBe(409);
    expect(result.data.clear).toMatchObject({ ok: false, changed: true });
    expect(result.data.clear.message).toMatch(/changed/i);
    expect(listGroceries(db, 'parent', 'home')).toHaveLength(2);
  } finally { db.close(); }
});

it('rejects malformed, duplicated and oversized clear submissions before writing', async () => {
  const db = await setup();
  try {
    const bread = bought(db, 'parent', 'home', 'Synthetic malformed bread');
    useSession(db, 'parent');

    expect(await submit([['id', bread.id]])).toMatchObject({ status: 400, data: { clear: { ok: false } } });
    expect(await submit([...selectionFields([bread]), ['id', bread.id], ['version', '2']])).toMatchObject({ status: 400 });
    expect(await submit([['id', bread.id], ['version', 'not-a-version']])).toMatchObject({ status: 400 });
    expect(await submit(selectionFields([bread]), { contentLength: '100000' })).toMatchObject({ status: 413 });

    const oversized = new Request(`${origin}/groceries?/clearBought`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
      body: `id=${'x'.repeat(70 * 1024)}&version=1`
    });
    expect(await (actions.clearBought as ClearAction)({ request: oversized })).toMatchObject({ status: 413 });

    expect(listGroceries(db, 'parent', 'home')).toMatchObject([{ id: bread.id, completed: true }]);
  } finally { db.close(); }
});
