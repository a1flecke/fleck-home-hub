import { afterEach, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { getIdentityServices } from '../src/lib/server/runtime';
import { readIdentityConfig } from '../src/lib/server/config';
import { redeemInvitation } from '../src/lib/server/invitations';
import { actions } from '../src/routes/accept-invitation/+page.server';

vi.mock('../src/lib/server/runtime', () => ({ getIdentityServices: vi.fn() }));
vi.mock('../src/lib/server/config', () => ({ readIdentityConfig: vi.fn() }));
vi.mock('../src/lib/server/invitations', () => ({ redeemInvitation: vi.fn() }));

afterEach(() => vi.resetAllMocks());

const origin = 'http://localhost:3000';
const validToken = 'a'.repeat(43);

type ActionFn = (event: { request: Request }) => Promise<unknown>;

function postForm(fields: Record<string, string>, headerOrigin = origin) {
  const body = new URLSearchParams(fields);
  return new Request(`${origin}/accept-invitation`, {
    method: 'POST',
    headers: { origin: headerOrigin, 'content-type': 'application/x-www-form-urlencoded' },
    body
  });
}

it('returns 503 when identity services are unavailable instead of opening a fresh database', async () => {
  vi.mocked(getIdentityServices).mockImplementation(() => {
    throw new Error('Identity service not configured');
  });

  const result = await (actions.default as unknown as ActionFn)({
    request: postForm({ token: validToken, name: 'Test', email: 'test@example.test', password: 'synthetic-password-123' })
  });
  expect(result).toMatchObject({ status: 503 });
  expect(redeemInvitation).not.toHaveBeenCalled();
});

it('reuses the shared identity DB, trims inputs, and rejects oversized or managed inputs before calling redeemInvitation', async () => {
  const fakeDb = { name: '/synthetic/shared.sqlite' } as unknown as Database.Database;
  vi.mocked(getIdentityServices).mockReturnValue({
    db: fakeDb,
    origin
  } as unknown as ReturnType<typeof getIdentityServices>);
  vi.mocked(readIdentityConfig).mockReturnValue({
    secret: 'synthetic-secret-value-at-least-32-chars',
    origin,
    dbPath: '/synthetic/should-not-be-passed.sqlite'
  });
  vi.mocked(redeemInvitation).mockResolvedValue('user-1');

  const tooLongName = await (actions.default as unknown as ActionFn)({
    request: postForm({ token: validToken, name: 'n'.repeat(101), email: 'ok@example.test', password: 'synthetic-password-123' })
  });
  expect(tooLongName).toMatchObject({ status: 400 });

  const tooLongEmail = await (actions.default as unknown as ActionFn)({
    request: postForm({ token: validToken, name: 'Ok', email: `${'e'.repeat(245)}@example.test`, password: 'synthetic-password-123' })
  });
  expect(tooLongEmail).toMatchObject({ status: 400 });

  const tooLongPassword = await (actions.default as unknown as ActionFn)({
    request: postForm({ token: validToken, name: 'Ok', email: 'ok@example.test', password: 'p'.repeat(129) })
  });
  expect(tooLongPassword).toMatchObject({ status: 400 });

  const managed = await (actions.default as unknown as ActionFn)({
    request: postForm({ token: validToken, name: 'Ok', email: '  kid@children.fleck.invalid  ', password: 'synthetic-password-123' })
  });
  expect(managed).toMatchObject({ status: 400 });
  expect(redeemInvitation).not.toHaveBeenCalled();

  await expect((actions.default as unknown as ActionFn)({
    request: postForm({
      token: ` ${validToken} `,
      name: '  New Parent  ',
      email: '  new-parent@example.test  ',
      password: 'synthetic-password-123'
    })
  })).rejects.toMatchObject({ status: 303, location: '/accept-invitation?success=1' });

  expect(redeemInvitation).toHaveBeenCalledTimes(1);
  expect(redeemInvitation).toHaveBeenCalledWith(
    fakeDb,
    { secret: 'synthetic-secret-value-at-least-32-chars', origin },
    validToken,
    { name: 'New Parent', email: 'new-parent@example.test', password: 'synthetic-password-123' }
  );
});
