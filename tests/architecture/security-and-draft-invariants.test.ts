import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, it } from 'vitest';
import { applySecurityHeaders, isDynamicResponsePath } from '../../src/lib/server/security-headers';

function routePaths(dir: string, prefix = ''): string[] {
  const paths = new Set<string>();
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      const segment = name.replace(/^\[(.+)\]$/, 'sample-$1');
      for (const child of routePaths(full, `${prefix}/${segment}`)) paths.add(child);
    } else if (/^\+(?:page\.svelte|page\.server\.ts|server\.ts)$/.test(name)) {
      paths.add(prefix || '/');
    }
  }
  return [...paths].sort();
}

export function hookCachePolicyFindings(source: string): string[] {
  const findings: string[] = [];
  if (!/\bapplySecurityHeaders\s*\(/.test(source)) {
    findings.push('hooks.server.ts must delegate security and cache headers to applySecurityHeaders');
  }
  if (/event\.url\.pathname\s*===\s*'\/dashboard'|cache-control.*no-store/i.test(source)) {
    findings.push('hooks.server.ts must not maintain a manual route allowlist for cache-control: no-store');
  }
  return findings;
}

export function recoveryDraftTokenFindings(source: string): string[] {
  const findings: string[] = [];
  const reviewedInputs = [...source.matchAll(/<input\b[^>]*name=["']reviewed["'][^>]*>/g)];
  if (!reviewedInputs.length) return ['Expected hidden reviewed input in recovery template'];
  for (const match of reviewedInputs) {
    if (!/\bdraft\?\.reviewed\b/.test(match[0])) {
      findings.push(`Hidden reviewed input must prefer retained draft token: ${match[0]}`);
    }
  }
  return findings;
}

export function unpairedDisplayPollingFindings(source: string): string[] {
  const findings: string[] = [];
  const onMountIndex = source.indexOf('onMount(');
  const intervalIndex = source.indexOf('setInterval(');
  if (onMountIndex < 0 || intervalIndex < 0) return ['Expected onMount polling setup in display page'];
  const beforeInterval = source.slice(onMountIndex, intervalIndex);
  if (!/current\.mode\s*===\s*'unpaired'\)\s*return\b/.test(beforeInterval)) {
    findings.push('display/+page.svelte must bail out of onMount before setInterval when current.mode === unpaired');
  }
  if (/else\s+if\s*\(\s*response\.redirected/.test(source)) {
    findings.push('display/+page.svelte must only redirect to /sign-in when current.mode === member');
  }
  return findings;
}

it('applies Cache-Control: no-store to every discovered dynamic route and its __data.json endpoint', () => {
  const routes = routePaths('src/routes');
  expect(routes.length).toBeGreaterThan(15);
  expect(routes).toEqual(expect.arrayContaining(['/', '/dashboard', '/chores/week', '/chores/week/again', '/sign-in', '/sign-out', '/display', '/display/data']));
  for (const route of routes) {
    const html = applySecurityHeaders(new Response(), route);
    expect(html.headers.get('cache-control'), route).toBe('no-store');
    expect(html.headers.get('x-content-type-options'), route).toBe('nosniff');
    expect(html.headers.get('x-frame-options'), route).toBe('DENY');
    const dataPath = route === '/' ? '/__data.json' : `${route}/__data.json`;
    const data = applySecurityHeaders(new Response(), dataPath);
    expect(data.headers.get('cache-control'), dataPath).toBe('no-store');
  }
  for (const asset of readdirSync('static')) {
    expect(isDynamicResponsePath(`/${asset}`), asset).toBe(false);
  }
  expect(isDynamicResponsePath('/_app/immutable/entry/app.js')).toBe(false);
  expect(applySecurityHeaders(new Response(), '/_app/immutable/entry/app.js').headers.get('cache-control')).toBeNull();
});

it('hooks.server.ts uses default-deny applySecurityHeaders rather than a manual route allowlist', () => {
  const hooks = readFileSync('src/hooks.server.ts', 'utf8');
  expect(hookCachePolicyFindings(hooks)).toEqual([]);
});

it('chores/recovery preserves the submitted reviewed token on retained drafts', () => {
  const recovery = readFileSync('src/routes/chores/recovery/+page.svelte', 'utf8');
  expect(recoveryDraftTokenFindings(recovery)).toEqual([]);
});

it('display page never polls or redirects to /sign-in while unpaired', () => {
  const display = readFileSync('src/routes/display/+page.svelte', 'utf8');
  expect(unpairedDisplayPollingFindings(display)).toEqual([]);
});

it('detects manual cache allowlists, overwritten recovery reviewed tokens and unpaired kiosk polling (negative fixtures)', () => {
  expect(hookCachePolicyFindings(`
    if (event.url.pathname === '/dashboard') response.headers.set('cache-control', 'no-store');
  `)).toEqual([
    'hooks.server.ts must delegate security and cache headers to applySecurityHeaders',
    'hooks.server.ts must not maintain a manual route allowlist for cache-control: no-store'
  ]);

  expect(recoveryDraftTokenFindings(`<input type="hidden" name="reviewed" value={gap.reviewed} />`)).toEqual([
    'Hidden reviewed input must prefer retained draft token: <input type="hidden" name="reviewed" value={gap.reviewed} />'
  ]);

  expect(unpairedDisplayPollingFindings(`
    onMount(() => {
      const timer = setInterval(() => {
        if (current.mode === 'device') { window.location.assign('/display'); }
        else if (response.redirected || response.status === 401) { window.location.assign('/sign-in'); }
      }, 60_000);
    });
  `)).toEqual([
    'display/+page.svelte must bail out of onMount before setInterval when current.mode === unpaired',
    'display/+page.svelte must only redirect to /sign-in when current.mode === member'
  ]);

  // Verify relative path helper is kept tidy without unused warnings.
  expect(relative(process.cwd(), join(process.cwd(), 'src/hooks.server.ts'))).toBe('src/hooks.server.ts');
});
