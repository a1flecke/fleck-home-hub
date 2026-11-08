#!/usr/bin/env node
// Read-only evaluation of Tailscale Serve configuration. By default it only
// parses JSON files you supply (output of `tailscale serve status --json` and
// `tailscale status --json`). With --run it executes exactly those two read-only
// commands. It never calls serve/funnel/set-config/reset, never edits ACLs, and
// cannot prove tailnet access control: ACLs and device reachability stay manual.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** @typedef {{ id: string, status: 'PASS' | 'WARN' | 'FAIL' | 'UNKNOWN', message: string }} Check */

/** @param {any} serve @param {string} origin @param {number} port @returns {Check[]} */
export function evaluateServe(serve, origin, port) {
  /** @type {Check[]} */
  const checks = [];
  /** @param {string} id @param {Check['status']} status @param {string} message */
  const add = (id, status, message) => checks.push({ id, status, message });
  if (!serve || typeof serve !== 'object' || Array.isArray(serve)) { add('serve-json', 'FAIL', 'serve status is not a JSON object; cannot evaluate'); return checks; }
  const url = new URL(origin);
  const expectedKey = `${url.hostname}:${url.port || '443'}`;

  const funnel = Object.entries(serve.AllowFunnel ?? {}).filter(([, on]) => on).map(([host]) => host);
  if (funnel.length) add('funnel', 'FAIL', `Funnel is enabled (${funnel.join(', ')}): this exposes services to the public internet. Disable it before any pilot.`);
  else add('funnel', 'PASS', 'no AllowFunnel entry is enabled in the Serve configuration');

  const web = serve.Web && typeof serve.Web === 'object' ? serve.Web : {};
  const entry = web[expectedKey];
  if (!Object.keys(web).length) add('route', 'WARN', 'no Serve web route is configured yet (expected before the manual enable step)');
  else if (!entry) add('route', 'FAIL', `no route for ${expectedKey}; AUTH_ORIGIN and the Serve hostname must match exactly`);
  else {
    const handlers = Object.entries(entry.Handlers ?? {});
    const proxies = handlers.map(([path, handler]) => [path, /** @type {any} */ (handler)?.Proxy]);
    const bad = proxies.filter(([, proxy]) => {
      try { const target = new URL(String(proxy)); return !(['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) && target.protocol === 'http:' && Number(target.port) === port); } catch { return true; }
    });
    if (!handlers.length || bad.length) add('route', 'FAIL', `route ${expectedKey} must proxy only to http://127.0.0.1:${port}; found ${handlers.length ? `${bad.length} other target(s) or non-proxy handler(s)` : 'no handlers'}`);
    else add('route', 'PASS', `${expectedKey} proxies to http://127.0.0.1:${port} only`);
  }
  const others = Object.keys(web).filter(key => key !== expectedKey);
  if (others.length) add('other-routes', 'WARN', `${others.length} other Serve route(s) exist and are not managed by this hub; leave them alone and review them yourself`);
  const forwards = Object.entries(serve.TCP ?? {}).filter(([, value]) => /** @type {any} */ (value)?.TCPForward);
  if (forwards.length) add('tcp', 'WARN', `${forwards.length} raw TCP forward(s) are configured; confirm each is intentional`);
  add('access', 'WARN', 'Tailscale ACLs, sharing and device reachability are not inspected here; verify who can reach this node in the admin console, and that application sign-in is still required');
  return checks;
}

/** @param {any} status @param {string} origin @returns {Check[]} */
export function evaluateStatus(status, origin) {
  /** @type {Check[]} */
  const checks = [];
  const state = status?.BackendState;
  checks.push({ id: 'backend', status: state === 'Running' ? 'PASS' : 'FAIL', message: state === 'Running' ? 'Tailscale backend reports Running' : 'Tailscale backend is not Running; the node is not on the tailnet' });
  const dns = String(status?.Self?.DNSName ?? '').replace(/\.$/, '');
  const host = new URL(origin).hostname;
  checks.push({ id: 'dns-name', status: dns && dns === host ? 'PASS' : 'FAIL', message: dns === host ? 'this node\'s MagicDNS name matches AUTH_ORIGIN' : 'this node\'s MagicDNS name does not match AUTH_ORIGIN' });
  checks.push({ id: 'acl', status: 'UNKNOWN', message: 'access controls cannot be read from this document; review them in the Tailscale admin console' });
  return checks;
}

function main() {
  const args = process.argv.slice(2);
  /** @type {Record<string, string | boolean>} */
  const opt = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--run') opt.run = true;
    else if (['--serve-json', '--status-json', '--origin', '--port'].includes(args[i]) && args[i + 1]) opt[args[i].slice(2)] = args[++i];
    else { opt.bad = true; break; }
  }
  if (opt.bad || !opt.origin || (!opt.run && !opt['serve-json'])) {
    console.error('Usage: tailscale-check.mjs --origin https://HOST.ts.net [--port 3000] (--serve-json FILE [--status-json FILE] | --run)');
    process.exit(64);
  }
  const port = Number(opt.port ?? 3000);
  /** @param {string[]} cmd */
  const run = cmd => { const r = spawnSync('tailscale', cmd, { encoding: 'utf8', timeout: 10000 }); if (r.status !== 0) throw new Error(`tailscale ${cmd.join(' ')} failed`); return r.stdout; };
  /** @type {import('./tailscale-check.mjs').Check[]} */
  let checks = [];
  try {
    const serveText = opt.run ? run(['serve', 'status', '--json']) : readFileSync(String(opt['serve-json']), 'utf8');
    checks = evaluateServe(JSON.parse(serveText || '{}'), String(opt.origin), port);
    const statusText = opt.run ? run(['status', '--json']) : opt['status-json'] ? readFileSync(String(opt['status-json']), 'utf8') : undefined;
    if (statusText) checks.push(...evaluateStatus(JSON.parse(statusText), String(opt.origin)));
  } catch { checks.push({ id: 'input', status: 'FAIL', message: 'could not read or parse the Tailscale JSON' }); }
  process.stdout.write(checks.map(c => `[${c.status}] ${c.id}: ${c.message}`).join('\n') + '\nPASS here is a parsed-configuration check, not proof of private access.\n');
  process.exit(checks.some(c => c.status === 'FAIL') ? 1 : 0);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
