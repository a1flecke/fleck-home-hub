import { afterEach, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../src/lib/server/identity';
import { addGrocery, listGroceries } from '../src/lib/server/groceries';
import { getIdentityServices } from '../src/lib/server/runtime';
import { actions } from '../src/routes/groceries/bulk/+page.server';
import { bulkItemKey, MAX_BULK_INPUT_CHARS, MAX_BULK_LINES, type BulkDecision } from '../src/lib/grocery/bulk';

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

type Action = (event: { request: Request }) => Promise<unknown>;

function request(action: 'review' | 'confirm', fields: Array<[string, string]>, options: { origin?: string | null; contentLength?: string; cookie?: string } = {}) {
  const body = new URLSearchParams();
  for (const [name, value] of fields) body.append(name, value);
  const headers = new Headers({ 'content-type': 'application/x-www-form-urlencoded' });
  if (options.origin !== null) headers.set('origin', options.origin ?? origin);
  if (options.contentLength !== undefined) headers.set('content-length', options.contentLength);
  if (options.cookie !== undefined) headers.set('cookie', options.cookie);
  return new Request(`${origin}/groceries/bulk?/${action}`, { method: 'POST', headers, body });
}

async function review(fields: Array<[string, string]>, options?: { origin?: string | null; contentLength?: string; cookie?: string }) {
  return (actions.review as Action)({ request: request('review', fields, options) });
}

async function confirm(fields: Array<[string, string]>, options?: { origin?: string | null; contentLength?: string; cookie?: string }) {
  return (actions.confirm as Action)({ request: request('confirm', fields, options) });
}

function decision(index: number, line: string, name: string, quantity = '', unit = '', action: 'add' | 'skip' = 'add'): BulkDecision {
  return { key: bulkItemKey(index), line, action, name, quantity, unit };
}

function confirmFields(decisions: BulkDecision[]): Array<[string, string]> {
  return [
    ['rowCount', String(decisions.length)],
    ...decisions.flatMap((decision, index) => [
      [`key-${index}`, decision.key],
      [`line-${index}`, decision.line],
      [`action-${index}`, decision.action],
      [`name-${index}`, decision.name],
      [`quantity-${index}`, decision.quantity],
      [`unit-${index}`, decision.unit]
    ] as Array<[string, string]>)
  ];
}

it('previews parsed lines without writing and defaults existing or duplicate rows to skip', async () => {
  const db = await setup();
  try {
    addGrocery(db, 'parent', 'home', { name: 'milk', quantity: '1', unit: 'gallon' });
    const before = listGroceries(db, 'parent', 'home');
    useSession(db, 'parent');

    const result = await review([['list', '2 gallons milk\n3 apples\n2 apples\nFresh basil']]) as { review: { items: Array<Record<string, unknown>>; toAdd: number; toSkip: number } };
    expect(result.review.items).toMatchObject([
      { line: '2 gallons milk', name: 'milk', quantity: '2', unit: 'gallons', action: 'skip', existing: { name: 'milk' } },
      { line: '3 apples', name: 'apples', quantity: '3', unit: '', action: 'add', existing: null },
      { line: '2 apples', name: 'apples', quantity: '2', unit: '', action: 'skip', duplicateOfBatch: true },
      { line: 'Fresh basil', name: 'Fresh basil', quantity: '', unit: '', action: 'add' }
    ]);
    expect(result.review).toMatchObject({ toAdd: 2, toSkip: 2 });
    expect(listGroceries(db, 'parent', 'home')).toEqual(before);
  } finally { db.close(); }
});

it('keeps pasted text on review errors without writing', async () => {
  const db = await setup();
  try {
    useSession(db, 'parent');
    const tooMany = Array.from({ length: MAX_BULK_LINES + 1 }, (_, index) => `synthetic item ${index}`).join('\n');

    expect(await review([['list', tooMany]])).toMatchObject({ status: 400, data: { list: tooMany } });
    expect(await review([['list', '']])).toMatchObject({ status: 400, data: { list: '' } });
    const large = 'x'.repeat(MAX_BULK_INPUT_CHARS + 1);
    expect(await review([['list', large]])).toMatchObject({ status: 400, data: { list: large } });
    expect(await review([['list', '2 cups rice']], { contentLength: String(70 * 1024) })).toMatchObject({ status: 413 });

    const oversized = new Request(`${origin}/groceries/bulk?/review`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
      body: `list=${'x'.repeat(70 * 1024)}`
    });
    expect(await (actions.review as Action)({ request: oversized })).toMatchObject({ status: 413 });
    expect(listGroceries(db, 'parent', 'home')).toEqual([]);
  } finally { db.close(); }
});

it('adds selected rows and redirects with the counts', async () => {
  const db = await setup();
  try {
    useSession(db, 'parent');
    await expect(confirm(confirmFields([
      decision(0, '2 gallons milk', 'milk', '2', 'gallons'),
      decision(1, '3 apples', 'apples', '3'),
      decision(2, 'Fresh basil', 'Fresh basil', '', '', 'skip')
    ]))).rejects.toMatchObject({ status: 303, location: '/groceries?added=2&skipped=1' });
    expect(listGroceries(db, 'kid', 'home')).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'milk', quantity: '2', unit: 'gallons' }),
      expect.objectContaining({ name: 'apples', quantity: '3', unit: '' })
    ]));
    expect(listGroceries(db, 'kid', 'home')).toHaveLength(2);
  } finally { db.close(); }
});

it('allows an active child and rejects anonymous, disabled, display-only and cross-origin requests', async () => {
  const db = await setup();
  try {
    const fields = confirmFields([decision(0, '2 cups rice', 'rice', '2', 'cups')]);

    useSession(db, 'kid');
    await expect(confirm(fields)).rejects.toMatchObject({ status: 303 });

    useSession(db, null);
    await expect(confirm(fields)).rejects.toMatchObject({ status: 303, location: '/sign-in' });
    await expect(confirm(fields, { cookie: 'fleck_display=synthetic-display-token' })).rejects.toMatchObject({ status: 303, location: '/sign-in' });

    useSession(db, 'disabled');
    await expect(confirm(confirmFields([decision(0, '3 apples', 'apples', '3')]))).rejects.toMatchObject({ status: 403 });

    useSession(db, 'parent');
    expect(await confirm(fields, { origin: 'https://other.example.test' })).toMatchObject({ status: 403 });
    expect(await review([['list', '3 pears']], { origin: null })).toMatchObject({ status: 403 });

    expect(listGroceries(db, 'parent', 'home')).toMatchObject([{ name: 'rice', quantity: '2', unit: 'cups' }]);
  } finally { db.close(); }
});

it('returns the reviewed proposals when a matching item appears before confirmation', async () => {
  const db = await setup();
  try {
    useSession(db, 'parent');
    const decisions = [decision(0, '2 gallons milk', 'milk', '9', 'gallons'), decision(1, '3 apples', 'apples', '3')];
    addGrocery(db, 'kid', 'home', { name: 'milk', quantity: '1', unit: 'gallon' });
    const before = listGroceries(db, 'parent', 'home');

    const result = await confirm(confirmFields(decisions)) as { status: number; data: { message: string; review: { items: Array<Record<string, unknown>> } } };
    expect(result.status).toBe(409);
    expect(result.data.message).toMatch(/changed|match/i);
    expect(result.data.review.items[0]).toMatchObject({
      name: 'milk',
      quantity: '9',
      unit: 'gallons',
      action: 'add',
      existing: { name: 'milk', quantity: '1', unit: 'gallon' }
    });
    expect(result.data.review.items[1]).toMatchObject({ name: 'apples', action: 'add' });
    expect(listGroceries(db, 'parent', 'home')).toEqual(before);
  } finally { db.close(); }
});

it('keeps edited values and the review visible after validation and conflict recovery', async () => {
  const db = await setup();
  try {
    useSession(db, 'parent');
    const invalid = await confirm(confirmFields([
      decision(0, '1 loaf bread', '   ', '4', 'bags'),
      decision(1, '2 cups rice', 'rice', '2', 'cups')
    ])) as { status: number; data: { message: string; review: { items: Array<Record<string, unknown>> } } };
    expect(invalid.status).toBe(400);
    expect(invalid.data.review.items[0]).toMatchObject({ name: '   ', quantity: '4', unit: 'bags' });
    expect(invalid.data.review.items[1]).toMatchObject({ name: 'rice', quantity: '2', unit: 'cups' });
    expect(listGroceries(db, 'parent', 'home')).toEqual([]);

    addGrocery(db, 'kid', 'home', { name: 'rice', quantity: '1', unit: 'bag' });
    const conflict = await confirm(confirmFields([
      decision(0, '1 loaf bread', 'sourdough bread', '4', 'bags'),
      decision(1, '2 cups rice', 'rice', '2', 'cups')
    ])) as { status: number; data: { review: { items: Array<Record<string, unknown>> } } };
    expect(conflict.status).toBe(409);
    expect(conflict.data.review.items[0]).toMatchObject({ name: 'sourdough bread', quantity: '4', unit: 'bags', action: 'add' });
    expect(conflict.data.review.items[1]).toMatchObject({ name: 'rice', action: 'add', existing: { name: 'rice' } });

    await expect(confirm(confirmFields([
      decision(0, '1 loaf bread', 'sourdough bread', '4', 'bags'),
      decision(1, '2 cups rice', 'rice', '2', 'cups', 'skip')
    ]))).rejects.toMatchObject({ status: 303, location: '/groceries?added=1&skipped=1' });
    expect(listGroceries(db, 'parent', 'home')).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'sourdough bread', quantity: '4', unit: 'bags' }),
      expect.objectContaining({ name: 'rice', quantity: '1', unit: 'bag' })
    ]));
  } finally { db.close(); }
});

it('rejects malformed submissions and repeated confirmations without duplicate rows', async () => {
  const db = await setup();
  try {
    useSession(db, 'parent');
    const valid = confirmFields([
      decision(0, '2 gallons milk', 'milk', '2', 'gallons'),
      decision(1, '3 apples', 'apples', '3')
    ]);

    expect(await confirm([])).toMatchObject({ status: 400 });
    expect(await confirm([['rowCount', '0']])).toMatchObject({ status: 400 });
    expect(await confirm([['rowCount', String(MAX_BULK_LINES + 1)]])).toMatchObject({ status: 400 });
    expect(await confirm(confirmFields([{ ...decision(0, '2 cups rice', 'rice', '2', 'cups'), action: 'keep' as 'add' }]))).toMatchObject({ status: 400 });
    expect(await confirm(confirmFields([decision(0, '2 cups rice', 'rice', '2', 'cups'), decision(0, '3 apples', 'apples', '3')]))).toMatchObject({ status: 400 });
    expect(await confirm(confirmFields([decision(0, '2 cups rice', 'rice', 'x'.repeat(61), 'cups')]))).toMatchObject({ status: 400 });
    expect(listGroceries(db, 'parent', 'home')).toEqual([]);

    await expect(confirm(valid)).rejects.toMatchObject({ status: 303, location: '/groceries?added=2&skipped=0' });
    expect(await confirm(valid)).toMatchObject({ status: 409 });
    expect(listGroceries(db, 'parent', 'home')).toHaveLength(2);
  } finally { db.close(); }
});

it('does not let a forged preview bypass normal grocery validation or duplicate checks', async () => {
  const db = await setup();
  try {
    useSession(db, 'parent');
    addGrocery(db, 'parent', 'home', { name: 'milk', quantity: '1', unit: 'gallon' });
    const forgedKey = decision(0, 'forged line', 'milk', '2', 'gallons');
    forgedKey.key = 'forged:preview';

    expect(await confirm(confirmFields([forgedKey]))).toMatchObject({ status: 409 });
    expect(await confirm(confirmFields([decision(0, 'forged line', '   ', '2', 'gallons')]))).toMatchObject({ status: 400 });
    expect(listGroceries(db, 'parent', 'home')).toMatchObject([{ name: 'milk', quantity: '1', unit: 'gallon' }]);
  } finally { db.close(); }
});

it('rejects a request body above the bulk limit before parses it', async () => {
  const db = await setup();
  try {
    useSession(db, 'parent');
    expect(await confirm([['rowCount', '1']], { contentLength: String(70 * 1024) })).toMatchObject({ status: 413 });
    const oversized = new Request(`${origin}/groceries/bulk?/confirm`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
      body: `rowCount=1&name-0=${'x'.repeat(70 * 1024)}`
    });
    expect(await (actions.confirm as Action)({ request: oversized })).toMatchObject({ status: 413 });
    expect(listGroceries(db, 'parent', 'home')).toEqual([]);
  } finally { db.close(); }
});
