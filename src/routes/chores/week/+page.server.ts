import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { localDate } from '../../../lib/chores/recurrence';
import { choreWeekDates, choreWeekLabel, choreWeekStart, isChoreWeekDate, shiftChoreWeek } from '../../../lib/chores/week';
import { isChoreStatusFilter, loadChoreWeek } from '../../../lib/server/chore-week';
import { createChore } from '../../../lib/server/chores';
import { generateOccurrences } from '../../../lib/server/recurring';
import { requestAccess } from '../../../lib/server/request-access';

async function parent(request: Request) {
  const access = await requestAccess(request);
  if (access.status === 'unavailable') error(503, 'Identity service unavailable');
  if (access.status === 'anonymous') redirect(303, '/sign-in');
  if (access.status === 'forbidden' || access.role !== 'parent') error(403, 'The weekly chore board is available to household parents.');
  return access;
}

function requestedWeek(url: URL, today: string): string {
  const raw = url.searchParams.get('week') ?? url.searchParams.get('date') ?? today;
  if (!isChoreWeekDate(raw)) error(400, 'Choose a valid week or date.');
  return choreWeekStart(raw);
}

export const load: PageServerLoad = async ({ request, url }) => {
  const { db, userId, householdId } = await parent(request);
  const settings = db.prepare('SELECT timezone FROM household_settings WHERE household_id = ?').get(householdId) as { timezone: string } | undefined;
  const timezone = settings?.timezone ?? 'America/Chicago';
  const today = localDate(new Date(), timezone);
  const start = requestedWeek(url, today);
  const end = choreWeekDates(start)[6];

  // Never backfill a past week through the board. Occurrences remain future-facing,
  // bounded to the selected week and protected by the series/date uniqueness key.
  if (end >= today) generateOccurrences(db, userId, householdId, start > today ? start : today, end);

  const rawStatus = url.searchParams.get('status');
  if (rawStatus && !isChoreStatusFilter(rawStatus)) error(400, 'Choose a valid chore status.');
  const status = isChoreStatusFilter(rawStatus) ? rawStatus : 'all';
  const requestedChild = url.searchParams.get('child') ?? '';
  let board;
  try {
    board = loadChoreWeek(db, { householdId, role: 'parent', actorId: userId, today }, { start, childId: requestedChild || undefined, status });
  } catch {
    error(400, 'Choose a child in your household.');
  }
  const requestedDate = url.searchParams.get('date');
  const focusDate = requestedDate && isChoreWeekDate(requestedDate) && requestedDate >= board.start && requestedDate <= board.end
    ? requestedDate
    : today >= board.start && today <= board.end ? today : board.start;
  const children = board.children;
  return {
    ...board,
    timezone,
    today,
    weekLabel: choreWeekLabel(board.start),
    previousWeek: shiftChoreWeek(board.start, -1),
    nextWeek: shiftChoreWeek(board.start, 1),
    currentWeek: choreWeekStart(today),
    childId: requestedChild,
    status,
    focusDate,
    addOpen: url.searchParams.get('add') === '1',
    notice: url.searchParams.get('notice'),
    children
  };
};

export const actions: Actions = {
  create: async ({ request }) => {
    const { db, userId, householdId, origin } = await parent(request);
    if (request.headers.get('origin') !== origin) return fail(403, { message: 'Request not authorized.' });
    const form = await request.formData();
    const title = String(form.get('title') ?? '');
    const description = String(form.get('description') ?? '');
    const assignee = String(form.get('assignee') ?? '');
    const dueDate = String(form.get('dueDate') ?? '');
    const reward = String(form.get('reward') ?? '').trim();
    const createError = { title, description, assignee, dueDate, reward };
    if (reward && !/^\d{1,7}(?:\.\d{1,2})?$/.test(reward)) return fail(400, { message: 'Enter a valid reward amount.', createError });
    if (!isChoreWeekDate(dueDate)) return fail(400, { message: 'Choose a valid due date.', createError });
    try {
      createChore(db, userId, householdId, {
        title,
        description,
        assigneeId: assignee,
        dueDate,
        rewardCents: reward ? Math.round(Number(reward) * 100) : null
      });
    } catch {
      return fail(400, { message: 'Unable to add chore. Check the details and try again.', createError });
    }
    redirect(303, `/chores/week?week=${choreWeekStart(dueDate)}&notice=created`);
  }
};
