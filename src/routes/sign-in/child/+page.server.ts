import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { getIdentityServices } from '../../../lib/server/runtime';
import { signInChild } from '../../../lib/server/managed-children';
import { writeSessionCookies } from '../../../lib/server/session-cookies';

export const actions = {
  default: async ({ request, cookies, setHeaders }) => {
    setHeaders({ 'cache-control': 'no-store' });
    const { db, auth, origin } = getIdentityServices();
    if (request.headers.get('origin') !== origin) return fail(403, { username: '', message: 'Open child sign-in from your home hub.' });
    const form = await request.formData();
    const username = String(form.get('username') ?? '').trim().slice(0, 32);
    const password = String(form.get('password') ?? '');
    let response;
    try { response = await signInChild(db, auth, origin, request.headers, username, password); }
    catch { return fail(503, { username, message: 'Sign-in is unavailable. Try again shortly.' }); }
    if (response.status === 429) return fail(429, { username, message: 'Too many sign-in attempts. Wait a moment and try again.' });
    if (!response.ok) return fail(401, { username, message: 'Check your username and password, or ask a parent for help.' });
    writeSessionCookies(cookies, response.headers.getSetCookie());
    redirect(303, '/dashboard');
  }
} satisfies Actions;
