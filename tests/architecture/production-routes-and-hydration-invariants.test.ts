import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

// Guardrails for production route hygiene and pre-hydration/live-refresh safety:
// 1. No route under `src/routes/` may expose a test-only segment (such as `parent-test` or `*-test`).
// 2. `/sign-in` must read native form values on submit rather than binding `bind:value` to empty
//    state, which clobbers pre-hydration typing and password-manager autofill.
// 3. `/groceries` must scan pre-hydration DOM edits in `onMount`, abort in-flight refreshes when
//    editing starts, re-check `shouldApplyGroceryRefresh` after awaits, and pin edit versions via
//    `resolveEditFormVersion`.

function walkRoutes(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkRoutes(full, acc);
    else acc.push(full);
  }
  return acc;
}

export function testOnlyRouteFindings(routePaths: string[]): string[] {
  const findings: string[] = [];
  for (const path of routePaths) {
    const segments = path.replaceAll('\\', '/').split('/');
    if (segments.some((segment) => /(?:^|-)test$/i.test(segment) || /^test-/i.test(segment))) {
      findings.push(`${path}: test-only routes must not be shipped under src/routes/`);
    }
  }
  return findings;
}

export function signInHydrationFindings(signInSource: string): string[] {
  const findings: string[] = [];
  if (/\bbind:value\b/.test(signInSource)) {
    findings.push('sign-in/+page.svelte must not use bind:value on credentials (clobbers pre-hydration typing/autofill)');
  }
  if (!/\bnew\s+FormData\s*\(/.test(signInSource)) {
    findings.push('sign-in/+page.svelte should read submitted credentials from FormData');
  }
  return findings;
}

export function groceryLiveRefreshFindings(groceriesSource: string): string[] {
  const findings: string[] = [];
  if (!/\bresolveEditFormVersion\s*\(/.test(groceriesSource)) {
    findings.push('groceries/+page.svelte must pin edit form version via resolveEditFormVersion(...)');
  }
  if (!/\bshouldApplyGroceryRefresh\s*\(/.test(groceriesSource)) {
    findings.push('groceries/+page.svelte must re-check shouldApplyGroceryRefresh(...) after async refresh awaits');
  }
  if (!/\bsnapshotEdit\s*\(/.test(groceriesSource)) {
    findings.push('groceries/+page.svelte must snapshot item version when editing begins or disclosure opens');
  }
  if (!/querySelector<HTMLFormElement>\('form\[action="\?\/add"\]'\)/.test(groceriesSource)) {
    findings.push('groceries/+page.svelte onMount must inspect pre-hydration add-form DOM values');
  }
  return findings;
}

it('enforces production route hygiene, sign-in hydration safety, and grocery edit version locking', () => {
  expect(testOnlyRouteFindings(walkRoutes('src/routes'))).toEqual([]);
  expect(signInHydrationFindings(readFileSync('src/routes/sign-in/+page.svelte', 'utf8'))).toEqual([]);
  expect(groceryLiveRefreshFindings(readFileSync('src/routes/groceries/+page.svelte', 'utf8'))).toEqual([]);
});

it('detects test-only routes, sign-in bind:value, and grocery live-refresh regressions (negative fixtures)', () => {
  expect(testOnlyRouteFindings([
    'src/routes/api/households/[householdId]/parent-test/+server.ts',
    'src/routes/api/auth/[...all]/+server.ts'
  ])).toEqual([
    'src/routes/api/households/[householdId]/parent-test/+server.ts: test-only routes must not be shipped under src/routes/'
  ]);

  expect(signInHydrationFindings('<input type="email" bind:value={email} />')).toEqual([
    'sign-in/+page.svelte must not use bind:value on credentials (clobbers pre-hydration typing/autofill)',
    'sign-in/+page.svelte should read submitted credentials from FormData'
  ]);

  expect(groceryLiveRefreshFindings('<input type="hidden" name="version" value={item.version} />')).toEqual([
    'groceries/+page.svelte must pin edit form version via resolveEditFormVersion(...)',
    'groceries/+page.svelte must re-check shouldApplyGroceryRefresh(...) after async refresh awaits',
    'groceries/+page.svelte must snapshot item version when editing begins or disclosure opens',
    'groceries/+page.svelte onMount must inspect pre-hydration add-form DOM values'
  ]);
});
