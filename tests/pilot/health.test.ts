import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer as createHttp, type IncomingMessage, type Server } from 'node:http';
import { createServer as createNet } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
import Database from 'better-sqlite3';
import { diagnose, EXIT_CODES } from '../../scripts/pilot/health';

const SECRET = 'synthetic-health-secret-value-0123456789-SENTINEL';
let dir = '';
let servers: { close: () => void }[] = [];
let requests: { method?: string; url?: string; headers: IncomingMessage['headers'] }[] = [];
const origin = 'https://hub.example.ts.net';

async function serve(handler: (url: string) => { status: number; body?: string } | 'destroy') {
  const server: Server = createHttp((req, res) => {
    requests.push({ method: req.method, url: req.url, headers: req.headers });
    const out = handler(req.url ?? '');
    if (out === 'destroy') { req.socket.destroy(); return; }
    res.writeHead(out.status, { 'content-type': 'text/plain' }); res.end(out.body ?? '');
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  servers.push({ close: () => { server.closeAllConnections(); server.close(); } });
  return (server.address() as { port: number }).port;
}
async function freePort() {
  const s = createNet(); await new Promise<void>(r => s.listen(0, '127.0.0.1', r));
  const port = (s.address() as { port: number }).port; await new Promise(r => s.close(r)); return port;
}
let counter = 0;
function makeDb(name = `hub-${++counter}.sqlite`) {
  const path = join(dir, name);
  const db = new Database(path); db.exec("CREATE TABLE user (id TEXT); INSERT INTO user VALUES ('synthetic')"); db.close();
  return path;
}
const env = (port: number, db: string, extra: Record<string, string | undefined> = {}): Record<string, string | undefined> => ({ AUTH_SECRET: SECRET, DATABASE_PATH: db, AUTH_ORIGIN: origin, HOST: '127.0.0.1', PORT: String(port), ...extra });

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'hub-health-')); requests = []; });
afterEach(() => { servers.forEach(s => s.close()); servers = []; rmSync(dir, { recursive: true, force: true }); });

describe('health states', () => {
  it('reports NOT_LISTENING when nothing is listening', async () => {
    const result = await diagnose({ env: env(await freePort(), makeDb()) });
    expect(result.state).toBe('NOT_LISTENING');
  });
  it('reports RUNTIME_UNAVAILABLE for a listener that is not HTTP-responsive', async () => {
    const s = createNet(socket => socket.destroy()); await new Promise<void>(r => s.listen(0, '127.0.0.1', r));
    servers.push({ close: () => s.close() });
    expect((await diagnose({ env: env((s.address() as { port: number }).port, makeDb()), timeoutMs: 1000 })).state).toBe('RUNTIME_UNAVAILABLE');
  });
  it('reports RUNTIME_UNAVAILABLE when the landing page fails server-side', async () => {
    const port = await serve(() => ({ status: 500, body: 'Error: stack at /secret/path' }));
    const result = await diagnose({ env: env(port, makeDb()) });
    expect(result.state).toBe('RUNTIME_UNAVAILABLE');
    expect(JSON.stringify(result)).not.toContain('/secret/path');
  });
  it('reports HEALTHY only when HTTP, the auth runtime and the database all respond', async () => {
    const port = await serve(url => url === '/api/auth/ok' ? { status: 200, body: '{"ok":true}' } : { status: 200, body: '<html>' });
    expect((await diagnose({ env: env(port, makeDb()) })).state).toBe('HEALTHY');
  });
  it('reports DATABASE_UNAVAILABLE for a missing, unopenable or corrupt database even when HTTP is up', async () => {
    const port = await serve(url => url === '/api/auth/ok' ? { status: 503 } : { status: 200 });
    expect((await diagnose({ env: env(port, join(dir, 'absent.sqlite')) })).state).toBe('DATABASE_UNAVAILABLE');
    const corrupt = join(dir, 'corrupt.sqlite'); writeFileSync(corrupt, 'not a database '.repeat(500));
    expect((await diagnose({ env: env(port, corrupt) })).state).toBe('DATABASE_UNAVAILABLE');
    const okPort = await serve(url => url === '/api/auth/ok' ? { status: 200 } : { status: 200 });
    expect((await diagnose({ env: env(okPort, corrupt) })).state).toBe('DATABASE_UNAVAILABLE');
  });
  it('reports CONFIG_INVALID for missing secret, bad origin or a non-loopback target, without echoing values', async () => {
    const port = await serve(url => url === '/api/auth/ok' ? { status: 503 } : { status: 200 });
    const db = makeDb();
    for (const patch of [{ AUTH_SECRET: 'short-secret-value' }, { AUTH_ORIGIN: 'http://hub.example.ts.net' }, { AUTH_ORIGIN: '' }, { HOST: '0.0.0.0' }]) {
      const result = await diagnose({ env: env(port, db, patch) });
      expect(result.state).toBe('CONFIG_INVALID');
      expect(JSON.stringify(result)).not.toContain('short-secret-value');
      expect(JSON.stringify(result)).not.toContain('0.0.0.0');
    }
    expect(requests.some(r => r.headers.host?.startsWith('0.0.0.0'))).toBe(false);
  });
  it('reports RUNTIME_UNAVAILABLE when identity fails although config and database look valid', async () => {
    const port = await serve(url => url === '/api/auth/ok' ? { status: 503 } : { status: 200 });
    expect((await diagnose({ env: env(port, makeDb()) })).state).toBe('RUNTIME_UNAVAILABLE');
  });
  it('recovers: the state follows the service from failure back to healthy', async () => {
    let identity = 503;
    const port = await serve(url => url === '/api/auth/ok' ? { status: identity } : { status: 200 });
    const config = env(port, makeDb());
    expect((await diagnose({ env: config })).state).toBe('RUNTIME_UNAVAILABLE');
    identity = 200;
    expect((await diagnose({ env: config })).state).toBe('HEALTHY');
  });
  it('probes the private HTTPS origin only on request and says what that proves', async () => {
    const port = await serve(url => url === '/api/auth/ok' ? { status: 200 } : { status: 200 });
    const calls: string[] = [];
    const ok = await diagnose({ env: env(port, makeDb()), probeHttps: true, fetchImpl: async (input) => { calls.push(String(input)); return String(input).startsWith(origin) ? new Response('{"ok":true}', { status: 200 }) : fetch(input); } });
    expect(ok.state).toBe('HEALTHY');
    expect(calls.filter(c => c.startsWith(origin))).toEqual([`${origin}/api/auth/ok`]);
    expect(calls.filter(c => !c.startsWith(origin)).every(c => c.startsWith('http://127.0.0.1:'))).toBe(true);
    expect(ok.details.join(' ')).toMatch(/does not prove other devices/);
    const bad = await diagnose({ env: env(port, makeDb()), probeHttps: true, fetchImpl: async (input) => { if (String(input).startsWith(origin)) throw new Error('boom'); return fetch(input); } });
    expect(bad.state).toBe('HTTPS_PROBE_FAILED');
    const none = await diagnose({ env: env(port, makeDb()), fetchImpl: async (input) => { calls.push(String(input)); return fetch(input); } });
    expect(none.state).toBe('HEALTHY');
    expect(calls.filter(c => c.startsWith(origin))).toHaveLength(1);
  });
});

describe('safety of the diagnostic', () => {
  it('only issues unauthenticated GET requests to two public paths and sends no credentials', async () => {
    const port = await serve(url => url === '/api/auth/ok' ? { status: 200 } : { status: 200 });
    await diagnose({ env: env(port, makeDb()) });
    expect(requests.map(r => `${r.method} ${r.url}`).sort()).toEqual(['GET /', 'GET /api/auth/ok']);
    for (const r of requests) { expect(r.headers.cookie).toBeUndefined(); expect(r.headers.authorization).toBeUndefined(); }
  });
  it('never reports the secret, database path, or stack-like text', async () => {
    const db = makeDb('very-private-name.sqlite');
    for (const state of [{ ok: 200 }, { ok: 503 }]) {
      const port = await serve(url => url === '/api/auth/ok' ? { status: state.ok, body: 'Error: at /Users/x/app.js:1' } : { status: 200 });
      const text = JSON.stringify(await diagnose({ env: env(port, db) }));
      for (const forbidden of [SECRET, 'very-private-name', dir, 'Error:', '/Users/']) expect(text).not.toContain(forbidden);
    }
  });
  it('does not modify the database', async () => {
    const db = makeDb(); chmodSync(db, 0o600);
    const port = await serve(() => ({ status: 200 }));
    await diagnose({ env: env(port, db) });
    const conn = new Database(db, { readonly: true });
    expect(conn.prepare('SELECT count(*) AS c FROM user').get()).toEqual({ c: 1 });
    conn.close();
  });
});

describe('command line', () => {
  it('exits 0 and prints the state when healthy; non-zero with a distinct code otherwise', async () => {
    const port = await serve(() => ({ status: 200 }));
    const cfg = join(dir, 'hub.conf');
    writeFileSync(cfg, `AUTH_SECRET=${SECRET}\nDATABASE_PATH=${makeDb()}\nAUTH_ORIGIN=${origin}\nPORT=${port}\n`, { mode: 0o600 });
    // Async on purpose: the fake server lives in this process and must keep serving.
    const run = (args: string[]) => execFileAsync(resolve('node_modules/.bin/tsx'), [resolve('scripts/pilot/health.ts'), ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } })
      .then(r => ({ ...r, status: 0 }), (e: { stdout: string; stderr: string; code: number }) => ({ stdout: e.stdout, stderr: e.stderr, status: e.code }));
    const healthy = await run(['--config-file', cfg]);
    expect(healthy.stdout).toContain('HEALTHY');
    expect(healthy.status).toBe(0);
    expect(healthy.stdout + healthy.stderr).not.toContain(SECRET);
    writeFileSync(cfg, `AUTH_SECRET=${SECRET}\nDATABASE_PATH=${join(dir, 'x.sqlite')}\nAUTH_ORIGIN=${origin}\nPORT=${await freePort()}\n`, { mode: 0o600 });
    const down = await run(['--config-file', cfg]);
    expect(down.stdout).toContain('NOT_LISTENING');
    expect(down.status).toBe(EXIT_CODES.NOT_LISTENING);
  });
});
