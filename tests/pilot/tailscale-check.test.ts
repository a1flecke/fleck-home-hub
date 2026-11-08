import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { evaluateServe, evaluateStatus } from '../../scripts/pilot/tailscale-check.mjs';

// Synthetic documents shaped like Tailscale's ServeConfig / status JSON. The shape
// is NOT documented on the Serve CLI page, so these only exercise the parser; the
// operator must compare against the output of their installed version.
const origin = 'https://hub.tail1234.ts.net';
const good = { TCP: { '443': { HTTPS: true } }, Web: { 'hub.tail1234.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:3000' } } } } };
const find = (checks: { id: string; status: string }[], id: string) => checks.find(c => c.id === id);

describe('serve configuration', () => {
  it('passes the intended private route and still demands manual validation of access', () => {
    const checks = evaluateServe(good, origin, 3000);
    expect(find(checks, 'funnel')?.status).toBe('PASS');
    expect(find(checks, 'route')?.status).toBe('PASS');
    expect(checks.some(c => c.status === 'WARN' && /ACL|manual/i.test(JSON.stringify(c)))).toBe(true);
    expect(checks.some(c => c.status === 'FAIL')).toBe(false);
  });
  it('fails when Funnel is enabled for any host', () => {
    expect(find(evaluateServe({ ...good, AllowFunnel: { 'hub.tail1234.ts.net:443': true } }, origin, 3000), 'funnel')?.status).toBe('FAIL');
  });
  it('fails a proxy target that is not the loopback port, and a host that differs from AUTH_ORIGIN', () => {
    const wrongTarget = { ...good, Web: { 'hub.tail1234.ts.net:443': { Handlers: { '/': { Proxy: 'http://192.168.1.9:3000' } } } } };
    expect(find(evaluateServe(wrongTarget, origin, 3000), 'route')?.status).toBe('FAIL');
    const wrongPort = { ...good, Web: { 'hub.tail1234.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:4000' } } } } };
    expect(find(evaluateServe(wrongPort, origin, 3000), 'route')?.status).toBe('FAIL');
    expect(find(evaluateServe(good, 'https://other.tail1234.ts.net', 3000), 'route')?.status).toBe('FAIL');
  });
  it('warns, without claiming failure, when nothing is configured or other routes exist', () => {
    expect(find(evaluateServe({}, origin, 3000), 'route')?.status).toBe('WARN');
    const extra = { ...good, Web: { ...good.Web, 'other.tail1234.ts.net:8443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:9000' } } } } };
    const checks = evaluateServe(extra, origin, 3000);
    expect(find(checks, 'other-routes')?.status).toBe('WARN');
    expect(find(checks, 'route')?.status).toBe('PASS');
  });
  it('warns about TCP forwarding and static handlers it does not expect', () => {
    expect(find(evaluateServe({ ...good, TCP: { '22': { TCPForward: '127.0.0.1:22' } } }, origin, 3000), 'tcp')?.status).toBe('WARN');
  });
  it('fails closed on a non-object document', () => {
    expect(find(evaluateServe(null, origin, 3000), 'serve-json')?.status).toBe('FAIL');
  });
});

describe('status document', () => {
  it('requires a running backend and a matching DNS name, and never claims ACLs are verified', () => {
    const checks = evaluateStatus({ BackendState: 'Running', Self: { DNSName: 'hub.tail1234.ts.net.' } }, origin);
    expect(find(checks, 'backend')?.status).toBe('PASS');
    expect(find(checks, 'dns-name')?.status).toBe('PASS');
    expect(find(checks, 'acl')?.status).toBe('UNKNOWN');
    expect(find(evaluateStatus({ BackendState: 'Stopped', Self: { DNSName: 'hub.tail1234.ts.net.' } }, origin), 'backend')?.status).toBe('FAIL');
    expect(find(evaluateStatus({ BackendState: 'Running', Self: { DNSName: 'someone-else.ts.net.' } }, origin), 'dns-name')?.status).toBe('FAIL');
  });
});

describe('command line', () => {
  it('reads supplied JSON files, never invokes tailscale without --run, and exits 1 on FAIL', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hub-ts-'));
    try {
      const file = join(dir, 'serve.json'); writeFileSync(file, JSON.stringify({ ...good, AllowFunnel: { 'hub.tail1234.ts.net:443': true } }));
      const bad = spawnSync(process.execPath, [resolve('scripts/pilot/tailscale-check.mjs'), '--serve-json', file, '--origin', origin, '--port', '3000'], { encoding: 'utf8', env: { PATH: '/nonexistent' } });
      expect(bad.status).toBe(1);
      expect(bad.stdout).toContain('[FAIL] funnel');
      writeFileSync(file, JSON.stringify(good));
      const ok = spawnSync(process.execPath, [resolve('scripts/pilot/tailscale-check.mjs'), '--serve-json', file, '--origin', origin], { encoding: 'utf8', env: { PATH: '/nonexistent' } });
      expect(ok.status).toBe(0);
      expect(spawnSync(process.execPath, [resolve('scripts/pilot/tailscale-check.mjs')], { encoding: 'utf8' }).status).toBe(64);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
