import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { readIdentityConfig } from '../../lib/server/config';
import { getIdentityServices } from '../../lib/server/runtime';
import { isManagedEmail } from '../../lib/server/managed-children';
import { redeemInvitation } from '../../lib/server/invitations';

export const load: PageServerLoad = ({ url }) => ({ success: url.searchParams.get('success') === '1' });
export const actions = {
  default: async ({ request }) => {
    let services;
    let config;
    try {
      services = getIdentityServices();
      config = readIdentityConfig(process.env);
    } catch {
      return fail(503, { message: 'Service temporarily unavailable. Please try again.' });
    }
    if (request.headers.get('origin') !== services.origin) return fail(403, { message: 'Request not authorized.' });
    const form = await request.formData();
    const token = String(form.get('token') ?? '').trim();
    const name = String(form.get('name') ?? '').trim();
    const email = String(form.get('email') ?? '').trim();
    const password = String(form.get('password') ?? '');
    const retry = { token: token.slice(0, 100), name: name.slice(0, 101), email: email.slice(0, 255) };
    if (!name || name.length > 100) return fail(400, { ...retry, message: 'Enter your name (up to 100 characters).' });
    if (!email || email.length > 254 || isManagedEmail(email)) return fail(400, { ...retry, message: 'Enter the email address you use to sign in.' });
    if (password.length < 12 || password.length > 128) return fail(400, { ...retry, message: 'Choose a password with 12 to 128 characters.' });
    try { await redeemInvitation(services.db, { secret: config.secret, origin: services.origin }, token, { name, email, password }); }
    catch { return fail(400, { ...retry, message: 'Check your details and invitation link. The link may have expired, been used, or been revoked. Passwords must be 12 to 128 characters; existing accounts cannot be linked.' }); }
    redirect(303, '/accept-invitation?success=1');
  }
} satisfies Actions;
