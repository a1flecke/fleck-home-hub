import type { createAuth } from './identity';

type Auth = ReturnType<typeof createAuth>;

/**
 * Account-level session management over Better Auth's own session API. Sessions are global
 * to an account and carry no household, so everything here is scoped to the signed-in user:
 * a parent never sees or revokes another person's sessions, and ending a session says nothing
 * about household membership (that is `household-access.ts`). Raw session tokens never leave
 * this module; callers get the session row id.
 */
export type SessionSummary = { id: string; current: boolean; device: string; createdAt: number; lastActiveAt: number; expiresAt: number };

export class SessionManagementError extends Error {
  constructor(readonly code: 'signed-out' | 'reauthenticate' | 'unavailable') { super(code); }
}

function describeDevice(userAgent: string | null | undefined) {
  if (!userAgent) return 'Unknown device';
  const browser = /Edg\//.test(userAgent) ? 'Edge' : /Firefox\//.test(userAgent) ? 'Firefox' : /Chrome\//.test(userAgent) ? 'Chrome' : /Safari\//.test(userAgent) ? 'Safari' : 'Browser';
  const system = /iPhone|iPad/.test(userAgent) ? 'iOS' : /Android/.test(userAgent) ? 'Android' : /Mac OS X/.test(userAgent) ? 'macOS' : /Windows/.test(userAgent) ? 'Windows' : /Linux/.test(userAgent) ? 'Linux' : 'Unknown system';
  return `${browser} on ${system}`;
}

async function entries(auth: Auth, headers: Headers) {
  const current = await auth.api.getSession({ headers });
  if (!current) throw new SessionManagementError('signed-out');
  try {
    // Better Auth requires a recently created session to list; an older one must sign in again.
    const sessions = await auth.api.listSessions({ headers });
    return { current, sessions };
  } catch { throw new SessionManagementError('reauthenticate'); }
}

export async function listAccountSessions(auth: Auth, headers: Headers): Promise<SessionSummary[]> {
  const { current, sessions } = await entries(auth, headers);
  return sessions
    .map((session) => ({ id: session.id, current: session.token === current.session.token, device: describeDevice(session.userAgent), createdAt: new Date(session.createdAt).getTime(), lastActiveAt: new Date(session.updatedAt).getTime(), expiresAt: new Date(session.expiresAt).getTime() }))
    .sort((a, b) => Number(b.current) - Number(a.current) || b.lastActiveAt - a.lastActiveAt || a.id.localeCompare(b.id));
}

/** Ends one of the caller's other sessions. An id that is not the caller's, or is already gone, changes nothing. */
export async function revokeAccountSession(auth: Auth, headers: Headers, id: string): Promise<{ revoked: boolean }> {
  const { current, sessions } = await entries(auth, headers);
  const target = sessions.find((session) => session.id === id);
  if (!target || target.token === current.session.token) return { revoked: false };
  try { await auth.api.revokeSession({ headers, body: { token: target.token } }); }
  catch { throw new SessionManagementError('unavailable'); }
  return { revoked: true };
}

/** Ends every session except the current one, on every device and for every household the account belongs to. */
export async function revokeOtherAccountSessions(auth: Auth, headers: Headers) {
  if (!await auth.api.getSession({ headers })) throw new SessionManagementError('signed-out');
  try { await auth.api.revokeOtherSessions({ headers }); }
  catch { throw new SessionManagementError('unavailable'); }
}
