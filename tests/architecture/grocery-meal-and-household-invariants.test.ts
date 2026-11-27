import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// Guardrails for the #125 batch 8 fixes:
// 1. The groceries page must submit at most MAX_BOUGHT_CLEAR_ROWS bought rows per clear (boughtClearBatch),
//    never the whole bought list, or a list over the server limit can never be cleared.
// 2. meals.ts must validate recipe links with parseRecipeLink, the rule every meal surface uses to display
//    them, so a saved link is never silently hidden.
// 3. Every parent settings route must take its default household from parentHouseholds (parent
//    memberships only, ordered by name then id) instead of re-deriving it.

export function boughtClearFindings(pageSource: string, domainSource: string): string[] {
  const findings: string[] = [];
  if (!/export\s+const\s+MAX_BOUGHT_CLEAR_ROWS\b/.test(domainSource) || !/export\s+function\s+boughtClearBatch\b/.test(domainSource)) {
    findings.push('grocery/domain.ts must export MAX_BOUGHT_CLEAR_ROWS and boughtClearBatch');
  }
  if (!/boughtClearBatch\s*\(/.test(pageSource)) findings.push('groceries page must size the clear form with boughtClearBatch');
  if (/#each\s+groups\.bought\s+as\s+item\s*\(item\.id\)\}\s*<input\s+type="hidden"\s+name="id"/.test(pageSource)) {
    findings.push('groceries clear form must not submit every bought row; iterate the boughtClearBatch batch');
  }
  return findings;
}

export function mealRecipeLinkFindings(mealsSource: string): string[] {
  const findings: string[] = [];
  if (!/\bparseRecipeLink\s*\(/.test(mealsSource)) findings.push('meals.ts must validate recipeUrl with parseRecipeLink');
  if (/new URL\(\s*recipeUrl\s*\)/.test(mealsSource)) findings.push('meals.ts must not re-implement recipe URL validation with new URL(recipeUrl)');
  return findings;
}

export function parentRouteFindings(sources: Record<string, string>): string[] {
  const findings: string[] = [];
  for (const [file, source] of Object.entries(sources)) {
    if (/ORDER BY household\.name|active_membership\.role\s*=\s*'parent'/.test(source) && !/parentHouseholds\b/.test(source)) {
      findings.push(`${file} must list parent households with parentHouseholds`);
    }
    if (/SELECT household_id AS householdId, role FROM active_membership/.test(source)) {
      findings.push(`${file} must not derive its default household from the first membership of any role`);
    }
  }
  return findings;
}

const parentRoutes = ['src/routes/display/settings/+page.server.ts', 'src/routes/settings/household/+page.server.ts', 'src/routes/settings/displays/+page.server.ts', 'src/lib/server/parent-household.ts'];

it('enforces bounded bought clearing, shared recipe-link validation and one parent-household default', () => {
  expect(boughtClearFindings(readFileSync('src/routes/groceries/+page.svelte', 'utf8'), readFileSync('src/lib/grocery/domain.ts', 'utf8'))).toEqual([]);
  expect(mealRecipeLinkFindings(readFileSync('src/lib/server/meals.ts', 'utf8'))).toEqual([]);
  expect(parentRouteFindings(Object.fromEntries(parentRoutes.map(file => [file, readFileSync(file, 'utf8')])))).toEqual([]);
  expect(readFileSync('src/lib/server/parent-household.ts', 'utf8')).toMatch(/export function parentHouseholds\b/);
});

it('detects unbounded clears, divergent recipe validation and ad-hoc default households (negative fixtures)', () => {
  expect(boughtClearFindings(
    '{#each groups.bought as item (item.id)}<input type="hidden" name="id" value={item.id} />{/each}',
    'export const OTHER = 1;'
  )).toEqual([
    'grocery/domain.ts must export MAX_BOUGHT_CLEAR_ROWS and boughtClearBatch',
    'groceries page must size the clear form with boughtClearBatch',
    'groceries clear form must not submit every bought row; iterate the boughtClearBatch batch'
  ]);
  expect(mealRecipeLinkFindings('try { url = new URL(recipeUrl); } catch {}')).toEqual([
    'meals.ts must validate recipeUrl with parseRecipeLink',
    'meals.ts must not re-implement recipe URL validation with new URL(recipeUrl)'
  ]);
  expect(parentRouteFindings({
    'a.ts': "SELECT household_id AS householdId, role FROM active_membership WHERE user_id = ? ORDER BY household_id LIMIT 1",
    'b.ts': "JOIN active_membership ON x WHERE active_membership.role = 'parent' ORDER BY household.name"
  })).toEqual([
    'a.ts must not derive its default household from the first membership of any role',
    'b.ts must list parent households with parentHouseholds'
  ]);
  expect(parentRouteFindings({ 'ok.ts': "import { parentHouseholds } from './p'; parentHouseholds(db, id)" })).toEqual([]);
});
