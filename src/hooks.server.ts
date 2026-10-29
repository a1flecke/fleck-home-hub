import { building } from '$app/env';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { getIdentityServices } from './lib/server/runtime';

export const handle: Handle = async ({ event, resolve }) => {
  if (!event.url.pathname.startsWith('/api/auth/')) return resolve(event);
  try {
    return await svelteKitHandler({ event, resolve, auth: getIdentityServices().auth, building });
  } catch {
    return new Response('Identity service unavailable', { status: 503 });
  }
};
