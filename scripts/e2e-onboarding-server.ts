import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';
import { migrate } from '../src/lib/server/identity';
import { setupCodeHash } from '../src/lib/server/setup-code';

// Blank database with a synthetic operator code. All accounts and household
// records are created through the real production flows in the browser.
const directory = mkdtempSync(join(tmpdir(), 'fleck-e2e-onboarding-'));
const dbPath = join(directory, 'fixture.sqlite');
const origin = 'http://127.0.0.1:4174';
const code = 'synthetic-setup-code-'.repeat(3).slice(0, 43);
const cacheDir = join(directory, 'vite');
mkdirSync(cacheDir);

try {
  const db = new Database(dbPath);
  try {
    db.pragma('foreign_keys = ON');
    await migrate(db);
    db.prepare('INSERT INTO initial_setup (id, code_hash, expires_at) VALUES (1, ?, ?)').run(setupCodeHash(code), Date.now() + 30 * 60 * 1000);
  } finally { db.close(); }
  const server = spawn('pnpm', ['exec', 'vite', 'dev', '--host', '127.0.0.1', '--port', '4174', '--strictPort'], {
    stdio: 'inherit',
    env: {
      ...process.env, DATABASE_PATH: dbPath, AUTH_ORIGIN: origin, E2E_VITE_CACHE_DIR: cacheDir,
      AUTH_SECRET: 'synthetic-onboarding-browser-secret-only', WEATHER_LATITUDE: '', WEATHER_LONGITUDE: ''
    }
  });
  const clean = (code: number) => {
    rmSync(directory, { recursive: true, force: true });
    process.exitCode = code;
  };
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => { server.kill(signal); });
  server.once('error', () => clean(1));
  server.once('exit', (code) => clean(code ?? 1));
} catch {
  rmSync(directory, { recursive: true, force: true });
  process.exitCode = 1;
}
