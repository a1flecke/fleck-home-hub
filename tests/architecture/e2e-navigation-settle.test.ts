import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

// Guardrail for browser tests acting during an in-flight SvelteKit client-side navigation
// (main CI run 45930899060). Playwright waits for browser navigations, not for SvelteKit's
// client router, so after a link click or GET-form submission `click()` returns while the
// outgoing page is still rendered. On a same-route navigation the next action can target the
// outgoing DOM, and SvelteKit's focus reset can drop a `fill()` in progress. A content assertion
// is not a substitute: the content may exist on both pages.
//
// Rule: a navigating click must be followed by `settle(...)` (e2e/support/navigation.ts),
// a `goto(...)`, or the end of the test. A deliberate exception carries `// no-settle: <reason>`.
// Hydration is awaited with `hydrated(...)`, never `waitForLoadState('networkidle')`, which says
// nothing about hydration and can wait forever while background requests continue.

/** Submit-button labels of GET forms in the app: clicking one navigates. */
export function getFormButtonNames(svelteSources: string[]): string[] {
  const names = new Set<string>();
  for (const source of svelteSources) {
    for (const form of source.matchAll(/<form\b[^>]*method="GET"[^>]*>([\s\S]*?)<\/form>/gi)) {
      for (const button of form[1].matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi)) {
        const label = button[1].replace(/\{[^}]*\}|<[^>]+>/g, '').trim();
        if (label) names.add(label);
      }
    }
  }
  return [...names].sort();
}

function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export function navigationSettleFindings(specs: Record<string, string>, getButtons: string[]): string[] {
  const findings: string[] = [];
  const button = getButtons.length ? new RegExp(`getByRole\\('button', \\{ name: '(?:${getButtons.map(escapeRegExp).join('|')})'`) : null;
  for (const [file, source] of Object.entries(specs)) {
    const lines = source.split('\n');
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (!/\.click\(/.test(line)) continue;
      const navigates = /getByRole\('link'/.test(line) || (button?.test(line) ?? false);
      if (!navigates) continue;
      if (/\/\/ no-settle: \S/.test(line) || /\/\/ no-settle: \S/.test(lines[index - 1] ?? '')) continue;
      let end = index;
      while (end < lines.length - 1 && !/;\s*(\/\/.*)?$/.test(lines[end])) end++;
      let next = end + 1;
      while (next < lines.length && (!lines[next].trim() || /^\s*\/\//.test(lines[next]) || /^\s*const \w+ = [\w.]+\.(getBy\w+|locator|filter|first|last|nth)\(/.test(lines[next]))) next++;
      const following = (lines[next] ?? '').trim();
      if (/\bsettle\(/.test(following) || /\.goto\(/.test(following) || /^\}\);/.test(following) || /^\}\s*(finally|catch)\b/.test(following)) continue;
      findings.push(`${file}:${index + 1} navigating click must be followed by await settle(...) before the next action or read`);
    }
  }
  return findings;
}

/** Browser tests run against a production build, which never serves src/routes modules. */
export function devModuleFindings(specs: Record<string, string>): string[] {
  return Object.entries(specs).flatMap(([file, source]) => source.split('\n').flatMap((line, index) =>
    /src\/routes/.test(line) && !/^\s*(\/\/|\*)/.test(line) ? [`${file}:${index + 1} gate a page module with pageModule(...), not a dev-server src/routes URL`] : []));
}

export function networkIdleFindings(specs: Record<string, string>): string[] {
  return Object.entries(specs).flatMap(([file, source]) => source.split('\n').flatMap((line, index) =>
    /['"]networkidle['"]/.test(line) && !/^\s*(\/\/|\*)/.test(line) ? [`${file}:${index + 1} wait for hydration with hydrated(...), not networkidle`] : []));
}

function walk(directory: string, suffix: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path, suffix) : path.endsWith(suffix) ? [path] : [];
  });
}

it('derives the GET-form submit buttons from the app', () => {
  const names = getFormButtonNames(walk('src/routes', '.svelte').map(file => readFileSync(file, 'utf8')));
  expect(names).toContain('Search');
  expect(names).toContain('Show calendar');
});

it('settles every navigating click in the browser tests', () => {
  const buttons = getFormButtonNames(walk('src/routes', '.svelte').map(file => readFileSync(file, 'utf8')));
  const specs = Object.fromEntries(walk('e2e', '.spec.ts').map(file => [file, readFileSync(file, 'utf8')]));
  expect(navigationSettleFindings(specs, buttons)).toEqual([]);
});

it('waits for hydration with the readiness marker, not network idle', () => {
  const sources = Object.fromEntries(walk('e2e', '.ts').map(file => [file, readFileSync(file, 'utf8')]));
  expect(networkIdleFindings(sources)).toEqual([]);
  expect(networkIdleFindings({ 'fixture.spec.ts': "  release();\n  await delayed.waitForLoadState('networkidle');\n  // networkidle is not used\n" })).toEqual([
    'fixture.spec.ts:2 wait for hydration with hydrated(...), not networkidle'
  ]);
});

it('gates page modules through pageModule(), which works in build and dev mode', () => {
  const sources = Object.fromEntries(walk('e2e', '.ts').filter(file => !file.endsWith('support/modules.ts')).map(file => [file, readFileSync(file, 'utf8')]));
  expect(devModuleFindings(sources)).toEqual([]);
  expect(devModuleFindings({ 'fixture.spec.ts': "  await page.route('**/src/routes/expenses/+page.svelte*', delay);\n  const module = `**/src/routes${path}/+page.svelte*`;\n  await page.route(pageModule('expenses'), delay);\n" })).toEqual([
    'fixture.spec.ts:1 gate a page module with pageModule(...), not a dev-server src/routes URL',
    'fixture.spec.ts:2 gate a page module with pageModule(...), not a dev-server src/routes URL'
  ]);
});

it('detects unsettled navigating clicks (negative fixtures)', () => {
  expect(getFormButtonNames(['<form method="GET"><input name="q" /><button class="x">Search</button></form><form method="POST"><button>Save</button></form>'])).toEqual(['Search']);
  const spec = [
    "test('a', async ({ page }) => {",
    "  await page.getByRole('link', { name: 'Clear search' }).click();",
    "  await page.getByLabel('Search recent chores').fill('Clean bedroom');",
    "  await page.getByRole('button', { name: 'Search' }).click();",
    "  const result = page.getByRole('article');",
    "  await expect(result).toBeVisible();",
    "  for (let i = 0; i < 20 && await form.count() === 0; i++) {",
    "    await page.getByRole('link', { name: 'Next chore' }).click();",
    "  }",
    "  await event.getByRole('link', { name: 'Edit' }).click();",
    "  await settle(event);",
    "  await page.getByRole('link', { name: 'Home' }).click();",
    "  await page.goto('/dashboard');",
    "  // no-settle: acts before hydration on purpose",
    "  await page.getByRole('link', { name: 'Later' }).click();",
    "  await page.getByRole('button', { name: 'Save' }).click();",
    "  await page.getByLabel('Name').fill('x');",
    "  await page.getByRole('link', { name: 'Done' }).click();",
    "});"
  ].join('\n');
  expect(navigationSettleFindings({ 'fixture.spec.ts': spec }, ['Search'])).toEqual([
    'fixture.spec.ts:2 navigating click must be followed by await settle(...) before the next action or read',
    'fixture.spec.ts:4 navigating click must be followed by await settle(...) before the next action or read',
    'fixture.spec.ts:8 navigating click must be followed by await settle(...) before the next action or read'
  ]);
});
