import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

// Guardrails for Node worker isolation, route DB reuse, and pilot ops scripts:
// 1. Every `new Worker(...)` in `src/lib/server/` must declare an explicit `env:` object,
//    pass a minimal `config: { secret: ..., origin: ... }` (never raw `config`), and drain
//    piped stdout/stderr via `worker.stdout.resume()` and `worker.stderr.resume()`.
// 2. Routes under `src/routes/` must never call `new Database(...)` directly (reuse getIdentityServices()).
// 3. `scripts/pilot/tailscale-check.mjs` must inspect `Foreground` configs for `AllowFunnel`,
//    require `https:` + HTTPS-only TCP termination, and compare MagicDNS names case-insensitively.
// 4. `scripts/pilot/launchd.mjs` must use `lstatSync` (never `existsSync`), enforce owner `uid`
//    and `isDirectory()` before `chmodSync`, and check `X_OK` in `findMise`.

function walkTs(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkTs(full, acc);
    else if (full.endsWith('.ts') && !full.endsWith('.d.ts')) acc.push(full);
  }
  return acc;
}

export function workerIsolationFindings(files: Record<string, string>): string[] {
  const findings: string[] = [];
  for (const [path, source] of Object.entries(files)) {
    const matches = [...source.matchAll(/\bnew\s+Worker\s*\(/g)];
    for (const match of matches) {
      const slice = source.slice(match.index, match.index + 600);
      if (!/\benv\s*:\s*\{/.test(slice)) {
        findings.push(`${path}: new Worker(...) must pass an explicit minimal env object`);
      }
      if (!/worker\.stdout\.resume\s*\(\s*\)/.test(slice) || !/worker\.stderr\.resume\s*\(\s*\)/.test(slice)) {
        findings.push(`${path}: new Worker(...) with piped streams must call worker.stdout.resume() and worker.stderr.resume()`);
      }
      if (/\bworkerData\s*:\s*\{[\s\S]*?\bconfig\s*,/.test(slice)) {
        findings.push(`${path}: workerData must pass minimal config: { secret, origin }, not raw config`);
      }
    }
  }
  return findings;
}

export function directRouteDatabaseFindings(routeFiles: Record<string, string>): string[] {
  const findings: string[] = [];
  for (const [path, source] of Object.entries(routeFiles)) {
    if (/\bnew\s+Database\s*\(/.test(source)) {
      findings.push(`${path}: routes must reuse getIdentityServices() instead of opening new Database(...)`);
    }
  }
  return findings;
}

export function pilotScriptFindings(tailscaleSource: string, launchdSource: string): string[] {
  const findings: string[] = [];
  if (!/\.Foreground\b/.test(tailscaleSource)) {
    findings.push('tailscale-check.mjs must inspect serve.Foreground for AllowFunnel/Web/TCP entries');
  }
  if (!/url\.protocol\s*!==\s*'https:'/.test(tailscaleSource) || !/\.HTTPS\s*===\s*true/.test(tailscaleSource)) {
    findings.push('tailscale-check.mjs must enforce https: origin and HTTPS-only TCP termination');
  }
  if (!/dns\.toLowerCase\(\)\s*===\s*host\.toLowerCase\(\)/.test(tailscaleSource)) {
    findings.push('tailscale-check.mjs must compare Self.DNSName and origin host case-insensitively');
  }
  if (/\bexistsSync\b/.test(launchdSource)) {
    findings.push('launchd.mjs must use lstatSync instead of existsSync so broken symlinks cannot slip past guards');
  }
  if (!/\.uid\s*!==\s*o\.uid/.test(launchdSource) || !/\.isDirectory\(\)/.test(launchdSource)) {
    findings.push('launchd.mjs must verify owner uid and non-symlink directory type before chmodSync/install');
  }
  if (!/function\s+findMise[\s\S]*?isFile\(\)[\s\S]*?constants\.X_OK/.test(launchdSource)) {
    findings.push('launchd.mjs findMise must verify both isFile() and constants.X_OK');
  }
  return findings;
}

it('enforces worker isolation, route DB reuse, and pilot script safety invariants', () => {
  const serverFiles = Object.fromEntries(walkTs('src/lib/server').map((p) => [p, readFileSync(p, 'utf8')]));
  const routeFiles = Object.fromEntries(walkTs('src/routes').map((p) => [p, readFileSync(p, 'utf8')]));
  expect(workerIsolationFindings(serverFiles)).toEqual([]);
  expect(directRouteDatabaseFindings(routeFiles)).toEqual([]);
  expect(pilotScriptFindings(
    readFileSync('scripts/pilot/tailscale-check.mjs', 'utf8'),
    readFileSync('scripts/pilot/launchd.mjs', 'utf8')
  )).toEqual([]);
});

it('detects worker leakage, direct route DB opens, and pilot script regressions (negative fixtures)', () => {
  expect(workerIsolationFindings({
    'src/lib/server/bad.ts': 'const worker = new Worker(src, { eval: true, workerData: { path, config, token }, stdout: true, stderr: true });'
  })).toEqual([
    'src/lib/server/bad.ts: new Worker(...) must pass an explicit minimal env object',
    'src/lib/server/bad.ts: new Worker(...) with piped streams must call worker.stdout.resume() and worker.stderr.resume()',
    'src/lib/server/bad.ts: workerData must pass minimal config: { secret, origin }, not raw config'
  ]);

  expect(directRouteDatabaseFindings({
    'src/routes/bad/+page.server.ts': 'const db = new Database(path);'
  })).toEqual([
    'src/routes/bad/+page.server.ts: routes must reuse getIdentityServices() instead of opening new Database(...)'
  ]);

  expect(pilotScriptFindings(
    'const funnel = serve.AllowFunnel; const ok = dns === host;',
    'if (existsSync(plistPath)) rmSync(plistPath); function findMise() { return statSync(c).isFile(); }'
  )).toEqual([
    'tailscale-check.mjs must inspect serve.Foreground for AllowFunnel/Web/TCP entries',
    'tailscale-check.mjs must enforce https: origin and HTTPS-only TCP termination',
    'tailscale-check.mjs must compare Self.DNSName and origin host case-insensitively',
    'launchd.mjs must use lstatSync instead of existsSync so broken symlinks cannot slip past guards',
    'launchd.mjs must verify owner uid and non-symlink directory type before chmodSync/install',
    'launchd.mjs findMise must verify both isFile() and constants.X_OK'
  ]);
});
