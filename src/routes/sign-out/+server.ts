import type { RequestHandler } from './$types';
import { getIdentityServices } from '../../lib/server/runtime';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const { auth, origin } = getIdentityServices();
    if (request.headers.get('origin') !== origin) return new Response('Request not authorized', { status: 403 });
    const headers = new Headers(request.headers);
    headers.set('content-type', 'application/json');
    const response = await auth.handler(new Request(new URL('/api/auth/sign-out', origin), { method: 'POST', headers, body: '{}' }));
    if (!response.ok) return new Response('Unable to sign out. Please try again.', { status: 503 });
    const result = new Headers({ location: '/', 'cache-control': 'no-store' });
    for (const cookie of response.headers.getSetCookie()) result.append('set-cookie', cookie);
    return new Response(null, { status: 303, headers: result });
  } catch {
    return new Response('Unable to sign out. Please try again.', { status: 503 });
  }
};
