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

export function fetchTimerAndPilotFindings(sources: {
  recipePreview: string;
  displayWeather: string;
  pilotHealth: string;
  pilotPreflight: string;
  pilotLaunch: string;
}): string[] {
  const findings: string[] = [];

  const fetchHtmlBody = extractFunction(sources.recipePreview, 'fetchRecipeHtml');
  const loopPos = fetchHtmlBody.indexOf('for (');
  const timeoutPos = fetchHtmlBody.indexOf('AbortSignal.timeout(');
  if (!fetchHtmlBody || loopPos < 0 || timeoutPos < 0 || timeoutPos > loopPos) {
    findings.push('recipe-preview.ts fetchRecipeHtml must create one shared AbortSignal.timeout(...) before the redirect loop');
  }
  if (!fetchHtmlBody || !/discardBody\s*\(\s*response\s*\)|response\.body\?\.cancel\s*\(/.test(fetchHtmlBody)) {
    findings.push('recipe-preview.ts fetchRecipeHtml must cancel unread response bodies on redirects and rejections');
  }

  const weatherBody = extractFunction(sources.displayWeather, 'createDisplayWeatherSource');
  if (!weatherBody || !/\bgeneration\b/.test(weatherBody) || !/runId\s*!==\s*generation/.test(weatherBody)) {
    findings.push('display-weather.ts createDisplayWeatherSource must guard background refresh scheduling with a generation counter');
  }

  const healthMain = extractFunction(sources.pilotHealth, 'main');
  if (!healthMain || !/try\s*\{[\s\S]*?readFileSync\s*\(\s*file/.test(healthMain)) {
    findings.push('scripts/pilot/health.ts main must catch readFileSync errors on --config-file and exit CONFIG_INVALID without leaking paths or stack traces');
  }
  if (!/isAuthOkResponse\s*\(/.test(sources.pilotHealth) || !/\.ok\s*===\s*true/.test(sources.pilotHealth)) {
    findings.push('scripts/pilot/health.ts must verify /api/auth/ok returns JSON { ok: true }');
  }

  if (/LOOPBACK_HOSTS\s*=\s*\[[^\]]*'\[::1\]'/.test(sources.pilotPreflight)) {
    findings.push('scripts/pilot/preflight.mjs LOOPBACK_HOSTS must not accept bracketed [::1] (align with launch.sh and health.ts)');
  }
  if (!/attempt\s*\(\s*file\s*,\s*\(\)\s*=>\s*readFileSync\s*\(\s*file/.test(sources.pilotPreflight)) {
    findings.push('scripts/pilot/preflight.mjs must wrap envFile readFileSync in attempt(...) so mode-000 files fail cleanly');
  }
  if (!/lstatSync\s*\(\s*dbDir\s*\)/.test(sources.pilotPreflight) || !/dirStat\.uid\s*!==\s*ctx\.uid/.test(sources.pilotPreflight) || !/lstatSync\s*\(\s*dir\s*\)/.test(sources.pilotPreflight)) {
    findings.push('scripts/pilot/preflight.mjs must use lstatSync and check uid/isDirectory on database and backup directories');
  }

  if (!/printf\s+'\\r'/.test(sources.pilotLaunch)) {
    findings.push('scripts/pilot/launch.sh must reject carriage returns (CRLF) in hub.conf to match envfile.mjs');
  }
  if (!/\[\s*!\s*-L\s+"\$logdir"\s*\]/.test(sources.pilotLaunch) || !/\[\s*-L\s+"\$backup"\s*\]/.test(sources.pilotLaunch)) {
    findings.push('scripts/pilot/launch.sh must guard log rotation against symlinked log directories and backup files without aborting startup');
  }

  return findings;
}

it('enforces bounded recipe fetch, generation-guarded weather timer, and hardened pilot scripts', () => {
  expect(fetchTimerAndPilotFindings({
    recipePreview: readFileSync('src/lib/server/recipe-preview.ts', 'utf8'),
    displayWeather: readFileSync('src/lib/server/display-weather.ts', 'utf8'),
    pilotHealth: readFileSync('scripts/pilot/health.ts', 'utf8'),
    pilotPreflight: readFileSync('scripts/pilot/preflight.mjs', 'utf8'),
    pilotLaunch: readFileSync('scripts/pilot/launch.sh', 'utf8')
  })).toEqual([]);
});

it('detects regressions across recipe fetch, weather timer, and pilot scripts (negative fixtures)', () => {
  const broken = fetchTimerAndPilotFindings({
    recipePreview: 'async function fetchRecipeHtml() { for (let i = 0; i < 3; i++) { await fetch(u, { signal: AbortSignal.timeout(5000) }); } }',
    displayWeather: 'export function createDisplayWeatherSource() { let timer; function schedule() { timer = setTimeout(() => schedule(), 1000); } }',
    pilotHealth: 'async function main() { const parsed = parseEnvFile(readFileSync(file, "utf8")); }',
    pilotPreflight: "const LOOPBACK_HOSTS = ['127.0.0.1', '[::1]']; readFileSync(file, 'utf8'); statSync(dbDir); statSync(dir);",
    pilotLaunch: 'while IFS= read -r line; do :; done\nif [ -d "$logdir" ]; then cp -p "$log" "$log.1"; fi'
  });
  expect(broken).toHaveLength(10);
});
