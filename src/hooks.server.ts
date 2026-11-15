import { building } from '$app/env';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { isManagedEmail } from './lib/server/managed-children';
import { getIdentityServices } from './lib/server/runtime';

// Managed accounts change profile and credentials through household settings.
const managedAuthPaths = new Set(['/api/auth/ok', '/api/auth/get-session', '/api/auth/sign-in/email', '/api/auth/sign-out']);

async function canUseEmailSignIn(request: Request) {
  const type = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  const copy = request.clone();
  if (type === 'application/json') {
    const email: unknown = (await copy.json() as { email?: unknown } | null)?.email;
    return typeof email === 'string' && !isManagedEmail(email);
  }
  if (type === 'application/x-www-form-urlencoded' || type === 'multipart/form-data') {
    const emails = (await copy.formData()).getAll('email');
    return emails.length === 1 && typeof emails[0] === 'string' && !isManagedEmail(emails[0]);
  }
  return false;
}

export const handle: Handle = async ({ event, resolve }) => {
  let response: Response;
  if (event.url.pathname.startsWith('/api/auth/')) {
    try {
      const path = event.url.pathname.replace(/\/+$/, '');
      if (path === '/api/auth/sign-in/email' && event.request.method === 'POST' && !await canUseEmailSignIn(event.request).catch(() => false)) {
        response = new Response(null, { status: 401 });
      } else {
        const { auth } = getIdentityServices();
        const session = managedAuthPaths.has(path) ? null : await auth.api.getSession({ headers: event.request.headers });
        if (session && isManagedEmail(session.user.email)) {
          response = new Response(null, { status: 403 });
        } else {
          response = await svelteKitHandler({ event, resolve, auth, building });
        }
        if (path === '/api/auth/get-session' && response.ok && response.headers.get('content-type')?.includes('application/json')) {
          const payload = await response.clone().json() as { user?: { email?: string }; session?: { token?: string } } | null;
          if (payload?.user?.email && isManagedEmail(payload.user.email)) {
            delete payload.user.email;
            if (payload.session) delete payload.session.token;
            const headers = new Headers(response.headers);
            headers.delete('content-length');
            response = Response.json(payload, { headers, status: response.status });
          }
        }
      }
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
  if (event.url.pathname.startsWith('/chores/recovery') || event.url.pathname === '/dashboard' || (event.url.pathname === '/expenses' || event.url.pathname.startsWith('/expenses/')) || event.url.pathname.startsWith('/display') || event.url.pathname.startsWith('/calendar') || event.url.pathname.startsWith('/meals') || event.url.pathname.startsWith('/groceries') || event.url.pathname.startsWith('/settings/sessions') || event.url.pathname.startsWith('/api/')) response.headers.set('cache-control', 'no-store');
  return response;
};
