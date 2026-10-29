import { afterEach, expect, it, vi } from 'vitest';
import { getIdentityServices } from '../src/lib/server/runtime';
import { POST } from '../src/routes/sign-out/+server';

vi.mock('../src/lib/server/runtime', () => ({ getIdentityServices: vi.fn() }));
afterEach(() => vi.resetAllMocks());

it.each(['rejection', 'exception', 'startup failure'])('does not report successful sign-out after identity %s', async (failure) => {
  const sensitiveError = new Error('synthetic-private-database-detail');
  const handler = vi.fn(async () => {
    if (failure === 'exception') throw sensitiveError;
    return new Response('internal identity error', { status: 500 });
  });
  vi.mocked(getIdentityServices).mockImplementation(() => {
    if (failure === 'startup failure') throw sensitiveError;
    return { auth: { handler }, origin: 'http://localhost:3000' } as unknown as ReturnType<typeof getIdentityServices>;
  });
  const request = new Request('http://localhost:3000/sign-out', { method: 'POST', headers: { origin: 'http://localhost:3000' } });
  const response = await POST({ request } as Parameters<typeof POST>[0]);
  expect(response.status).toBe(503);
  expect(response.headers.get('location')).toBeNull();
  expect(response.headers.get('set-cookie')).toBeNull();
  expect(await response.text()).toBe('Unable to sign out. Please try again.');
});
