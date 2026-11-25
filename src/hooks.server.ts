import { building } from '$app/env';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { handleAuthRequest } from './lib/server/auth-request';
import { getIdentityServices } from './lib/server/runtime';

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
  response.headers.set('x-content-type-options', 'nosniff');
  response.headers.set('x-frame-options', 'DENY');
  response.headers.set('referrer-policy', event.url.pathname.startsWith('/accept-invitation') || event.url.pathname.startsWith('/settings/household') ? 'origin' : 'same-origin');
  if (event.url.pathname === '/' || event.url.pathname === '/setup' || event.url.pathname === '/onboarding' || event.url.pathname.startsWith('/settings/children') || event.url.pathname.startsWith('/sign-in/child') || event.url.pathname.startsWith('/accept-invitation') || event.url.pathname.startsWith('/settings/household') || event.url.pathname.startsWith('/settings/displays')) response.headers.set('cache-control', 'no-store');
  if (event.url.pathname.startsWith('/chores/recovery') || event.url.pathname.startsWith('/chores/history') || event.url.pathname.startsWith('/chores/series') || event.url.pathname.startsWith('/earnings/') || event.url.pathname.startsWith('/verify') || event.url.pathname === '/dashboard' || (event.url.pathname === '/expenses' || event.url.pathname.startsWith('/expenses/')) || event.url.pathname.startsWith('/display') || event.url.pathname.startsWith('/calendar') || event.url.pathname.startsWith('/meals') || event.url.pathname.startsWith('/groceries') || event.url.pathname.startsWith('/settings/sessions') || event.url.pathname.startsWith('/api/')) response.headers.set('cache-control', 'no-store');
  if (event.url.pathname === '/lists' || event.url.pathname.startsWith('/lists/')) response.headers.set('cache-control', 'no-store');
  return response;
};
