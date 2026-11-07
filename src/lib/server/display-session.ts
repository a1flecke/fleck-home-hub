/**
 * Cookie plumbing for restricted display sessions. The credential lives only in an HttpOnly
 * cookie scoped to /display, so the browser never sends it to dashboard, grocery, calendar,
 * chore, settings or API routes, and nothing here touches Better Auth's cookies or tables.
 * It is never placed in localStorage, IndexedDB, a URL or a response body.
 */
export const DISPLAY_COOKIE_PATH = '/display';

const secure = (origin: string) => origin.startsWith('https://');
// `__Secure-` makes browsers refuse the cookie unless it was set over HTTPS with the Secure flag.
export const displayCookieName = (origin: string) => secure(origin) ? '__Secure-fleck_display' : 'fleck_display';

export function displayCookieOptions(origin: string, expiresAt: number) {
  return { path: DISPLAY_COOKIE_PATH, httpOnly: true, secure: secure(origin), sameSite: 'strict' as const, expires: new Date(expiresAt) };
}

/** Extracts the display credential from a Cookie header; every other cookie is ignored. */
export function readDisplayToken(headers: Headers, origin: string): string | null {
  const name = displayCookieName(origin);
  for (const part of (headers.get('cookie') ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim() || null;
  }
  return null;
}
