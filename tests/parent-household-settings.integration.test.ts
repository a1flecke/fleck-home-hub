import { afterEach, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../src/lib/server/identity';
import { getIdentityServices } from '../src/lib/server/runtime';
import { parentHousehold } from '../src/lib/server/parent-household';
import { actions as displaySettingsActions, load as loadDisplaySettings } from '../src/routes/display/settings/+page.server';
import { load as loadSettingsDisplays } from '../src/routes/settings/displays/+page.server';
import { load as loadSettingsHousehold } from '../src/routes/settings/household/+page.server';

vi.mock('../src/lib/server/runtime', () => ({ getIdentityServices: vi.fn() }));
afterEach(() => vi.resetAllMocks());

const origin = 'http://localhost';

async function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  await migrate(db);
  for (const id of ['mixed-user', 'two-parent', 'kid-only']) {
    db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, `${id}@example.test`);
  }
  db.prepare('INSERT INTO household VALUES (?, ?)').run('a-kid-home', 'Alpha Kid Home');
  db.prepare('INSERT INTO household VALUES (?, ?)').run('b-parent-home', 'Beta Parent Home');
  db.prepare('INSERT INTO household VALUES (?, ?)').run('a-zeta-id', 'Zeta Home');
  db.prepare('INSERT INTO household VALUES (?, ?)').run('z-alpha-id', 'Alpha Home');

  // mixed-user has lowest-id membership as 'kid' and a second membership as 'parent'.
  db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('mixed-user', 'a-kid-home', 'kid');
  db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('mixed-user', 'b-parent-home', 'parent');

  // two-parent is a parent in two households whose id order and name order differ.
  db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('two-parent', 'a-zeta-id', 'parent');
  db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('two-parent', 'z-alpha-id', 'parent');

  // kid-only has no parent memberships anywhere.
  db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('kid-only', 'a-kid-home', 'kid');
  return db;
}

function useSession(db: Database.Database, userId: string | null) {
  vi.mocked(getIdentityServices).mockReturnValue({
    auth: { api: { getSession: async () => userId ? { user: { id: userId } } : null } },
    db,
    origin
  } as unknown as ReturnType<typeof getIdentityServices>);
}

type Loader = (event: { request: Request; url: URL }) => Promise<{ householdId: string; households: { id: string; name: string }[] }>;
type ShareAction = (event: { request: Request; url: URL }) => Promise<unknown>;

it('allows a multi-household parent onto /display/settings even when their lowest-id membership is a kid', async () => {
  const db = await setup();
  try {
    useSession(db, 'mixed-user');
    const url = new URL(`${origin}/display/settings`);
    const loaded = await (loadDisplaySettings as unknown as Loader)({ request: new Request(url), url });
    expect(loaded.householdId).toBe('b-parent-home');
    expect(loaded.households).toEqual([{ id: 'b-parent-home', name: 'Beta Parent Home' }]);

    // Explicitly requesting the kid household is still rejected with 403 on load and action.
    const kidUrl = new URL(`${origin}/display/settings?household=a-kid-home`);
    await expect((loadDisplaySettings as unknown as Loader)({ request: new Request(kidUrl), url: kidUrl })).rejects.toMatchObject({ status: 403 });
    const form = new URLSearchParams({ kind: 'event', id: 'x', visible: 'yes' });
    const post = new Request(kidUrl, { method: 'POST', headers: { origin, 'content-type': 'application/x-www-form-urlencoded' }, body: form });
    await expect((displaySettingsActions.share as unknown as ShareAction)({ request: post, url: kidUrl })).rejects.toMatchObject({ status: 403 });

    // A user with no parent memberships anywhere still gets 403.
    useSession(db, 'kid-only');
    await expect((loadDisplaySettings as unknown as Loader)({ request: new Request(url), url })).rejects.toMatchObject({ status: 403 });
  } finally { db.close(); }
});

it('uses consistent (name, id) default parent-household ordering across all settings routes and parentHousehold', async () => {
  const db = await setup();
  try {
    useSession(db, 'two-parent');
    const displayUrl = new URL(`${origin}/display/settings`);
    const displaysUrl = new URL(`${origin}/settings/displays`);
    const householdUrl = new URL(`${origin}/settings/household`);

    const displayData = await (loadDisplaySettings as unknown as Loader)({ request: new Request(displayUrl), url: displayUrl });
    const displaysData = await (loadSettingsDisplays as unknown as Loader)({ request: new Request(displaysUrl), url: displaysUrl });
    const householdData = await (loadSettingsHousehold as unknown as Loader)({ request: new Request(householdUrl), url: householdUrl });
    const helper = await parentHousehold(new Request(householdUrl), null);

    expect(displayData.householdId).toBe('z-alpha-id');
    expect(displaysData.householdId).toBe('z-alpha-id');
    expect(householdData.householdId).toBe('z-alpha-id');
    expect(helper.household.id).toBe('z-alpha-id');

    // Explicit ?household= still selects the requested parent household and rejects non-owned ones.
    const selectedUrl = new URL(`${origin}/display/settings?household=a-zeta-id`);
    expect((await (loadDisplaySettings as unknown as Loader)({ request: new Request(selectedUrl), url: selectedUrl })).householdId).toBe('a-zeta-id');
    expect((await parentHousehold(new Request(selectedUrl), 'a-zeta-id')).household.id).toBe('a-zeta-id');
    await expect(parentHousehold(new Request(selectedUrl), 'a-kid-home')).rejects.toMatchObject({ status: 403 });
  } finally { db.close(); }
});
