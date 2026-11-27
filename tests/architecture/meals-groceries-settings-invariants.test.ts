import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// Guardrails for bought-grocery batch clearing, meal recipe URL validation, and parent-household selection:
// 1. /groceries clearBought form must bound hidden rows via boughtClearBatch(...) so households with >200
//    bought items are never locked out by the server's MAX_BOUGHT_CLEAR_ROWS / 64 KiB cap.
// 2. meals.ts validate() must validate recipeUrl via parseRecipeLink(...) (single source of truth with
//    RecipeCredit / recipeAttribution) so saved links are never silently hidden on render.
// 3. Parent administration routes (/display/settings, /settings/displays, /settings/household,
//    /settings/children) must share parentHouseholds/parentHousehold ordered by (name, id) over active
//    parent memberships so multi-household parents with a kid primary membership are never 403'd.

export function boughtClearFormFindings(groceriesPageSource: string): string[] {
  const formMatch = /<form[^>]*action="\?\/clearBought"[\s\S]*?<\/form>/.exec(groceriesPageSource);
  if (!formMatch) return ['groceries/+page.svelte clearBought form not found'];
  const findings: string[] = [];
  if (!groceriesPageSource.includes('boughtClearBatch(')) {
    findings.push('groceries/+page.svelte must bound clearBought submissions via boughtClearBatch(...)');
  }
  if (/#each\s+groups\.bought\b/.test(formMatch[0])) {
    findings.push('groceries/+page.svelte clearBought form must not iterate unbounded groups.bought directly');
  }
  return findings;
}

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

export function mealRecipeUrlFindings(mealsSource: string): string[] {
  const body = extractFunction(mealsSource, 'validate');
  if (!body) return ['meals.ts validate function not found'];
  const findings: string[] = [];
  if (!/\bparseRecipeLink\s*\(/.test(body)) {
    findings.push('meals.ts validate must use parseRecipeLink(...) so saved recipe URLs always match UI rendering');
  }
  if (/\bnew\s+URL\s*\(\s*recipeUrl\s*\)/.test(body)) {
    findings.push('meals.ts validate must not duplicate recipeUrl parsing with ad-hoc new URL(recipeUrl)');
  }
  return findings;
}

export function parentSettingsHouseholdFindings(parentHelperSource: string, routeSources: Record<string, string>): string[] {
  const findings: string[] = [];
  if (!/ORDER\s+BY\s+h\.name\s*,\s*h\.id/i.test(parentHelperSource) || !/m\.role\s*=\s*'parent'/i.test(parentHelperSource)) {
    findings.push('parent-household.ts must select active parent memberships ordered by h.name, h.id');
  }
  for (const [path, source] of Object.entries(routeSources)) {
    if (!/\bparentHouseholds?\s*\(/.test(source)) {
      findings.push(`${path}: must delegate parent household selection to parentHouseholds/parentHousehold`);
    }
    if (/SELECT\s+household_id\s+AS\s+householdId,\s*role\s+FROM\s+active_membership\b/i.test(source)) {
      findings.push(`${path}: must not filter default parent household through an unfiltered primary membership query`);
    }
  }
  return findings;
}

it('enforces bought-clear batching, meal recipeUrl single-source validation, and consistent parent household selection', () => {
  expect(boughtClearFormFindings(readFileSync('src/routes/groceries/+page.svelte', 'utf8'))).toEqual([]);
  expect(mealRecipeUrlFindings(readFileSync('src/lib/server/meals.ts', 'utf8'))).toEqual([]);
  expect(parentSettingsHouseholdFindings(readFileSync('src/lib/server/parent-household.ts', 'utf8'), {
    'src/routes/display/settings/+page.server.ts': readFileSync('src/routes/display/settings/+page.server.ts', 'utf8'),
    'src/routes/settings/displays/+page.server.ts': readFileSync('src/routes/settings/displays/+page.server.ts', 'utf8'),
    'src/routes/settings/household/+page.server.ts': readFileSync('src/routes/settings/household/+page.server.ts', 'utf8'),
    'src/routes/settings/children/+page.server.ts': readFileSync('src/routes/settings/children/+page.server.ts', 'utf8')
  })).toEqual([]);
});

it('detects bought-clear lockout, divergent meal recipeUrl validation, and settings household drift (negative fixtures)', () => {
  expect(boughtClearFormFindings(`
    <form method="POST" action="?/clearBought">
      {#each groups.bought as item}<input type="hidden" name="id" value={item.id} />{/each}
    </form>
  `)).toEqual([
    'groceries/+page.svelte must bound clearBought submissions via boughtClearBatch(...)',
    'groceries/+page.svelte clearBought form must not iterate unbounded groups.bought directly'
  ]);

  expect(mealRecipeUrlFindings(`
    function validate(input: any) {
      if (recipeUrl) { const u = new URL(recipeUrl); }
      return input;
    }
  `)).toEqual([
    'meals.ts validate must use parseRecipeLink(...) so saved recipe URLs always match UI rendering',
    'meals.ts validate must not duplicate recipeUrl parsing with ad-hoc new URL(recipeUrl)'
  ]);

  expect(parentSettingsHouseholdFindings(
    `SELECT h.id FROM household h ORDER BY h.id LIMIT 1`,
    {
      'src/routes/display/settings/+page.server.ts': `const primary = db.prepare('SELECT household_id AS householdId, role FROM active_membership WHERE user_id = ?').get();`
    }
  )).toEqual([
    'parent-household.ts must select active parent memberships ordered by h.name, h.id',
    'src/routes/display/settings/+page.server.ts: must delegate parent household selection to parentHouseholds/parentHousehold',
    'src/routes/display/settings/+page.server.ts: must not filter default parent household through an unfiltered primary membership query'
  ]);
});
