import { fail, redirect } from '@sveltejs/kit';
import Database from 'better-sqlite3';
import type { Actions, PageServerLoad } from './$types';
import { readIdentityConfig } from '../../lib/server/config';
import { redeemInvitation } from '../../lib/server/invitations';

export const load: PageServerLoad = ({ url }) => ({ success: url.searchParams.get('success') === '1' });
export const actions = {
  default: async ({ request }) => {
    const config = readIdentityConfig(process.env);
    if (request.headers.get('origin') !== config.origin) return fail(403, { message: 'Request not authorized.' });
    const form = await request.formData();
    const token = String(form.get('token') ?? '');
    const name = String(form.get('name') ?? '');
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');
    const db = new Database(config.dbPath, { fileMustExist: true });
    db.pragma('foreign_keys = ON');
    try { await redeemInvitation(db, config, token, { name, email, password }); }
    catch { return fail(400, { token, name, email, message: 'Check your details and invitation link. The link may have expired, been used, or been revoked. Passwords must be at least 12 characters; existing accounts cannot be linked.' }); }
    finally { db.close(); }
    redirect(303, '/accept-invitation?success=1');
  }
} satisfies Actions;
