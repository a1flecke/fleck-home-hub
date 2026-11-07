import { error, redirect } from '@sveltejs/kit';
import { localDate } from '../chores/recurrence';
import { displayData, displayDataForDevice } from './display';
import { verifyDisplayCredential } from './display-pairing';
import { readDisplayToken } from './display-session';
import { getDisplayWeather, type DisplayWeather } from './display-weather';
import { getIdentityServices } from './runtime';

type DisplayServices = ReturnType<typeof getIdentityServices>;

export type DisplayDependencies = {
  services?: DisplayServices;
  weather?: () => Promise<DisplayWeather>;
};

export type DisplayView =
  | { mode: 'member' | 'device'; today: string; timezone: string; events: ReturnType<typeof displayData>['events']; chores: ReturnType<typeof displayData>['chores']; meals: ReturnType<typeof displayData>['meals']; canManage: boolean; weather: DisplayWeather }
  | { mode: 'unpaired' };

/**
 * Resolves who is looking at the display. A normal household session always wins (it can do
 * nothing a display could not). Otherwise a display credential is checked against the database
 * on every call; a credential that is present but no longer valid yields `unpaired` rather than
 * a sign-in redirect, because a kiosk has no one to sign in. No credential at all keeps the
 * existing behavior: redirect to sign-in.
 */
export async function resolveDisplayView(request: Request, dependencies: DisplayDependencies = {}): Promise<DisplayView> {
  let services: DisplayServices;
  try { services = dependencies.services ?? getIdentityServices(); } catch { error(503, 'Identity service unavailable'); }
  const session = await services.auth.api.getSession({ headers: request.headers });
  let householdId: string;
  let actor: string | null = null;
  let device: ReturnType<typeof verifyDisplayCredential> = null;
  if (session) {
    const member = services.db.prepare('SELECT household_id AS householdId FROM active_membership WHERE user_id = ? ORDER BY household_id LIMIT 1').get(session.user.id) as { householdId: string } | undefined;
    if (!member) error(403, 'No household access');
    householdId = member.householdId;
    actor = session.user.id;
  } else {
    const token = readDisplayToken(request.headers, services.origin);
    if (!token) redirect(303, '/sign-in');
    device = verifyDisplayCredential(services.db, token);
    if (!device) return { mode: 'unpaired' };
    householdId = device.householdId;
  }
  const settings = services.db.prepare('SELECT timezone FROM household_settings WHERE household_id = ?').get(householdId) as { timezone: string } | undefined;
  const timezone = settings?.timezone ?? 'America/Chicago';
  const today = localDate(new Date(), timezone);
  const last = new Date(`${today}T00:00:00Z`); last.setUTCDate(last.getUTCDate() + 7);
  const end = last.toISOString().slice(0, 10);
  const weatherPromise = loadWeatherSafely(dependencies.weather ?? getDisplayWeather);
  if (device) {
    const { events, chores, meals } = displayDataForDevice(services.db, device, today, end);
    return { mode: 'device', today, timezone, events, chores, meals, canManage: false, weather: await weatherPromise };
  }
  const { choices, events, chores, meals } = displayData(services.db, actor!, householdId, today, end);
  return { mode: 'member', today, timezone, events, chores, meals, canManage: choices !== null, weather: await weatherPromise };
}

/** For callers that cannot render a pairing-required state: an invalid display credential is a 401. */
export async function loadDisplay(request: Request, dependencies: DisplayDependencies = {}) {
  const view = await resolveDisplayView(request, dependencies);
  if (view.mode === 'unpaired') error(401, 'Pairing required');
  return view;
}

async function loadWeatherSafely(loader: () => Promise<DisplayWeather>): Promise<DisplayWeather> {
  try {
    return await loader();
  } catch {
    return { status: 'unavailable' };
  }
}
