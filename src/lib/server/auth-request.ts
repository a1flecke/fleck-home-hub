import type Database from 'better-sqlite3';
import { isManagedEmail } from './managed-children';
import type { createAuth } from './identity';

type Auth = ReturnType<typeof createAuth>;

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

function hasActiveMembership(db: Database.Database, userId: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM active_membership WHERE user_id = ? LIMIT 1').get(userId));
}

export async function handleAuthRequest(
  request: Request,
  pathname: string,
  services: { auth: Auth; db: Database.Database },
  dispatch: () => Promise<Response>
): Promise<Response> {
  const path = pathname.replace(/\/+$/, '');
  if (path === '/api/auth/sign-in/email' && request.method === 'POST' && !await canUseEmailSignIn(request).catch(() => false)) {
    return new Response(null, { status: 401 });
  }
  const session = managedAuthPaths.has(path) ? null : await services.auth.api.getSession({ headers: request.headers });
  if (session && (isManagedEmail(session.user.email) || !hasActiveMembership(services.db, session.user.id))) {
    return new Response(null, { status: 403 });
  }
  let response = await dispatch();
  if (path === '/api/auth/sign-in/email' && request.method === 'POST' && response.ok) {
    const payload = await response.clone().json().catch(() => null) as { token?: string; user?: { id?: string } } | null;
    if (!payload?.user?.id || !hasActiveMembership(services.db, payload.user.id)) {
      if (payload?.token) services.db.prepare('DELETE FROM session WHERE token = ?').run(payload.token);
      return new Response(null, { status: 401 });
    }
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
  return response;
}
