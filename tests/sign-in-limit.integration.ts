import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

// Better Auth enables its sign-in limiter only for NODE_ENV=production, and the LaunchAgent
// starts the service with a minimal environment. Prove the packaged server throttles failed
// sign-ins when started by the real launcher, that each half of the fix holds on its own,
// and (negative control) that these requests can observe a disabled limiter at all.
const execFileAsync = promisify(execFile);
const throttled = [401, 401, 401, 429, 429];
const unthrottled = [401, 401, 401, 401, 401];
const secret = 'synthetic-sign-in-limit-secret-32-plus-chars';
// The check's own deadline stays below the node:test timeout so a hang reports its cause.
const checkDeadlineMs = 90_000;
const readinessDeadlineMs = 20_000;

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

/** Poll the auth health endpoint until it answers 200; fail fast if the server exits first. */
async function waitForReady(child: ChildProcess, origin: string, output: () => string, signal: AbortSignal): Promise<void> {
  const deadline = Date.now() + readinessDeadlineMs;
  let exited: string | undefined;
  const onExit = (code: number | null, killed: NodeJS.Signals | null) => { exited = `code ${code}, signal ${killed}`; };
  const onError = (error: Error) => { exited = `spawn error: ${error.message}`; };
  child.once('exit', onExit);
  child.once('error', onError);
  try {
    for (;;) {
      if (exited) throw new Error(`Server exited before readiness (${exited}):\n${output()}`);
      signal.throwIfAborted();
      if (Date.now() > deadline) throw new Error(`Server was not ready within ${readinessDeadlineMs} ms:\n${output()}`);
      try {
        const response = await fetch(`${origin}/api/auth/ok`, { signal: AbortSignal.any([signal, AbortSignal.timeout(1_000)]) });
        if (response.status === 200) {
          assert.deepEqual(await response.json(), { ok: true });
          return;
        }
        await response.body?.cancel();
      } catch (error) {
        if (signal.aborted) throw error;
        // Connection refused until the listener is bound; keep polling within the deadline.
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  } finally {
    child.off('exit', onExit);
    child.off('error', onError);
  }
}

async function stop(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
  try { await exited; } finally { clearTimeout(timer); }
}

test('the packaged server started by the launcher throttles repeated failed sign-ins', { timeout: checkDeadlineMs + 30_000 }, async () => {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(new Error(`Sign-in limit check exceeded ${checkDeadlineMs} ms`)), checkDeadlineMs);
  const { signal } = controller;
  const root = process.cwd();
  // The app copy stays under the checkout so mise resolves the project's pinned tools.
  const app = mkdtempSync(join(root, '.synthetic-sign-in-limit-'));
  // Private (0700) directory for the synthetic databases and launcher configuration.
  const data = mkdtempSync(join(tmpdir(), 'hub-sign-in-limit-'));
  let child: ChildProcess | undefined;
  try {
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    for (const path of ['src', 'static', 'drizzle']) cpSync(join(root, path), join(app, path), { recursive: true });
    for (const path of ['package.json', 'tsconfig.json', 'vite.config.ts']) copyFileSync(join(root, path), join(app, path));
    mkdirSync(join(app, 'scripts/pilot'), { recursive: true });
    for (const path of ['scripts/start.sh', 'scripts/pilot/launch.sh', 'scripts/migrate.ts']) copyFileSync(join(root, path), join(app, path));
    symlinkSync(join(root, 'node_modules'), join(app, 'node_modules'), 'dir');
    // Call the locked tools directly: pnpm in this lockfile-less copy would re-resolve and
    // reinstall dependencies through the shared node_modules link, outside the release cooldown.
    await execFileAsync('mise', ['exec', '--', 'node', 'node_modules/vite/bin/vite.js', 'build'], { cwd: app, env: { ...process.env, AUTH_ORIGIN: origin }, signal });
    const { stdout: which } = await execFileAsync('which', ['mise'], { signal });
    const mise = which.trim();
    // The LaunchAgent's PATH; launchd also provides HOME.
    const base = { PATH: `${dirname(mise)}:/usr/bin:/bin`, HOME: process.env.HOME ?? '' };

    let run = 0;
    async function statuses(start: 'launcher' | 'node', nodeEnv: string | undefined): Promise<number[]> {
      run += 1;
      const database = join(data, `run-${run}.sqlite`);
      writeFileSync(database, '', { mode: 0o600 });
      const settings = { DATABASE_PATH: database, AUTH_SECRET: secret, AUTH_ORIGIN: origin };
      await execFileAsync('mise', ['exec', '--', 'node', '--import', 'tsx', 'scripts/migrate.ts'], { cwd: app, env: { ...base, ...settings }, signal });
      const extra = nodeEnv === undefined ? {} : { NODE_ENV: nodeEnv };
      if (start === 'launcher') {
        const config = join(data, `run-${run}.conf`);
        writeFileSync(config, Object.entries({ ...settings, PORT: String(port) }).map(([key, value]) => `${key}=${value}\n`).join(''), { mode: 0o600 });
        child = spawn(join(app, 'scripts/pilot/launch.sh'), [], { cwd: app, env: { ...base, ...extra, HUB_ENV_FILE: config, HUB_MISE: mise }, stdio: ['ignore', 'pipe', 'pipe'] });
      } else {
        // The built server as start.sh would run it, minus start.sh's NODE_ENV export.
        child = spawn('mise', ['exec', '--', 'node', 'build'], { cwd: app, env: { ...base, ...settings, ...extra, HOST: '127.0.0.1', PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
      }
      let output = '';
      child.stdout?.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; });
      child.stderr?.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; });
      try {
        await waitForReady(child, origin, () => output, signal);
        const result: number[] = [];
        for (let attempt = 0; attempt < throttled.length; attempt += 1) {
          const response = await fetch(`${origin}/api/auth/sign-in/email`, {
            method: 'POST', headers: { origin, 'content-type': 'application/json' },
            body: JSON.stringify({ email: 'limit-check@example.test', password: `synthetic-wrong-password-${attempt}` }), signal
          });
          await response.body?.cancel();
          result.push(response.status);
        }
        return result;
      } finally {
        await stop(child);
        child = undefined;
      }
    }

    // The real launch path: launch.sh, then start.sh, with the LaunchAgent's environment.
    assert.deepEqual(await statuses('launcher', undefined), throttled, 'launch.sh -> start.sh must throttle failed sign-ins');
    // start.sh must force production even if a development value leaks into the environment.
    assert.deepEqual(await statuses('launcher', 'development'), throttled, 'start.sh must export NODE_ENV=production');
    // Without start.sh's export the application itself must fail closed on a missing NODE_ENV.
    assert.deepEqual(await statuses('node', undefined), throttled, 'An unset NODE_ENV must keep the limiter enabled');
    // Negative control: an explicit development server is not throttled, so these requests
    // observe the limiter rather than some unrelated 429.
    assert.deepEqual(await statuses('node', 'development'), unthrottled, 'NODE_ENV=development must disable the limiter');
  } finally {
    clearTimeout(deadline);
    await stop(child);
    rmSync(app, { recursive: true, force: true });
    rmSync(data, { recursive: true, force: true });
  }
});
