import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

function extractFunction(source: string, name: string): string {
  const match = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source);
  if (!match) return '';
  let index = match.index + match[0].length;
  let parens = 1;
  while (index < source.length && parens > 0) {
    if (source[index] === '(') parens++;
    else if (source[index] === ')') parens--;
    index++;
  }
  let angles = 0;
  let open = -1;
  while (index < source.length) {
    const ch = source[index];
    if (ch === '<') angles++;
    else if (ch === '>' && angles > 0) angles--;
    else if (ch === '{' && angles === 0) { open = index; break; }
    index++;
  }
  if (open < 0) return '';
  let depth = 1;
  let end = open + 1;
  while (end < source.length && depth > 0) {
    if (source[end] === '{') depth++;
    else if (source[end] === '}') depth--;
    end++;
  }
  return source.slice(open, end);
}

export function performanceAndConcurrencyFindings(sources: {
  appHtml: string;
  recurring: string;
  expenses: string;
  expensePayments: string;
  myDay: string;
  groceries: string;
  runtime: string;
  bootstrap: string;
  householdAccess: string;
}): string[] {
  const findings: string[] = [];

  if (/data-sveltekit-preload-data\s*=\s*["']hover["']/.test(sources.appHtml)) {
    findings.push('src/app.html must not enable global data-sveltekit-preload-data="hover"');
  }

  const genBody = extractFunction(sources.recurring, 'generateOccurrences');
  const txPos = genBody.indexOf('db.transaction(');
  const preCheckPos = genBody.indexOf('findPendingOccurrences(');
  if (!genBody || txPos < 0 || preCheckPos < 0 || preCheckPos > txPos) {
    findings.push('recurring.ts generateOccurrences must check findPendingOccurrences before acquiring db.transaction(...).immediate()');
  }

  const seriesPageBody = extractFunction(sources.recurring, 'listSeriesPage');
  const seriesMapBody = seriesPageBody.match(/const\s+items\s*=\s*rows\.map\s*\([\s\S]*/)?.[0] ?? '';
  if (!seriesPageBody || !seriesMapBody || /db\.prepare\s*\(/.test(seriesMapBody)) {
    findings.push('recurring.ts listSeriesPage must batch next-occurrence and skip queries outside rows.map(...)');
  }

  const listExpensesBody = extractFunction(sources.expenses, 'listExpenses');
  if (!listExpensesBody || /for\s*\(\s*const\s+date\s+of\b[\s\S]*?db\.prepare\s*\(/.test(listExpensesBody)) {
    findings.push('expenses.ts listExpenses must batch skip, pause, and version lookups outside per-date loops');
  }

  const skipExpenseBody = extractFunction(sources.expenses, 'skipExpense');
  if (!skipExpenseBody || /\blistExpenses\s*\(/.test(skipExpenseBody)) {
    findings.push('expenses.ts skipExpense must use single-expense findExpenseOccurrence instead of scanning all expenses with listExpenses inside BEGIN IMMEDIATE');
  }

  const recordPaymentBody = extractFunction(sources.expensePayments, 'recordExpensePayment');
  if (!recordPaymentBody || /\blistExpenses\s*\(/.test(recordPaymentBody)) {
    findings.push('expense-payments.ts recordExpensePayment must use single-expense findExpenseOccurrence instead of scanning all expenses with listExpenses inside BEGIN IMMEDIATE');
  }

  const payoutHistoryBody = extractFunction(sources.myDay, 'listPayoutHistory');
  if (!payoutHistoryBody || /\bchildEarningSummaries\s*\(/.test(payoutHistoryBody)) {
    findings.push('my-day.ts listPayoutHistory must query only the requested child instead of calling childEarningSummaries across all children');
  }

  const weekRefsBody = extractFunction(sources.groceries, 'weekIngredientRefs');
  if (!weekRefsBody || /\bmealIngredientRefs\s*\(/.test(weekRefsBody)) {
    findings.push('groceries.ts weekIngredientRefs must build refs from listMealWeek results instead of re-querying each meal with mealIngredientRefs');
  }

  if (!/pragma\s*\(\s*['"]journal_mode\s*=\s*WAL['"]\s*\)/.test(sources.runtime)) {
    findings.push('runtime.ts must enable SQLite WAL mode (db.pragma("journal_mode = WAL"))');
  }
  if (!/pragma\s*\(\s*['"]journal_mode\s*=\s*WAL['"]\s*\)/.test(sources.bootstrap)) {
    findings.push('bootstrap.ts must enable SQLite WAL mode (db.pragma("journal_mode = WAL"))');
  }

  const disableBody = extractFunction(sources.householdAccess, 'disableMember');
  if (!disableBody || !/activeDisables\s*>=\s*2/.test(disableBody) || !/finally\s*\{[\s\S]*?activeDisables--/.test(disableBody)) {
    findings.push('household-access.ts disableMember must enforce a concurrent worker cap and decrement in finally');
  }

  return findings;
}

it('enforces read-only generation fast path, batched hot queries, WAL mode, and worker concurrency caps', () => {
  expect(performanceAndConcurrencyFindings({
    appHtml: readFileSync('src/app.html', 'utf8'),
    recurring: readFileSync('src/lib/server/recurring.ts', 'utf8'),
    expenses: readFileSync('src/lib/server/expenses.ts', 'utf8'),
    expensePayments: readFileSync('src/lib/server/expense-payments.ts', 'utf8'),
    myDay: readFileSync('src/lib/server/my-day.ts', 'utf8'),
    groceries: readFileSync('src/lib/server/groceries.ts', 'utf8'),
    runtime: readFileSync('src/lib/server/runtime.ts', 'utf8'),
    bootstrap: readFileSync('src/lib/server/bootstrap.ts', 'utf8'),
    householdAccess: readFileSync('src/lib/server/household-access.ts', 'utf8')
  })).toEqual([]);
});

it('detects regressions across preload, N+1 queries, WAL mode, and worker caps (negative fixtures)', () => {
  const broken = performanceAndConcurrencyFindings({
    appHtml: '<body data-sveltekit-preload-data="hover"></body>',
    recurring: [
      'export function generateOccurrences() { db.transaction(() => { findPendingOccurrences(); }).immediate(); }',
      'export function listSeriesPage() { const items = rows.map(r => db.prepare("SELECT 1").get()); return items; }'
    ].join('\n'),
    expenses: [
      'export function skipExpense() { listExpenses(); }',
      'export function listExpenses() { for (const date of dates) { db.prepare("SELECT 1").get(); } }'
    ].join('\n'),
    expensePayments: 'export function recordExpensePayment() { listExpenses(); }',
    myDay: 'export function listPayoutHistory() { return childEarningSummaries(); }',
    groceries: 'function weekIngredientRefs() { return meals.flatMap(m => mealIngredientRefs(db, h, m.id).refs); }',
    runtime: "db.pragma('foreign_keys = ON');",
    bootstrap: "db.pragma('foreign_keys = ON');",
    householdAccess: 'export async function disableMember() { return new Worker(); }'
  });
  expect(broken).toHaveLength(11);
});
