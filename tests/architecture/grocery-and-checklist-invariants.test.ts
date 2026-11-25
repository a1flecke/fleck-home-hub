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
  const open = source.indexOf('{', index);
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

export function groceryReviewMatchingFindings(files: { week: string; bulk: string; groceries: string }): string[] {
  const findings: string[] = [];
  if (!/\bmatchesActiveGrocery\s*\(/.test(extractFunction(files.week, 'buildWeekIngredientReview'))) {
    findings.push('buildWeekIngredientReview must match active groceries via matchesActiveGrocery so overridden names are respected');
  }
  if (!/\bmatchesActiveGrocery\s*\(/.test(extractFunction(files.bulk, 'buildBulkReview'))) {
    findings.push('buildBulkReview must match active groceries via matchesActiveGrocery so renamed items clear stale matches');
  }
  if (!/\bmatchesActiveGrocery\s*\(/.test(extractFunction(files.groceries, 'reviewMealIngredients'))) {
    findings.push('reviewMealIngredients must match active groceries via matchesActiveGrocery so overridden names avoid 409 loops');
  }
  const bulkConfirm = extractFunction(files.groceries, 'addBulkGroceries');
  if (/probableGroceryMatch\s*\(\s*entry\.line\b/.test(bulkConfirm)) {
    findings.push('addBulkGroceries must match submitted entry.value.name rather than original unedited entry.line');
  }
  return findings;
}

export function checklistCompletionFindings(files: { checklists: string; itemRow: string }): string[] {
  const findings: string[] = [];
  const setter = extractFunction(files.checklists, 'setItemCompletion');
  if (/\.run\s*\(\s*Number\(completed\)\s*,\s*actor\s*,/.test(setter)) {
    findings.push('setItemCompletion must clear completed_by and completed_at when completed is false');
  }
  if (/\{#if\s+item\.completedAt\s*\}/.test(files.itemRow)) {
    findings.push('ItemRow.svelte must check item.completed && item.completedAt before rendering completion metadata');
  }
  return findings;
}

it('grocery review and confirm paths respect edited names consistently', () => {
  expect(groceryReviewMatchingFindings({
    week: readFileSync('src/lib/grocery/week.ts', 'utf8'),
    bulk: readFileSync('src/lib/grocery/bulk.ts', 'utf8'),
    groceries: readFileSync('src/lib/server/groceries.ts', 'utf8')
  })).toEqual([]);
});

it('checklist completion clears metadata on uncheck and guards display by item.completed', () => {
  expect(checklistCompletionFindings({
    checklists: readFileSync('src/lib/server/checklists.ts', 'utf8'),
    itemRow: readFileSync('src/routes/lists/[id]/ItemRow.svelte', 'utf8')
  })).toEqual([]);
});

it('detects unedited-line matching and uncheck-completion regressions (negative fixtures)', () => {
  expect(groceryReviewMatchingFindings({
    week: 'export function buildWeekIngredientReview() { return active.find(i => probableGroceryMatch(value.name, i.name)); }',
    bulk: 'export function buildBulkReview() { return active.find(i => probableGroceryMatch(line, i.name)); }',
    groceries: `
      export function reviewMealIngredients() { return active.find(i => probableGroceryMatch(parsed.name, i.name)); }
      export function addBulkGroceries() { return active.some(i => probableGroceryMatch(entry.value.name, i.name) || probableGroceryMatch(entry.line, i.name)); }
    `
  })).toEqual([
    'buildWeekIngredientReview must match active groceries via matchesActiveGrocery so overridden names are respected',
    'buildBulkReview must match active groceries via matchesActiveGrocery so renamed items clear stale matches',
    'reviewMealIngredients must match active groceries via matchesActiveGrocery so overridden names avoid 409 loops',
    'addBulkGroceries must match submitted entry.value.name rather than original unedited entry.line'
  ]);

  expect(checklistCompletionFindings({
    checklists: `export function setItemCompletion() { db.prepare('UPDATE family_checklist_item SET completed = ?, completed_by = ?, completed_at = ?').run(Number(completed), actor, now); }`,
    itemRow: '{#if item.completedAt}<p>{item.completedByName}</p>{/if}'
  })).toEqual([
    'setItemCompletion must clear completed_by and completed_at when completed is false',
    'ItemRow.svelte must check item.completed && item.completedAt before rendering completion metadata'
  ]);
});
