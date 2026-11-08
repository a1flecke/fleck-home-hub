// Local, read-only application diagnostic. It sends two unauthenticated GET
// requests to the loopback listener (/ and Better Auth's public /api/auth/ok)
// and opens the configured database read-only. It adds no route to the app,
// so it cannot bypass authorization, and its output never contains the secret,
// database path, account data, migration details or stack traces.
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { readIdentityConfig } from '../../src/lib/server/config';
import { parseEnvFile } from './envfile.mjs';

export type State = 'HEALTHY' | 'NOT_LISTENING' | 'RUNTIME_UNAVAILABLE' | 'CONFIG_INVALID' | 'DATABASE_UNAVAILABLE' | 'HTTPS_PROBE_FAILED';
export const EXIT_CODES: Record<State, number> = { HEALTHY: 0, NOT_LISTENING: 2, RUNTIME_UNAVAILABLE: 3, DATABASE_UNAVAILABLE: 4, CONFIG_INVALID: 5, HTTPS_PROBE_FAILED: 6 };
export interface Diagnosis { state: State; details: string[] }
interface Options { env: Record<string, string | undefined>; timeoutMs?: number; probeHttps?: boolean; fetchImpl?: typeof fetch }

const LOOPBACK = ['127.0.0.1', 'localhost', '::1'];

function databaseOk(path: string | undefined): boolean {
  if (!path) return false;
  let db: Database.Database | undefined;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
    return db.pragma('quick_check', { simple: true }) === 'ok';
  } catch { return false; } finally { try { db?.close(); } catch { /* ignore */ } }
}

export async function diagnose({ env, timeoutMs = 3000, probeHttps = false, fetchImpl = fetch }: Options): Promise<Diagnosis> {
  const details: string[] = [];
  const host = env.HOST ?? '127.0.0.1';
  const port = env.PORT ?? '3000';
  let configValid = true;
  let origin = '';
  try { origin = readIdentityConfig(env).origin; } catch { configValid = false; }
  if (!LOOPBACK.includes(host) || !/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    return { state: 'CONFIG_INVALID', details: ['HOST must be loopback and PORT a valid port; refusing to probe any other address.'] };
  }
  const base = `http://${host === '::1' ? '[::1]' : host}:${port}`;
  const get = async (url: string) => fetchImpl(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: {} });

  let landing: Response;
  try { landing = await get(`${base}/`); } catch (error) {
    const code = (error as { cause?: { code?: string } }).cause?.code;
    if (code === 'ECONNREFUSED') {
      if (!configValid) details.push('The environment you supplied is also incomplete or invalid (AUTH_SECRET, DATABASE_PATH or AUTH_ORIGIN).');
      return { state: 'NOT_LISTENING', details: ['Nothing is accepting connections on the configured loopback address.', ...details] };
    }
    return { state: 'RUNTIME_UNAVAILABLE', details: ['The port accepts connections but did not complete an HTTP response (reset, malformed or timed out).'] };
  }
  await landing.body?.cancel();
  if (landing.status >= 500) return { state: 'RUNTIME_UNAVAILABLE', details: ['The listener responds but the application returned a server error for the landing page.'] };
  details.push('HTTP listener responded.');

  let identity: number;
  try {
    const response = await get(`${base}/api/auth/ok`);
    await response.body?.cancel();
    identity = response.status;
  } catch { return { state: 'RUNTIME_UNAVAILABLE', details: [...details, 'The authentication runtime did not answer.'] }; }

  if (identity !== 200 && identity !== 503) return { state: 'RUNTIME_UNAVAILABLE', details: [...details, 'The authentication runtime returned an unexpected response.'] };
  if (!configValid) return { state: 'CONFIG_INVALID', details: [...details, 'Required settings (AUTH_SECRET of 32+ characters, DATABASE_PATH, and an HTTPS or localhost AUTH_ORIGIN) are missing or invalid in the environment you supplied.'] };
  if (!databaseOk(env.DATABASE_PATH)) return { state: 'DATABASE_UNAVAILABLE', details: [...details, 'The configured database could not be opened read-only or failed SQLite quick_check.'] };
  if (identity === 503) return { state: 'RUNTIME_UNAVAILABLE', details: [...details, 'The identity service reports unavailable although configuration and database look valid; inspect the service logs.'] };
  details.push('Authentication runtime and database responded; SQLite quick_check passed.');

  if (probeHttps) {
    if (!origin.startsWith('https://')) {
      details.push('HTTPS probe skipped: AUTH_ORIGIN is not HTTPS.');
    } else {
      try {
        const response = await fetchImpl(`${origin}/api/auth/ok`, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs * 3) });
        await response.body?.cancel();
        if (response.status !== 200) return { state: 'HTTPS_PROBE_FAILED', details: [...details, `The private HTTPS origin answered with status ${response.status}; investigate Tailscale Serve manually.`] };
        details.push('The private HTTPS origin answered from this Mac. This does not prove other devices, ACLs, certificates or cookies work.');
      } catch {
        return { state: 'HTTPS_PROBE_FAILED', details: [...details, 'The private HTTPS origin could not be reached from this Mac; investigate Tailscale Serve, DNS and certificates manually.'] };
      }
    }
  }
  return { state: 'HEALTHY', details };
}

async function main() {
  const args = process.argv.slice(2);
  let file: string | undefined; let probeHttps = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--config-file' && args[i + 1]) file = args[++i];
    else if (args[i] === '--probe-https') probeHttps = true;
    else { console.error('Usage: health.ts [--config-file PATH] [--probe-https]'); process.exit(64); }
  }
  let env: Record<string, string | undefined> = process.env;
  if (file) {
    const parsed = parseEnvFile(readFileSync(file, 'utf8'));
    if (parsed.errors.length) { console.log('CONFIG_INVALID\nThe configuration file has syntax errors; run the preflight for details.'); process.exit(EXIT_CODES.CONFIG_INVALID); }
    env = parsed.values;
  }
  const result = await diagnose({ env, probeHttps });
  console.log(`${result.state}\n${result.details.map(line => `  ${line}`).join('\n')}`);
  process.exit(EXIT_CODES[result.state]);
}
if (import.meta.url === new URL(process.argv[1] ?? '', 'file://').href || process.argv[1]?.endsWith('health.ts')) await main();
