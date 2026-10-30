import { building } from '$app/env';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { getIdentityServices } from './lib/server/runtime';

export const handle: Handle = async ({ event, resolve }) => {
  let response: Response;
  if (event.url.pathname.startsWith('/api/auth/')) {
    try {
      response = await svelteKitHandler({ event, resolve, auth: getIdentityServices().auth, building });
    } catch {
      response = new Response('Identity service unavailable', { status: 503 });
    }
  } else {
    response = await resolve(event);
  }
  response.headers.set('x-content-type-options', 'nosniff');
  response.headers.set('x-frame-options', 'DENY');
  response.headers.set('referrer-policy', 'same-origin');
  if (event.url.pathname === '/dashboard' || event.url.pathname.startsWith('/display') || event.url.pathname.startsWith('/calendar') || event.url.pathname.startsWith('/api/')) response.headers.set('cache-control', 'no-store');
  return response;
};
