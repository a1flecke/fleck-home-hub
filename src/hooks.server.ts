import { building } from '$app/env';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { handleAuthRequest } from './lib/server/auth-request';
import { getIdentityServices } from './lib/server/runtime';
import { applySecurityHeaders } from './lib/server/security-headers';

export const handle: Handle = async ({ event, resolve }) => {
  let response: Response;
  if (event.url.pathname.startsWith('/api/auth/')) {
    try {
      const services = getIdentityServices();
      response = await handleAuthRequest(event.request, event.url.pathname, services, () => svelteKitHandler({ event, resolve, auth: services.auth, building }));
    } catch {
      response = new Response('Identity service unavailable', { status: 503 });
    }
  } else {
    response = await resolve(event);
  }
  return applySecurityHeaders(response, event.url.pathname);
};
