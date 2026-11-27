import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

// Guardrails for route availability / SvelteKit load contracts and NWS weather hardening:
// 1. Every runtime call to getIdentityServices() outside runtime.ts must be inside a try block so an
//    unconfigured/unavailable identity service returns a controlled 503 instead of an unhandled 500.
// 2. /settings/sessions PageServerLoad must never return ActionFailure (fail(...) or failure(...)).
// 3. NWS weather fetches must use redirect: 'manual', credentials: 'omit', cancel unread bodies on
//    error/redirect, and bound JSON size via MAX_NWS_RESPONSE_BYTES.
// 4. NWS parsing must pass `now` to parseCurrent(...) and pass `timeZone` to readPeriodStart(...).

function walkTs(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkTs(full, acc);
    else if (full.endsWith('.ts') && !full.endsWith('.d.ts')) acc.push(full);
  }
  return acc;
}

export function unguardedIdentityServiceFindings(files: Record<string, string>): string[] {
  const findings: string[] = [];
  for (const [path, source] of Object.entries(files)) {
    if (path.endsWith('/runtime.ts')) continue;
    const lines = source.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!/\bgetIdentityServices\s*\(/.test(line)) continue;
      if (/^\s*import\b/.test(line) || /\bReturnType<typeof\s+getIdentityServices>/.test(line)) continue;
      const windowBefore = lines.slice(Math.max(0, i - 3), i + 1).join('\n');
      if (!/\btry\s*\{/.test(windowBefore)) {
        findings.push(`${path}:${i + 1}: getIdentityServices() must be guarded by try/catch returning 503`);
      }
    }
  }
  return findings;
}

export function sessionsLoadFailureFindings(source: string): string[] {
  const match = /export\s+const\s+load\b[\s\S]*?=>\s*\{/.exec(source);
  if (!match) return ['settings/sessions load function not found'];
  let depth = 1;
  let end = match.index + match[0].length;
  while (end < source.length && depth > 0) {
    if (source[end] === '{') depth += 1;
    else if (source[end] === '}') depth -= 1;
    end += 1;
  }
  const body = source.slice(match.index, end);
  return /\b(?:fail|failure)\s*\(/.test(body)
    ? ['settings/sessions load must throw error(...) or redirect(...), never return fail()/failure()']
    : [];
}

export function nwsHardeningFindings(nwsSource: string, nwsParseSource: string): string[] {
  const findings: string[] = [];
  if (!/redirect\s*:\s*'manual'/.test(nwsSource) || !/credentials\s*:\s*'omit'/.test(nwsSource)) {
    findings.push("nws.ts fetch must specify redirect: 'manual' and credentials: 'omit'");
  }
  if (!/\bMAX_NWS_RESPONSE_BYTES\b/.test(nwsSource) || !/\.cancel\s*\(/.test(nwsSource)) {
    findings.push('nws.ts must cap response bytes with MAX_NWS_RESPONSE_BYTES and cancel unread bodies on error/redirect');
  }
  if (!/\bparseCurrent\s*\([^,)]+,\s*[^)]+\)/.test(nwsSource)) {
    findings.push('nws.ts must pass current timestamp `now` into parseCurrent(...)');
  }
  if (!/\breadPeriodStart\s*\(\s*period\.startTime\s*,\s*timeZone\s*\)/.test(nwsParseSource)) {
    findings.push('nws-parse.ts parsePeriod must pass grid timeZone into readPeriodStart(...)');
  }
  return findings;
}

it('guards every getIdentityServices() call, forbids fail() in /settings/sessions load, and enforces NWS fetch/parse hardening', () => {
  const files = Object.fromEntries(walkTs('src').map((path) => [path, readFileSync(path, 'utf8')]));
  expect(unguardedIdentityServiceFindings(files)).toEqual([]);
  expect(sessionsLoadFailureFindings(readFileSync('src/routes/settings/sessions/+page.server.ts', 'utf8'))).toEqual([]);
  expect(nwsHardeningFindings(
    readFileSync('src/lib/weather/nws.ts', 'utf8'),
    readFileSync('src/lib/weather/nws-parse.ts', 'utf8')
  )).toEqual([]);
});

it('detects unguarded getIdentityServices, fail() in load, and NWS fetch/parse regressions (negative fixtures)', () => {
  expect(unguardedIdentityServiceFindings({
    'src/routes/bad/+page.server.ts': 'export function load() {\n  const services = getIdentityServices();\n  return services;\n}',
    'src/routes/good/+page.server.ts': 'export function load() {\n  try { return getIdentityServices(); } catch { error(503); }\n}'
  })).toEqual(['src/routes/bad/+page.server.ts:2: getIdentityServices() must be guarded by try/catch returning 503']);

  expect(sessionsLoadFailureFindings(`
    export const load = async () => {
      try { return {}; } catch (e) { return failure(e); }
    };
  `)).toEqual(['settings/sessions load must throw error(...) or redirect(...), never return fail()/failure()']);

  expect(nwsHardeningFindings(
    `fetchImpl(url, { headers, signal }); parseCurrent(hourlyResult.value);`,
    `function parsePeriod(p: any) { return readPeriodStart(p.startTime); }`
  )).toEqual([
    "nws.ts fetch must specify redirect: 'manual' and credentials: 'omit'",
    'nws.ts must cap response bytes with MAX_NWS_RESPONSE_BYTES and cancel unread bodies on error/redirect',
    'nws.ts must pass current timestamp `now` into parseCurrent(...)',
    'nws-parse.ts parsePeriod must pass grid timeZone into readPeriodStart(...)'
  ]);
});
