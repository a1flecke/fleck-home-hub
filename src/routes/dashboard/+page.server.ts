import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { changeChore, createChore } from '../../lib/server/chores';
import type { ChoreAction } from '../../lib/chores/domain';
import { localDate } from '../../lib/chores/recurrence';
import { generateOccurrences, activeSeriesCount, setHouseholdTimezone } from '../../lib/server/recurring';
import { recordPayout, reversePayout, setPayday } from '../../lib/server/payouts';
import { nextPayday } from '../../lib/earnings/payday';
import { randomUUID } from 'node:crypto';
import { listMealWeek } from '../../lib/server/meals';
import { mealDayLabel } from '../../lib/meals/week';
import { dashboardChoreSections, childEarningSummaries, pendingRewardTotal } from '../../lib/server/my-day';
import { requestAccess } from '../../lib/server/request-access';
import { onboardingStep } from '../../lib/server/onboarding';
import { loadChecklistReadiness } from '../../lib/server/checklists';
import { addCalendarDays } from '../../lib/calendar/dates';

async function member(request: Request) {
  const access = await requestAccess(request);
  if (access.status === 'unavailable') error(503, 'Identity service unavailable');
  if (access.status === 'anonymous') redirect(303, '/sign-in');
  if (access.status === 'forbidden') error(403, 'No household access');
  return access;
}

export const load: PageServerLoad = async ({ request, url }) => {
  const { db, userId, name, householdId, role } = await member(request);
  const settings = db.prepare('SELECT timezone FROM household_settings WHERE household_id = ?').get(householdId) as { timezone: string } | undefined;
  const timezone = settings?.timezone ?? 'America/Chicago';
  const today = localDate(new Date(), timezone);
  const { upcomingEvents, preparations } = loadChecklistReadiness(db, userId, householdId, today);
  const dinnerEnd = addCalendarDays(today, 6);
  const dinnerMeals = listMealWeek(db, userId, householdId, today, dinnerEnd);
  const dinnerDates = [0, 1, 2, 3, 4, 5, 6].map(offset => addCalendarDays(today, offset));
  const dinnerDays = dinnerDates.map(date => ({
    date,
    label: mealDayLabel(date),
    isToday: date === today,
    meals: dinnerMeals.filter(meal => meal.date === date).map(({ id, title, time, servings, ingredients, source, recipeUrl, recipeDetails }) => ({ id, title, time, servings, ingredients, source, recipeUrl, recipeDetails }))
  }));
  const meals = role === 'parent' ? (dinnerDays.find(day => day.isToday)?.meals ?? []) : [];
  const missingDinnerDays = dinnerDays.filter(day => !day.meals.length);
  const end = new Date(`${today}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 7);
  generateOccurrences(db, userId, householdId, today, end.toISOString().slice(0, 10));
  const audience = { householdId, role, actorId: userId, today };
  const { counts, sections } = dashboardChoreSections(db, audience);
  const balances = childEarningSummaries(db, audience).map(child => ({ ...child, paymentAmount: child.owed / 100, paymentDate: today, requestId: role === 'parent' ? randomUUID() : '' }));
  const children = balances.map(({ id, name: childName }) => ({ id, name: childName }));
  const schedule = db.prepare('SELECT anchor_date AS anchor, cadence_days AS cadence FROM payday_schedule WHERE household_id = ?').get(householdId) as { anchor: string; cadence: number } | undefined;
  const payday = schedule ? { ...schedule, next: nextPayday(today, schedule.anchor, schedule.cadence) } : null;
  const onboarding = role === 'parent' ? onboardingStep(db, householdId) : undefined;
  return {
    onboardingPending: Boolean(onboarding && onboarding !== 'complete'),
    showWelcome: onboarding === 'complete' && url.searchParams.get('welcome') === '1',
    name, householdId, role, counts, sections, children, balances, pendingRewards: pendingRewardTotal(db, audience), today, timezone, payday, meals, dinnerDays, missingDinnerDays, dinnerEnd, upcomingEvents, preparations, activeSeries: role === 'parent' ? activeSeriesCount(db, householdId) : 0
  };
};

export const actions: Actions = {
  payout: async ({ request }) => {
    const { db, userId, householdId, origin } = await member(request);
    if (request.headers.get('origin') !== origin) return fail(403, { message: 'Request not authorized.' });
    const form = await request.formData();
    const amount = String(form.get('amount') ?? '').trim();
    const payoutError = { child: String(form.get('child') ?? ''), amount, date: String(form.get('date') ?? ''), note: String(form.get('note') ?? ''), requestId: String(form.get('requestId') ?? '') };
    if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(amount)) return fail(400, { message: 'Enter a valid payment amount.', payoutError });
    try { recordPayout(db, userId, householdId, { childId: String(form.get('child') ?? ''), amountCents: Math.round(Number(amount) * 100), date: String(form.get('date') ?? ''), note: String(form.get('note') ?? ''), requestId: String(form.get('requestId') ?? '') }); }
    catch (err) { return fail(400, { message: err instanceof Error && err.message === 'Payout date cannot be in the future' ? 'Choose a payment date on or before today.' : 'Unable to record payment. Check the amount and current balance, then try again.', payoutError }); }
    return { message: 'Payment recorded.' };
  },
  reversePayout: async ({ request }) => {
    const { db, userId, householdId, origin } = await member(request);
    if (request.headers.get('origin') !== origin) return fail(403, { message: 'Request not authorized.' });
    const form = await request.formData();
    const correctionError = { id: String(form.get('id') ?? ''), reason: String(form.get('reason') ?? '') };
    try { reversePayout(db, userId, householdId, correctionError.id, correctionError.reason); }
    catch { return fail(400, { message: 'Unable to correct payment. Enter a reason and try again.', correctionError }); }
    return { message: 'Payment correction recorded.' };
  },
  payday: async ({ request }) => {
    const { db, userId, householdId, origin } = await member(request);
    if (request.headers.get('origin') !== origin) return fail(403, { message: 'Request not authorized.' });
    const form = await request.formData();
    try { setPayday(db, userId, householdId, String(form.get('anchor') ?? ''), Number(form.get('cadence'))); }
    catch { return fail(400, { message: 'Unable to save payday schedule.' }); }
    return { message: 'Payday schedule saved.' };
  },
  timezone: async ({ request }) => {
    const { db, userId, householdId, origin } = await member(request);
    if (request.headers.get('origin') !== origin) return fail(403, { message: 'Request not authorized.' });
    const form = await request.formData();
    try { setHouseholdTimezone(db, userId, householdId, String(form.get('timezone') ?? '').trim()); }
    catch { return fail(400, { message: 'Enter a valid household time zone.' }); }
    return { message: 'Household time zone saved.' };
  },
  create: async ({ request }) => {
    const { db, userId, householdId, origin } = await member(request);
    if (request.headers.get('origin') !== origin) return fail(403, { message: 'Request not authorized.' });
    const form = await request.formData();
    const reward = String(form.get('reward') ?? '').trim();
    const createError = { title: String(form.get('title') ?? ''), description: String(form.get('description') ?? ''), assignee: String(form.get('assignee') ?? ''), dueDate: String(form.get('dueDate') ?? ''), reward };
    if (reward && !/^\d{1,7}(?:\.\d{1,2})?$/.test(reward)) return fail(400, { message: 'Enter a valid reward amount.', createError });
    const cents = reward ? Math.round(Number(reward) * 100) : null;
    try {
      createChore(db, userId, householdId, { title: String(form.get('title') ?? ''), description: String(form.get('description') ?? ''), assigneeId: String(form.get('assignee') ?? ''), dueDate: String(form.get('dueDate') ?? ''), rewardCents: cents });
    } catch { return fail(400, { message: 'Unable to add chore. Check the details and try again.', createError }); }
    return { message: 'Chore added.' };
  },
  transition: async ({ request }) => {
    const { db, userId, householdId, origin } = await member(request);
    if (request.headers.get('origin') !== origin) return fail(403, { message: 'Request not authorized.' });
    const form = await request.formData();
    const action = String(form.get('action'));
    if (!['submit', 'verify', 'rework'].includes(action)) return fail(400, { message: 'Invalid action.' });
    try { changeChore(db, userId, householdId, String(form.get('id') ?? ''), action as ChoreAction, String(form.get('reason') ?? '')); }
    catch { return fail(400, { message: action === 'rework' ? 'Enter a reason for returning this work.' : 'Unable to update this chore. Refresh and try again.' }); }
    return { message: action === 'submit' ? 'Nice job! Waiting for a parent to check.' : 'Chore updated.' };
  }
};
