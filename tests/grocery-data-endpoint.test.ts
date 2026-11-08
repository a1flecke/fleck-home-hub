import { afterEach, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../src/lib/server/identity';
import { addGrocery } from '../src/lib/server/groceries';
import { getIdentityServices } from '../src/lib/server/runtime';
import { GET } from '../src/routes/groceries/data/+server';

vi.mock('../src/lib/server/runtime', () => ({ getIdentityServices: vi.fn() }));
afterEach(() => vi.resetAllMocks());

async function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  await migrate(db);
  for (const id of ['parent', 'kid', 'disabled', 'outsider']) {
    db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, `${id}@example.test`);
  }
  for (const id of ['home', 'other']) db.prepare('INSERT INTO household VALUES (?, ?)').run(id, id);
  db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('parent', 'home', 'parent');
  db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('kid', 'home', 'kid');
  db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('outsider', 'other', 'parent');
  return db;
}

function useSession(db: Database.Database, userId: string | null) {
  vi.mocked(getIdentityServices).mockReturnValue({
    auth: { api: { getSession: async () => userId ? { user: { id: userId } } : null } },
    db
  } as unknown as ReturnType<typeof getIdentityServices>);
}

async function requestData() {
  return GET({ request: new Request('http://localhost/groceries/data') } as Parameters<typeof GET>[0]);
}

it('returns only the caller household in no-store JSON', async () => {
  const db = await setup();
  try {
    addGrocery(db, 'parent', 'home', { name: 'Synthetic home oats', quantity: '2', unit: 'bags' });
    addGrocery(db, 'outsider', 'other', { name: 'Synthetic other secret', quantity: '', unit: '' });
    useSession(db, 'kid');

    const response = await requestData();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    const body = await response.json() as { items: Record<string, unknown>[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ name: 'Synthetic home oats', quantity: '2', unit: 'bags', completed: false });
    expect(Object.keys(body.items[0]).sort()).toEqual(['completed', 'id', 'name', 'quantity', 'unit', 'version']);
    expect(JSON.stringify(body)).not.toContain('Synthetic other secret');
  } finally { db.close(); }
});

it('denies anonymous and disabled members with distinct responses', async () => {
  const db = await setup();
  try {
    useSession(db, null);
    let response = await requestData();
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toEqual({ error: 'unauthenticated' });

    useSession(db, 'disabled');
    response = await requestData();
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toEqual({ error: 'forbidden' });
  } finally { db.close(); }
});

it('reports a database failure as temporary instead of forbidden', async () => {
  const db = await setup();
  useSession(db, 'parent');
  db.close();

  const response = await requestData();
  expect(response.status).toBe(503);
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(await response.json()).toEqual({ error: 'unavailable' });
});
