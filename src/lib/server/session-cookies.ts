import type { Cookies } from '@sveltejs/kit';
import { parseSetCookieHeader, toCookieOptions } from 'better-auth/cookies';

export function writeSessionCookies(cookies: Cookies, headers: string[]) {
  for (const header of headers) {
    for (const [name, attributes] of parseSetCookieHeader(header)) {
      cookies.set(name, attributes.value, { ...toCookieOptions(attributes), path: '/' });
    }
  }
}
