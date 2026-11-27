import { afterEach, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../src/lib/server/identity';
import { getIdentityServices } from '../src/lib/server/runtime';
import { parentHousehold } from '../src/lib/server/parent-household';
import { load as loadDisplaySettings } from '../src/routes/display/settings/+page.server';
import { load as loadHouseholdSettings } from '../src/routes/settings/household/+page.server';
import { load as loadDisplays } from '../src/routes/settings/displays/+page.server';

vi.mock('../src/lib/server/runtime', () => ({ getIdentityServices: vi.fn() }));
afterEach(() => vi.resetAllMocks());

const origin = 'http://localhost';

/**
 * `multi` is a kid in the household whose id sorts first, and a parent in two others whose
 * name and id orders disagree: by id `b-second` wins, by name `Aardvark` (id `z-first`) wins.
 */
async function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  await migrate(db);
  db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run('multi', 'multi', 'multi@example.test');
  for (const [id, name] of [['a-kid-only', 'Zeta kids'], ['b-second', 'Beta'], ['z-first', 'Aardvark']]) db.prepare('INSERT INTO household VALUES (?, ?)').run(id, name);
  db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('multi', 'a-kid-only', 'kid');
  db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('multi', 'b-second', 'parent');
  db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('multi', 'z-first', 'parent');
  vi.mocked(getIdentityServices).mockReturnValue({
    auth: { api: { getSession: async () => ({ user: { id: 'multi' } }) } }, db, origin
  } as unknown as ReturnType<typeof getIdentityServices>);
  return db;
}

const request = new Request(`${origin}/x`);
const event = (search = '') => ({ request, url: new URL(`${origin}/x${search}`) }) as never;

it('defaults every parent settings route to the same parent household, ignoring kid memberships', async () => {
  const db = await setup();
  try {
    const display = await loadDisplaySettings(event()) as { householdId: string; households: { id: string }[] };
    const household = await loadHouseholdSettings(event()) as { householdId: string };
    const displays = await loadDisplays(event()) as { householdId: string };
    const children = await parentHousehold(request);
    expect(display.householdId).toBe('z-first');
    expect(household.householdId).toBe('z-first');
    expect(displays.householdId).toBe('z-first');
    expect(children.household.id).toBe('z-first');
    expect(display.households.map(item => item.id)).toEqual(['z-first', 'b-second']);
  } finally { db.close(); }
});

it('still honours an explicit parent household and refuses a household where the caller is only a kid', async () => {
  const db = await setup();
  try {
    expect(((await loadDisplaySettings(event('?household=b-second'))) as { householdId: string }).householdId).toBe('b-second');
    expect((await parentHousehold(request, 'b-second')).household.id).toBe('b-second');
    await expect(Promise.resolve().then(() => loadDisplaySettings(event('?household=a-kid-only')))).rejects.toMatchObject({ status: 403 });
    await expect(parentHousehold(request, 'a-kid-only')).rejects.toMatchObject({ status: 403 });
  } finally { db.close(); }
});
