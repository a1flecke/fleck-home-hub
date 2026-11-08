import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runPreflight, formatReport, exitCode, platformKey, lockHasPlatform, validateOrigin, parseListeners } from '../../scripts/pilot/preflight.mjs';
import { readIdentityConfig } from '../../src/lib/server/config';

const SECRET = 'synthetic-preflight-secret-value-0123456789-SENTINEL';
let dir = '';
let repo = '';
const lock = (platform: string) => ['node', 'pnpm'].map(t => `[tools.${t}."platforms.${platform}"]\nchecksum = "x"`).join('\n');

function context(overrides: Record<string, unknown> = {}) {
  return {
    platform: 'darwin', arch: 'arm64', uid: process.getuid?.() ?? 501, repoRoot: repo, env: {} as Record<string, string>,
    home: dir, exec: () => ({ status: 1, stdout: '' }), lockText: lock('macos-arm64'), pinned: { node: '24.13.1', pnpm: '12.16.1' },
    ...overrides
  };
}
function write(path: string, text: string, mode = 0o600) { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, text, { mode }); chmodSync(path, mode); }
function validEnvFile(extra = '') {
  const file = join(dir, 'private', 'hub.conf');
  mkdirSync(join(dir, 'private'), { recursive: true, mode: 0o700 }); chmodSync(join(dir, 'private'), 0o700);
  write(file, `AUTH_SECRET=${SECRET}\nDATABASE_PATH=${join(dir, 'private', 'hub.sqlite')}\nAUTH_ORIGIN=https://hub.example.ts.net\n${extra}`);
  return file;
}
function snapshot(root: string): string[] {
  return readdirSync(root, { recursive: true }).map(String).sort().map(name => { const stat = statSync(join(root, name)); return `${name} ${stat.mtimeMs} ${stat.mode & 0o777}`; });
}
const find = (checks: { id: string; status: string; message: string }[], id: string) => checks.find(c => c.id === id)!;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hub-preflight-'));
  repo = join(dir, 'repo'); mkdirSync(join(repo, 'node_modules'), { recursive: true }); mkdirSync(join(repo, 'build'), { recursive: true });
  write(join(repo, 'build', 'adapter-node.js'), 'export const origin = "https://hub.example.ts.net";\n');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('host detection', () => {
  it('maps platforms and reads locked binaries', () => {
    expect(platformKey('darwin', 'arm64')).toBe('macos-arm64');
    expect(platformKey('darwin', 'x64')).toBe('macos-x64');
    expect(lockHasPlatform(lock('macos-arm64'), ['node', 'pnpm'], 'macos-arm64')).toEqual([]);
    expect(lockHasPlatform(lock('macos-arm64'), ['node', 'pnpm'], 'macos-x64')).toEqual(['node', 'pnpm']);
  });
  it('passes Apple silicon and fails Intel macOS because the lock has no macos-x64 entries', () => {
    expect(find(runPreflight(context()), 'host').status).toBe('PASS');
    const intel = find(runPreflight(context({ arch: 'x64' })), 'host');
    expect(intel.status).toBe('FAIL');
    expect(intel.message).toContain('macos-x64');
  });
  it('does not claim a non-macOS host is a deployment target', () => {
    expect(find(runPreflight(context({ platform: 'linux', arch: 'x64', lockText: lock('linux-x64') })), 'host').status).toBe('WARN');
  });
});

describe('configuration', () => {
  it('passes a private, complete configuration without printing the secret', () => {
    const checks = runPreflight(context({ envFile: validEnvFile() }));
    expect(find(checks, 'env-file').status).toBe('PASS');
    expect(find(checks, 'config').status).toBe('PASS');
    expect(find(checks, 'origin').status).toBe('WARN');
    expect(find(checks, 'bind').status).toBe('PASS');
    expect(find(checks, 'build-origin').status).toBe('PASS');
    expect(formatReport(checks)).not.toContain(SECRET);
    expect(JSON.stringify(checks)).not.toContain(SECRET);
  });
  it('fails a configuration file readable by others', () => {
    const file = validEnvFile(); chmodSync(file, 0o644);
    const check = find(runPreflight(context({ envFile: file })), 'env-file');
    expect(check.status).toBe('FAIL');
    expect(check.message).not.toContain(SECRET);
  });
  it('fails a missing configuration file and missing keys without leaking values', () => {
    expect(find(runPreflight(context({ envFile: join(dir, 'absent.conf') })), 'env-file').status).toBe('FAIL');
    const file = join(dir, 'p', 'x.conf'); write(file, `AUTH_SECRET=${SECRET}\n`);
    const checks = runPreflight(context({ envFile: file }));
    expect(find(checks, 'config').status).toBe('FAIL');
    expect(formatReport(checks)).not.toContain(SECRET);
  });
  it('rejects unknown keys and short secrets in the file', () => {
    const file = join(dir, 'p', 'y.conf'); write(file, 'AUTH_SECRET=short\nDATABASE_PATH=/x/y.sqlite\nAUTH_ORIGIN=https://h.example.ts.net\nOTHER=1\n');
    const config = find(runPreflight(context({ envFile: file })), 'config');
    expect(config.status).toBe('FAIL');
    expect(config.message).not.toContain('short');
  });
  it('reads process environment when no file is given', () => {
    const env = { AUTH_SECRET: SECRET, DATABASE_PATH: join(dir, 'private', 'a.sqlite'), AUTH_ORIGIN: 'http://127.0.0.1:3000' };
    mkdirSync(join(dir, 'private'), { mode: 0o700 });
    const checks = runPreflight(context({ env }));
    expect(find(checks, 'config').status).toBe('PASS');
    expect(find(checks, 'origin').status).toBe('WARN');
    expect(formatReport(checks)).not.toContain(SECRET);
  });
});

describe('origin and bind safety', () => {
  const cases: [string | undefined, boolean][] = [
    ['https://hub.example.ts.net', true], ['http://127.0.0.1:3000', true], ['http://localhost:3000', true], ['http://[::1]:3000', true],
    ['http://hub.example.ts.net', false], ['https://hub.example.ts.net/path', false], ['https://u:p@hub.example.ts.net', false],
    ['https://hub.example.ts.net/?q=1', false], ['https://hub.example.ts.net/#x', false], ['not a url', false], ['', false], [undefined, false]
  ];
  it.each(cases)('matches the application origin rules for %s', (origin, ok) => {
    const app = (() => { try { readIdentityConfig({ AUTH_SECRET: 'x'.repeat(32), DATABASE_PATH: '/a', AUTH_ORIGIN: origin }); return true; } catch { return false; } })();
    expect(app).toBe(ok);
    expect(validateOrigin(origin).ok).toBe(ok);
  });
  it('fails a non-loopback HOST', () => {
    for (const host of ['0.0.0.0', '::', '192.168.1.5', 'hub.local']) {
      expect(find(runPreflight(context({ envFile: validEnvFile(`HOST=${host}\n`) })), 'bind').status).toBe('FAIL');
      rmSync(join(dir, 'private'), { recursive: true, force: true });
    }
  });
  it('accepts loopback HOST and rejects bad ports', () => {
    expect(find(runPreflight(context({ envFile: validEnvFile('HOST=127.0.0.1\nPORT=3000\n') })), 'bind').status).toBe('PASS');
    rmSync(join(dir, 'private'), { recursive: true, force: true });
    expect(find(runPreflight(context({ envFile: validEnvFile('PORT=99999\n') })), 'bind').status).toBe('FAIL');
  });
  it('fails a build whose origin differs from AUTH_ORIGIN', () => {
    write(join(repo, 'build', 'adapter-node.js'), 'export const origin = "https://other.example.ts.net";\n');
    expect(find(runPreflight(context({ envFile: validEnvFile() })), 'build-origin').status).toBe('FAIL');
  });
  it('parses lsof output and flags wildcard listeners', () => {
    expect(parseListeners('p1\nn127.0.0.1:3000\nn[::1]:3000\n').exposed).toEqual([]);
    expect(parseListeners('p1\nn*:3000\n').exposed).toEqual(['*:3000']);
    expect(parseListeners('n192.168.1.4:3000\n').exposed).toEqual(['192.168.1.4:3000']);
  });
  it('fails when the configured port has a non-loopback listener, passes when idle, unknown when lsof is unavailable', () => {
    const file = validEnvFile();
    expect(find(runPreflight(context({ envFile: file, exec: (c: string) => c === 'lsof' ? { status: 0, stdout: 'p9\nn*:3000\n' } : { status: 1, stdout: '' } })), 'listener').status).toBe('FAIL');
    expect(find(runPreflight(context({ envFile: file, exec: () => ({ status: 1, stdout: '' }) })), 'listener').status).toBe('PASS');
    expect(find(runPreflight(context({ envFile: file, exec: () => null })), 'listener').status).toBe('UNKNOWN');
  });
});

describe('database, build and toolchain', () => {
  it('fails when dependencies or the build are missing', () => {
    rmSync(join(repo, 'node_modules'), { recursive: true }); rmSync(join(repo, 'build'), { recursive: true });
    const checks = runPreflight(context({ envFile: validEnvFile() }));
    expect(find(checks, 'dependencies').status).toBe('FAIL');
    expect(find(checks, 'build').status).toBe('FAIL');
  });
  it('requires a database path outside the repository, absolute and in a private directory', () => {
    const inside = join(dir, 'private2.conf');
    write(inside, `AUTH_SECRET=${SECRET}\nDATABASE_PATH=${join(repo, 'data.sqlite')}\nAUTH_ORIGIN=https://h.example.ts.net\n`);
    expect(find(runPreflight(context({ envFile: inside })), 'database').status).toBe('FAIL');
    write(inside, `AUTH_SECRET=${SECRET}\nDATABASE_PATH=relative.sqlite\nAUTH_ORIGIN=https://h.example.ts.net\n`);
    expect(find(runPreflight(context({ envFile: inside })), 'database').status).toBe('FAIL');
    write(inside, `AUTH_SECRET=${SECRET}\nDATABASE_PATH=${join(dir, '..', 'x', 'y.sqlite')}\nAUTH_ORIGIN=https://h.example.ts.net\n`);
    expect(find(runPreflight(context({ envFile: inside })), 'database').status).toBe('FAIL');
  });
  it('fails a group-readable database directory and an existing database with loose mode', () => {
    const file = validEnvFile(); chmodSync(join(dir, 'private'), 0o755);
    expect(find(runPreflight(context({ envFile: file })), 'database').status).toBe('FAIL');
    chmodSync(join(dir, 'private'), 0o700);
    write(join(dir, 'private', 'hub.sqlite'), '', 0o644);
    expect(find(runPreflight(context({ envFile: file })), 'database').status).toBe('FAIL');
    chmodSync(join(dir, 'private', 'hub.sqlite'), 0o600);
    expect(find(runPreflight(context({ envFile: file })), 'database').status).toBe('PASS');
  });
  it('warns that a database not yet created needs bootstrap', () => {
    expect(find(runPreflight(context({ envFile: validEnvFile() })), 'database').status).toBe('WARN');
  });
  it('checks mise-managed binaries', () => {
    const present = runPreflight(context({ envFile: validEnvFile(), exec: (c: string) => c === 'mise' ? { status: 0, stdout: `${repo}\n` } : { status: 1, stdout: '' } }));
    expect(find(present, 'toolchain').status).toBe('PASS');
    const missing = runPreflight(context({ envFile: validEnvFile(), exec: () => null }));
    expect(find(missing, 'toolchain').status).toBe('FAIL');
  });
});

describe('tailscale, launchd, backup and disk', () => {
  it('never treats Tailscale presence as verified access', () => {
    const found = find(runPreflight(context({ envFile: validEnvFile(), exec: (c: string) => c === 'which' ? { status: 0, stdout: '/usr/local/bin/tailscale\n' } : { status: 1, stdout: '' } })), 'tailscale');
    expect(found.status).toBe('WARN');
    expect(found.message).toMatch(/does not (verify|establish)/);
    expect(find(runPreflight(context({ envFile: validEnvFile() })), 'tailscale').status).toBe('WARN');
  });
  it('reports launchd context honestly without running launchctl', () => {
    const calls: string[] = [];
    const checks = runPreflight(context({ envFile: validEnvFile(), exec: (c: string) => { calls.push(c); return { status: 1, stdout: '' }; } }));
    expect(calls).not.toContain('launchctl');
    expect(find(checks, 'launchd').status).toBe('UNKNOWN');
    expect(find(runPreflight(context({ uid: 0 })), 'service-user').status).toBe('WARN');
  });
  it('validates the backup destination', () => {
    const file = validEnvFile();
    const good = join(dir, 'backups'); mkdirSync(good, { mode: 0o700 }); chmodSync(good, 0o700);
    expect(find(runPreflight(context({ envFile: file, backupDir: good })), 'backup').status).toBe('WARN');
    expect(find(runPreflight(context({ envFile: file, backupDir: 'relative' })), 'backup').status).toBe('FAIL');
    expect(find(runPreflight(context({ envFile: file, backupDir: join(repo, 'b') })), 'backup').status).toBe('FAIL');
    expect(find(runPreflight(context({ envFile: file, backupDir: join(dir, 'missing') })), 'backup').status).toBe('FAIL');
    chmodSync(good, 0o755);
    expect(find(runPreflight(context({ envFile: file, backupDir: good })), 'backup').status).toBe('FAIL');
    expect(find(runPreflight(context({ envFile: file })), 'backup').status).toBe('WARN');
  });
  it('reports free disk space', () => {
    expect(['PASS', 'WARN']).toContain(find(runPreflight(context({ envFile: validEnvFile() })), 'disk').status);
  });
});

describe('reporting and the command line', () => {
  it('derives the exit code from FAIL, and from WARN/UNKNOWN only when strict', () => {
    expect(exitCode([{ id: 'a', status: 'PASS', message: '' }])).toBe(0);
    expect(exitCode([{ id: 'a', status: 'WARN', message: '' }])).toBe(0);
    expect(exitCode([{ id: 'a', status: 'WARN', message: '' }], true)).toBe(2);
    expect(exitCode([{ id: 'a', status: 'UNKNOWN', message: '' }], true)).toBe(2);
    expect(exitCode([{ id: 'a', status: 'FAIL', message: '' }])).toBe(1);
  });
  it('is read-only: the command line creates and changes nothing in the fixture', () => {
    const file = validEnvFile();
    const before = snapshot(dir);
    // PATH deliberately excludes mise: mise itself may write its own state directory.
    const result = spawnSync(process.execPath, [resolve('scripts/pilot/preflight.mjs'), '--config-file', file], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: dir } });
    const after = snapshot(dir);
    expect([0, 1]).toContain(result.status);
    expect(result.stdout).toMatch(/\[(PASS|WARN|FAIL|UNKNOWN)\]/);
    expect(result.stdout + result.stderr).not.toContain(SECRET);
    expect(after).toEqual(before);
  });
  it('rejects unknown arguments', () => {
    const result = spawnSync(process.execPath, [resolve('scripts/pilot/preflight.mjs'), '--bogus'], { encoding: 'utf8' });
    expect(result.status).toBe(64);
  });
});
