import { afterEach, expect, it, vi } from 'vitest';
import { getIdentityServices } from '../src/lib/server/runtime';
import { parentHousehold } from '../src/lib/server/parent-household';
import { actions as sessionActions, load as loadSessions } from '../src/routes/settings/sessions/+page.server';
import { load as loadExpenses } from '../src/routes/expenses/+page.server';
import { load as loadRecovery } from '../src/routes/chores/recovery/+page.server';
import { load as loadHouseholdSettings } from '../src/routes/settings/household/+page.server';
import { load as loadSetup } from '../src/routes/setup/+page.server';
import { actions as childSignInActions } from '../src/routes/sign-in/child/+page.server';

vi.mock('../src/lib/server/runtime', () => ({ getIdentityServices: vi.fn() }));
afterEach(() => vi.resetAllMocks());

const origin = 'http://localhost';

type LoadFn = (event: { request: Request; url: URL }) => Promise<unknown>;
type ActionFn = (event: { request: Request; setHeaders?: (h: Record<string, string>) => void }) => Promise<unknown>;

it('throws an HttpError (never ActionFailure) from /settings/sessions load on unexpected errors and redirects when signed out', async () => {
  vi.mocked(getIdentityServices).mockReturnValue({
    auth: {
      api: {
        getSession: async () => { throw new Error('database busy'); }
      }
    },
    origin
  } as unknown as ReturnType<typeof getIdentityServices>);

  const url = new URL(`${origin}/settings/sessions`);
  await expect((loadSessions as unknown as LoadFn)({ request: new Request(url), url })).rejects.toMatchObject({ status: 503 });

  // Signed-out still redirects cleanly to /sign-in.
  vi.mocked(getIdentityServices).mockReturnValue({
    auth: {
      api: {
        getSession: async () => null
      }
    },
    origin
  } as unknown as ReturnType<typeof getIdentityServices>);
  await expect((loadSessions as unknown as LoadFn)({ request: new Request(url), url })).rejects.toMatchObject({ status: 303, location: '/sign-in' });
});

it('returns 503 when identity services are unavailable across /settings/sessions and sibling routes', async () => {
  vi.mocked(getIdentityServices).mockImplementation(() => {
    throw new Error('Identity service not configured');
  });

  const url = new URL(`${origin}/settings/sessions`);
  const req = new Request(url, { method: 'POST', headers: { origin } });

  await expect((loadSessions as unknown as LoadFn)({ request: new Request(url), url })).rejects.toMatchObject({ status: 503 });
  await expect((sessionActions.revoke as unknown as ActionFn)({ request: req })).rejects.toMatchObject({ status: 503 });
  await expect((sessionActions.revokeOthers as unknown as ActionFn)({ request: req })).rejects.toMatchObject({ status: 503 });
  await expect((loadExpenses as unknown as LoadFn)({ request: new Request(url), url })).rejects.toMatchObject({ status: 503 });
  await expect((loadRecovery as unknown as LoadFn)({ request: new Request(url), url })).rejects.toMatchObject({ status: 503 });
  await expect((loadHouseholdSettings as unknown as LoadFn)({ request: new Request(url), url })).rejects.toMatchObject({ status: 503 });
  expect(() => (loadSetup as unknown as () => unknown)()).toThrow();
  try {
    (loadSetup as unknown as () => unknown)();
  } catch (err) {
    expect(err).toMatchObject({ status: 503 });
  }
  await expect(parentHousehold(new Request(url))).rejects.toMatchObject({ status: 503 });

  const childRes = await (childSignInActions.default as unknown as ActionFn)({
    request: req,
    setHeaders: () => {}
  });
  expect(childRes).toMatchObject({ status: 503 });
});
