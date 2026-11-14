import { error, fail, redirect } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import type { Actions, PageServerLoad } from './$types';
import { expenseDates, type ExpenseCadence } from '../../lib/expenses/recurrence';
import { createExpense, expenseToday, listExpensePlans, listExpenses, setExpenseState, skipExpense, updateExpense } from '../../lib/server/expenses';
import { listExpensePayments, recordExpensePayment, reverseExpensePayment } from '../../lib/server/expense-payments';
import { primaryActiveMembership } from '../../lib/server/household-access';
import { getIdentityServices } from '../../lib/server/runtime';

async function parentAccess(request: Request) {
  const services = getIdentityServices();
  const session = await services.auth.api.getSession({ headers: request.headers });
  if (!session) redirect(303, '/sign-in');
  const member = primaryActiveMembership(services.db, session.user.id);
  if (member?.role !== 'parent') error(403, 'Expenses are available to household parents.');
  return { ...services, actor: session.user.id, household: member.householdId };
}

function shift(date: string, days: number) {
  const value = new Date(date + 'T00:00:00Z');
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function validDate(date: string) {
  if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(date) || date > '9998-12-31') return false;
  try { expenseDates(date, 'once', date, date); return true; } catch { return false; }
}

function context(url: URL, today: string) {
  const days = url.searchParams.get('days') === '90' ? 90 : 30;
  const raw = url.searchParams.get('date');
  const date = raw && validDate(raw) ? raw : today;
  return { days, date };
}

function amount(raw: string) {
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(raw.trim());
  if (!match) return 0;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

export const load: PageServerLoad = async ({ request, url }) => {
  const { db, actor, household } = await parentAccess(request);
  const today = expenseToday(db, household);
  const { date, days } = context(url, today);
  const through = shift(date, days - 1);
  const overdueThrough = shift(date < today ? date : today, -1);
  const overdueFrom = shift(overdueThrough, -89);
  const selected = listExpenses(db, actor, household, date, through);
  const past = listExpenses(db, actor, household, overdueFrom, overdueThrough);
  const selectedPayments = listExpensePayments(db, actor, household, date, through);
  const history = [...listExpensePayments(db, actor, household, overdueFrom, overdueThrough), ...selectedPayments]
    .sort((a, b) => b.scheduledDate.localeCompare(a.scheduledDate) || b.createdAt.localeCompare(a.createdAt));
  const paid = new Set(history.filter(item => !item.reversedAt).map(item => item.expenseId + '/' + item.scheduledDate));
  const recorded = new Set(history.map(item => item.expenseId + '/' + item.scheduledDate));
  const projected = new Set([...selected, ...past].map(item => item.id + '/' + item.date));
  const replacementOffered = new Set<string>();
  const paymentHistory = history.map(item => {
    const key = item.expenseId + '/' + item.scheduledDate;
    const canReplace = !!item.reversedAt && !paid.has(key) && !projected.has(key) && !replacementOffered.has(key);
    if (canReplace) replacementOffered.add(key);
    return { ...item, canReplace, requestId: randomUUID() };
  });
  const plans = listExpensePlans(db, actor, household);
  const activeRecurring = new Set(plans.filter(plan => plan.state === 'active' && plan.cadence !== 'once').map(plan => plan.id));
  const occurrence = (item: (typeof selected)[number]) => {
    const key = item.id + '/' + item.date;
    return { ...item, paid: paid.has(key), canSkip: item.date > today && activeRecurring.has(item.id) && !recorded.has(key), requestId: randomUUID() };
  };
  return {
    today, date, through, days, overdueFrom, overdueThrough, notice: url.searchParams.get('notice'), selected: selected.map(occurrence),
    overdue: past.map(occurrence).filter(item => !item.paid), history: paymentHistory, plans,
    plannedTotal: selected.reduce((total, item) => total + item.amountCents, 0),
    paidTotal: selectedPayments.reduce((total, item) => total + (item.reversedAt ? 0 : item.amountCents), 0)
  };
};

const messages: Record<string, string> = {
  'Payment date cannot be in the future': 'Actual payment date cannot be in the future.',
  'Payment history exists': 'This occurrence has payment history. Its scheduled date cannot be changed or skipped.',
  'occurrence already paid': 'A payment has already been recorded for this occurrence.',
  'Invalid state': 'This plan’s status has changed. Review it before trying again.',
  'Schedule cannot be changed': 'The recurrence schedule is fixed. Review the plan before trying again.'
};

type Operation = 'save' | 'state' | 'skip' | 'pay' | 'reverse';

function action(operation: Operation): Actions[string] {
  return async ({ request, url }) => {
    const { db, actor, household, origin } = await parentAccess(request);
    if (request.headers.get('origin') !== origin) error(403, 'Request not authorized.');
    const today = expenseToday(db, household);
    const { date, days } = context(url, today);
    const fields = await request.formData();
    const value = (name: string) => {
      const entry = fields.get(name);
      return typeof entry === 'string' ? entry : '';
    };
    const id = value('id');
    const scheduledDate = value('scheduledDate');
    const raw = { title: value('title'), amount: value('amount'), dueDate: value('dueDate'), cadence: value('cadence'), payee: value('payee'), category: value('category'), notes: value('notes'), paidDate: value('paidDate'), note: value('note'), reason: value('reason'), requestId: value('requestId') };
    const invalid = (message: string) => fail(400, { operation, id, scheduledDate, raw, message });
    let nextDate = date;
    let notice: string;
    try {
      switch (operation) {
        case 'save': {
          const amountCents = amount(raw.amount);
          if (amountCents < 1 || amountCents > 100000000) return invalid('Enter a planned amount between $0.01 and $1,000,000.00 with up to two decimal places.');
          if (!validDate(raw.dueDate)) return invalid('Choose a valid due date.');
          const input = { ...raw, amountCents, cadence: raw.cadence as ExpenseCadence };
          if (id) updateExpense(db, actor, household, id, input);
          else createExpense(db, actor, household, input);
          if (!id || input.cadence === 'once') {
            if (input.dueDate < date || input.dueDate > shift(date, days - 1)) nextDate = input.dueDate;
          }
          notice = id ? 'updated' : 'created';
          break;
        }
        case 'state': {
          const state = value('state');
          if (state !== 'active' && state !== 'paused' && state !== 'ended') return invalid('Choose a valid plan status.');
          setExpenseState(db, actor, household, id, state);
          notice = state;
          break;
        }
        case 'skip':
          skipExpense(db, actor, household, id, scheduledDate);
          notice = 'skipped';
          break;
        case 'pay': {
          const amountCents = amount(raw.amount);
          if (amountCents < 1 || amountCents > 100000000) return invalid('Enter an actual paid amount with up to two decimal places.');
          if (!validDate(raw.paidDate)) return invalid('Choose a valid actual payment date.');
          recordExpensePayment(db, actor, household, { expenseId: id, scheduledDate, paidDate: raw.paidDate, amountCents, note: raw.note, requestId: raw.requestId });
          notice = 'paid';
          break;
        }
        case 'reverse':
          if (!raw.reason.trim() || raw.reason.trim().length > 1000) return invalid('Enter a reason between 1 and 1,000 characters.');
          reverseExpensePayment(db, actor, household, id, raw.reason);
          notice = 'reversed';
          break;
      }
    } catch (err) {
      const message = err instanceof Error && Object.hasOwn(messages, err.message) ? messages[err.message] : undefined;
      return invalid(message ?? 'Unable to save this change. Check the expense details and try again.');
    }
    const query = new URLSearchParams({ days: String(days), notice });
    if (nextDate !== today || url.searchParams.has('date')) query.set('date', nextDate);
    redirect(303, '/expenses?' + query);
  };
}

export const actions = { save: action('save'), state: action('state'), skip: action('skip'), pay: action('pay'), reverse: action('reverse') } satisfies Actions;
