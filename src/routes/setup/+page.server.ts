import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getIdentityServices } from '../../lib/server/runtime';
import { needsInitialSetup } from '../../lib/server/setup-code';
import { provisionFirstParent } from '../../lib/server/onboarding';
import { isManagedEmail } from '../../lib/server/managed-children';
import { writeSessionCookies } from '../../lib/server/session-cookies';
import { readIdentityConfig } from '../../lib/server/config';

function checkAvailability() {
  const services = getIdentityServices();
  if (!needsInitialSetup(services.db)) redirect(303, '/sign-in');
  return services;
}

function householdDetails(form: FormData) {
  return {
    household: String(form.get('household') ?? '').trim().slice(0, 101),
    timezone: String(form.get('timezone') ?? '').trim().slice(0, 101)
  };
}

function householdError(household: string, timezone: string) {
  if (!household || household.length > 100) return 'Enter a family name of up to 100 characters.';
  if (!timezone || timezone.length > 100) return 'Choose a time zone.';
  try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }); }
  catch { return 'Choose a valid time zone, such as America/Chicago.'; }
}

export const load: PageServerLoad = () => {
  checkAvailability();
  return {
    zones: Intl.supportedValuesOf('timeZone'),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
  };
};

export const actions = {
  household: async ({ request }) => {
    const { origin } = checkAvailability();
    if (request.headers.get('origin') !== origin) return fail(403, { message: 'Open setup from your home hub and try again.' });
    const fields = householdDetails(await request.formData());
    const message = householdError(fields.household, fields.timezone);
    if (message) return fail(400, { ...fields, message });
    return { ...fields, name: '', email: '', parentStep: true as const };
  },
  parent: async ({ request, cookies }) => {
    const { db, origin } = checkAvailability();
    if (request.headers.get('origin') !== origin) return fail(403, { message: 'Open setup from your home hub and try again.' });
    const form = await request.formData();
    const fields = householdDetails(form);
    const householdMessage = householdError(fields.household, fields.timezone);
    if (form.get('back') === 'yes') return fields;
    if (householdMessage) return fail(400, { ...fields, message: householdMessage });
    const name = String(form.get('name') ?? '').trim().slice(0, 101);
    const email = String(form.get('email') ?? '').trim().slice(0, 255);
    const password = String(form.get('password') ?? '');
    const code = String(form.get('code') ?? '').trim();
    const retry = { ...fields, name, email, parentStep: true as const };
    if (!name || name.length > 100 || !email || email.length > 254 || isManagedEmail(email)) return fail(400, { ...retry, message: 'Enter your name and email address.' });
    if (password.length < 12 || password.length > 128) return fail(400, { ...retry, message: 'Choose a password with 12 to 128 characters.' });
    if (password !== form.get('confirmation')) return fail(400, { ...retry, message: 'The passwords didn’t match. Enter them again.' });
    let sessionCookies: string[];
    try {
      sessionCookies = await provisionFirstParent(db, readIdentityConfig(process.env), code, { ...fields, name, email, password });
    } catch {
      if (!needsInitialSetup(db)) redirect(303, '/sign-in');
      return fail(400, { ...retry, message: 'We couldn’t finish setup. Check the details and enter the current setup code again.' });
    }
    writeSessionCookies(cookies, sessionCookies);
    redirect(303, '/onboarding');
  }
} satisfies Actions;
