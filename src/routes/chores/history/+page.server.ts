import { error, fail, redirect } from '@sveltejs/kit';
import type Database from 'better-sqlite3';
import type { Actions, PageServerLoad } from './$types';
import { localDate } from '../../../lib/chores/recurrence';
import { changeChore } from '../../../lib/server/chores';
import type { ChoreAction } from '../../../lib/chores/domain';
import { choreScopeCounts, isChoreScope, listChoreScope } from '../../../lib/server/my-day';
import { requestAccess } from '../../../lib/server/request-access';

async function member(request: Request) {
  const access = await requestAccess(request);
  if (access.status === 'unavailable') error(503, 'Identity service unavailable');
  if (access.status === 'anonymous') redirect(303, '/sign-in');
  if (access.status === 'forbidden') error(403, 'No household access');
  return access;
}

function pageNumber(url: URL) {
  const raw = url.searchParams.get('page') ?? '1';
  return /^\d{1,6}$/.test(raw) ? Math.max(1, Number(raw)) : 1;
}

function selectedScope(url: URL) {
  const raw = url.searchParams.get('scope');
  return isChoreScope(raw) ? raw : 'verified';
}

function selectedChild(db: Database.Database, householdId: string, role: 'parent' | 'kid', raw: string | null) {
  if (role === 'kid' || !raw) return '';
  const child = db.prepare("SELECT 1 FROM active_membership WHERE household_id = ? AND user_id = ? AND role = 'kid'").get(householdId, raw);
  if (!child) error(400, 'Choose a child in your household.');
  return raw;
}

export const load: PageServerLoad = async ({ request, url }) => {
  const { db, userId, name, householdId, role } = await member(request);
  const settings = db.prepare('SELECT timezone FROM household_settings WHERE household_id = ?').get(householdId) as { timezone: string } | undefined;
  const today = localDate(new Date(), settings?.timezone ?? 'America/Chicago');
  const scope = selectedScope(url);
  const childId = selectedChild(db, householdId, role, url.searchParams.get('child'));
  const audience = { householdId, role, actorId: userId, today, childId: childId || undefined };
  const children = role === 'parent'
    ? db.prepare("SELECT u.id, u.name FROM active_membership m JOIN user u ON u.id = m.user_id WHERE m.household_id = ? AND m.role = 'kid' ORDER BY u.name, u.id").all(householdId) as { id: string; name: string }[]
    : [];
  return { name, role, scope, childId, children, today, counts: choreScopeCounts(db, audience), ...listChoreScope(db, { ...audience, scope, page: pageNumber(url) }), notice: url.searchParams.get('notice') };
};

export const actions: Actions = {
  transition: async ({ request, url }) => {
    const { db, userId, householdId, origin } = await member(request);
    if (request.headers.get('origin') !== origin) return fail(403, { message: 'Request not authorized.' });
    const form = await request.formData();
    const action = String(form.get('action'));
    const requestedScope = url.searchParams.get('scope');
    const scope = isChoreScope(requestedScope) ? requestedScope : 'review';
    const page = pageNumber(url);
    const child = url.searchParams.get('child') ?? '';
    const destination = `/chores/history?scope=${scope}&page=${page}${child ? `&child=${encodeURIComponent(child)}` : ''}`;
    if (!['verify', 'rework'].includes(action)) return fail(400, { message: 'Invalid action.' });
    try { changeChore(db, userId, householdId, String(form.get('id') ?? ''), action as ChoreAction, String(form.get('reason') ?? '')); }
    catch { return fail(400, { message: 'Unable to update this chore. Refresh and try again.' }); }
    redirect(303, `${destination}&notice=${action === 'verify' ? 'verified' : 'rework'}`);
  }
};
