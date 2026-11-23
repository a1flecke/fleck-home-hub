import { randomUUID } from 'node:crypto';
import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { localDate } from '../../../../lib/chores/recurrence';
import { choreWeekStart, isChoreWeekDate } from '../../../../lib/chores/week';
import { createReuseBatch, listRecentChores, previewReuseBatch, recentChore, ReuseError } from '../../../../lib/server/chore-reuse';
import { requestAccess } from '../../../../lib/server/request-access';

async function parent(request: Request) {
  const access = await requestAccess(request);
  if (access.status === 'unavailable') error(503, 'Identity service unavailable');
  if (access.status === 'anonymous') redirect(303, '/sign-in');
  if (access.status === 'forbidden' || access.role !== 'parent') error(403, 'Reusing chores is available to household parents.');
  return access;
}

function pageNumber(url: URL) {
  const raw = url.searchParams.get('page') ?? '1';
  return /^\d{1,6}$/.test(raw) ? Math.max(1, Number(raw)) : 1;
}

type ReuseFields = { sourceId: string; sourceUpdatedAt: string; title: string; description: string; dueDate: string; reward: string; assigneeIds: string[]; submissionKey: string };

function reuseFields(form: FormData): ReuseFields {
  return {
    sourceId: String(form.get('sourceId') ?? ''),
    sourceUpdatedAt: String(form.get('sourceUpdatedAt') ?? ''),
    title: String(form.get('title') ?? ''),
    description: String(form.get('description') ?? ''),
    dueDate: String(form.get('dueDate') ?? ''),
    reward: String(form.get('reward') ?? '').trim(),
    assigneeIds: form.getAll('assignee').map(String),
    submissionKey: String(form.get('submissionKey') ?? '')
  };
}

function reuseInput(fields: ReuseFields) {
  return {
    sourceId: fields.sourceId,
    sourceUpdatedAt: fields.sourceUpdatedAt,
    title: fields.title,
    description: fields.description,
    dueDate: fields.dueDate,
    rewardCents: fields.reward ? Math.round(Number(fields.reward) * 100) : null,
    assigneeIds: fields.assigneeIds
  };
}

function reuseFailure(cause: unknown, fields: ReuseFields) {
  if (cause instanceof ReuseError && cause.code === 'stale-source') return fail(409, { message: 'The source chore changed. Choose it again and review the assignments.', reuseError: fields });
  if (cause instanceof ReuseError && cause.code === 'not-authorized') return fail(403, { message: 'Request not authorized.', reuseError: fields });
  return fail(400, { message: 'Unable to create this assignment batch. Check the children, date and details and try again.', reuseError: fields });
}

export const load: PageServerLoad = async ({ request, url }) => {
  const { db, userId, householdId } = await parent(request);
  const settings = db.prepare('SELECT timezone FROM household_settings WHERE household_id = ?').get(householdId) as { timezone: string } | undefined;
  const timezone = settings?.timezone ?? 'America/Chicago';
  const today = localDate(new Date(), timezone);
  let recent;
  try { recent = listRecentChores(db, userId, householdId, { query: url.searchParams.get('q') ?? '', page: pageNumber(url) }); }
  catch { error(400, 'Choose a shorter search and a valid page.'); }
  const sourceId = url.searchParams.get('source') ?? '';
  let source;
  if (sourceId) {
    try { source = recentChore(db, userId, householdId, sourceId); }
    catch { error(400, 'Choose a recent chore in your household.'); }
  }
  const children = db.prepare("SELECT u.id, u.name FROM active_membership m JOIN user u ON u.id = m.user_id WHERE m.household_id = ? AND m.role = 'kid' ORDER BY u.name, u.id").all(householdId) as { id: string; name: string }[];
  const requestedDate = url.searchParams.get('date');
  const focusDate = requestedDate && isChoreWeekDate(requestedDate) ? requestedDate : today;
  return {
    ...recent,
    source,
    children,
    focusDate,
    timezone,
    submissionKey: randomUUID()
  };
};

export const actions: Actions = {
  preview: async ({ request }) => {
    const { db, userId, householdId, origin } = await parent(request);
    if (request.headers.get('origin') !== origin) return fail(403, { message: 'Request not authorized.' });
    const fields = reuseFields(await request.formData());
    if (fields.reward && !/^\d{1,7}(?:\.\d{1,2})?$/.test(fields.reward)) return fail(400, { message: 'Enter a valid reward amount.', reuseError: fields });
    try {
      return { reusePreview: previewReuseBatch(db, userId, householdId, reuseInput(fields)), reuseDraft: fields };
    } catch (cause) { return reuseFailure(cause, fields); }
  },
  create: async ({ request }) => {
    const { db, userId, householdId, origin } = await parent(request);
    if (request.headers.get('origin') !== origin) return fail(403, { message: 'Request not authorized.' });
    const fields = reuseFields(await request.formData());
    if (fields.reward && !/^\d{1,7}(?:\.\d{1,2})?$/.test(fields.reward)) return fail(400, { message: 'Enter a valid reward amount.', reuseError: fields });
    let result;
    try { result = createReuseBatch(db, userId, householdId, { ...reuseInput(fields), key: fields.submissionKey }); }
    catch (cause) { return reuseFailure(cause, fields); }
    redirect(303, `/chores/week?week=${choreWeekStart(fields.dueDate)}&notice=reused&count=${result.choreIds.length}`);
  }
};
