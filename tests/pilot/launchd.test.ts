import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { renderPlist, validateOptions, planInstall, runCommand, DEFAULT_LABEL } from '../../scripts/pilot/launchd.mjs';
import { parseEnvFile } from '../../scripts/pilot/envfile.mjs';

const SECRET = 'synthetic-launchd-secret-value-0123456789-SENTINEL';
let dir = '';
let repo = '';
const opts = () => ({ repoRoot: repo, envFile: join(dir, 'cfg', 'hub.conf'), miseBin: join(dir, 'bin', 'mise'), logDir: join(dir, 'logs'), label: DEFAULT_LABEL, home: dir, uid: 501 });
function snapshot(root: string): string[] {
  return readdirSync(root, { recursive: true }).map(String).sort().map(name => `${name} ${statSync(join(root, name)).mode & 0o777}`);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hub-launchd-'));
  repo = join(dir, 'repo'); mkdirSync(join(repo, 'scripts', 'pilot'), { recursive: true });
  mkdirSync(join(dir, 'cfg'), { mode: 0o700 }); mkdirSync(join(dir, 'bin'));
  writeFileSync(join(dir, 'cfg', 'hub.conf'), `AUTH_SECRET=${SECRET}\n`, { mode: 0o600 });
  writeFileSync(join(dir, 'bin', 'mise'), '#!/bin/sh\n', { mode: 0o755 });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('plist generation', () => {
  it('renders a loopback-safe LaunchAgent with restart-on-failure and no credentials', () => {
    const plist = renderPlist(opts());
    expect(plist).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(plist).toContain(`<key>Label</key>\n  <string>${DEFAULT_LABEL}</string>`);
    expect(plist).toContain('<key>RunAtLoad</key>\n  <true/>');
    expect(plist).toMatch(/<key>KeepAlive<\/key>\s*<dict>\s*<key>SuccessfulExit<\/key>\s*<false\/>\s*<\/dict>/);
    expect(plist).toContain('<key>ThrottleInterval</key>');
    expect(plist).toContain(`<string>${repo}/scripts/pilot/launch.sh</string>`);
    expect(plist).toContain(`<key>WorkingDirectory</key>\n  <string>${repo}</string>`);
    expect(plist).toContain(`${dir}/logs/stdout.log`);
    expect(plist).toContain('<key>Umask</key>\n  <integer>63</integer>');
    for (const word of ['AUTH_SECRET', 'AUTH_ORIGIN', 'DATABASE_PATH', 'HOST', 'PORT', SECRET, 'Sockets', 'KeepAlive</key>\n  <true/>']) expect(plist).not.toContain(word);
    expect(plist).toContain('HUB_ENV_FILE');
  });
  it('has exactly one launcher argument and no secrets in arguments', () => {
    const plist = renderPlist(opts());
    const args = plist.match(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/)![1];
    expect([...args.matchAll(/<string>/g)]).toHaveLength(1);
  });
  it('is well formed XML with balanced tags', () => {
    const plist = renderPlist(opts());
    const stack: string[] = [];
    for (const [, close, name, self] of plist.matchAll(/<(\/?)([a-zA-Z]+)[^>]*?(\/?)>/g)) {
      if (self) continue;
      if (close) expect(stack.pop()).toBe(name); else stack.push(name);
    }
    expect(stack).toEqual([]);
  });
  it('escapes XML metacharacters in paths', () => {
    const plist = renderPlist({ ...opts(), logDir: join(dir, 'a&b<c>') });
    expect(plist).toContain('a&amp;b&lt;c&gt;');
    expect(plist).not.toContain('a&b<c>');
  });
  it('is deterministic', () => { expect(renderPlist(opts())).toBe(renderPlist(opts())); });
});

describe('option validation', () => {
  it('accepts valid options', () => { expect(validateOptions(opts())).toEqual([]); });
  it.each([
    ['relative repo', { repoRoot: 'repo' }], ['relative env file', { envFile: 'hub.conf' }], ['dotdot in env file', { envFile: '/a/../b' }],
    ['newline in path', { logDir: '/tmp/x\ny' }], ['env file inside repo', { envFile: '__REPO__/hub.conf' }],
    ['log dir inside repo', { logDir: '__REPO__/logs' }], ['relative mise', { miseBin: 'mise' }],
    ['bad label', { label: 'bad label/../x' }], ['empty label', { label: '' }]
  ])('rejects %s', (_name, patch) => {
    const patched = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, String(v).replace('__REPO__', repo)]));
    expect(validateOptions({ ...opts(), ...patched }).length).toBeGreaterThan(0);
    expect(() => renderPlist({ ...opts(), ...patched })).toThrow();
  });
});

describe('opt-in install planning (no launchctl in tests)', () => {
  it('previews by default: prints the plan and runs nothing', () => {
    const calls: string[][] = [];
    const before = snapshot(dir);
    const plan = planInstall(opts());
    expect(plan.plistPath).toBe(join(dir, 'Library', 'LaunchAgents', `${DEFAULT_LABEL}.plist`));
    expect(plan.commands).toEqual([['launchctl', 'bootstrap', 'gui/501', plan.plistPath]]);
    expect(calls).toEqual([]);
    expect(snapshot(dir)).toEqual(before);
  });
  it('--apply requires a private env file, refuses to overwrite, writes 0600 and calls only the injected runner', () => {
    const calls: string[][] = [];
    const run = (command: string, args: string[]) => { calls.push([command, ...args]); return { status: 0, stdout: '' }; };
    const out = runCommand('install', opts(), { apply: true, run });
    expect(out.code).toBe(0);
    const plist = join(dir, 'Library', 'LaunchAgents', `${DEFAULT_LABEL}.plist`);
    expect(statSync(plist).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, 'logs')).mode & 0o777).toBe(0o700);
    expect(calls).toEqual([['launchctl', 'bootstrap', 'gui/501', plist]]);
    expect(readFileSync(plist, 'utf8')).not.toContain(SECRET);
    const again = runCommand('install', opts(), { apply: true, run });
    expect(again.code).not.toBe(0);
    expect(calls).toHaveLength(1);
  });
  it('--apply refuses a missing or group-readable env file, a missing mise, and a symlinked env file', () => {
    const run = () => { throw new Error('must not run'); };
    chmodSync(join(dir, 'cfg', 'hub.conf'), 0o644);
    expect(runCommand('install', opts(), { apply: true, run }).code).not.toBe(0);
    chmodSync(join(dir, 'cfg', 'hub.conf'), 0o600);
    symlinkSync(join(dir, 'cfg', 'hub.conf'), join(dir, 'cfg', 'link.conf'));
    expect(runCommand('install', { ...opts(), envFile: join(dir, 'cfg', 'link.conf') }, { apply: true, run }).code).not.toBe(0);
    rmSync(join(dir, 'bin', 'mise'));
    expect(runCommand('install', opts(), { apply: true, run }).code).not.toBe(0);
    expect(existsSync(join(dir, 'Library'))).toBe(false);
  });
  it('uninstall, restart and status print commands unless applied', () => {
    const run = () => { throw new Error('must not run'); };
    const target = `gui/501/${DEFAULT_LABEL}`;
    expect(runCommand('uninstall', opts(), { apply: false, run }).output).toContain(`launchctl bootout ${target}`);
    expect(runCommand('restart', opts(), { apply: false, run }).output).toContain(`launchctl kickstart -k ${target}`);
    expect(runCommand('status', opts(), { apply: false, run }).output).toContain(`launchctl print ${target}`);
  });
  it('uninstall --apply boots out then removes only our plist, and reports failure honestly', () => {
    runCommand('install', opts(), { apply: true, run: () => ({ status: 0, stdout: '' }) });
    const calls: string[][] = [];
    const plist = join(dir, 'Library', 'LaunchAgents', `${DEFAULT_LABEL}.plist`);
    const failing = runCommand('uninstall', opts(), { apply: true, run: (c: string, a: string[]) => { calls.push([c, ...a]); return { status: 5, stdout: '' }; } });
    expect(failing.code).not.toBe(0);
    expect(existsSync(plist)).toBe(true);
    const ok = runCommand('uninstall', opts(), { apply: true, run: () => ({ status: 0, stdout: '' }) });
    expect(ok.code).toBe(0);
    expect(existsSync(plist)).toBe(false);
    expect(calls[0]).toEqual(['launchctl', 'bootout', `gui/501/${DEFAULT_LABEL}`]);
  });
  it('rejects unknown commands', () => { expect(runCommand('explode', opts(), { apply: true, run: () => ({ status: 0, stdout: '' }) }).code).toBe(64); });
});

describe('command line', () => {
  it('previews by default and creates nothing', () => {
    const before = snapshot(dir);
    const result = spawnSync(process.execPath, [resolve('scripts/pilot/launchd.mjs'), 'preview', '--repo', repo, '--config-file', join(dir, 'cfg', 'hub.conf'), '--mise', join(dir, 'bin', 'mise'), '--log-dir', join(dir, 'logs')], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: dir } });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('<plist');
    expect(result.stdout).not.toContain(SECRET);
    expect(snapshot(dir)).toEqual(before);
  });
  it('treats install without --apply as a preview', () => {
    const before = snapshot(dir);
    const result = spawnSync(process.execPath, [resolve('scripts/pilot/launchd.mjs'), 'install', '--repo', repo, '--config-file', join(dir, 'cfg', 'hub.conf'), '--mise', join(dir, 'bin', 'mise'), '--log-dir', join(dir, 'logs')], { encoding: 'utf8', env: { PATH: '/nonexistent', HOME: dir } });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Dry run');
    expect(snapshot(dir)).toEqual(before);
  });
});

// The launcher: run the real shell script against a stub "mise" that records what it was given.
describe('launcher (launch.sh)', () => {
  let work = '';
  function setup(conf: string, mode = 0o600, extraEnv: Record<string, string> = {}) {
    work = mkdtempSync(join(tmpdir(), 'hub-launch-'));
    mkdirSync(join(work, 'repo/scripts/pilot'), { recursive: true }); mkdirSync(join(work, 'bin')); mkdirSync(join(work, 'logs'), { mode: 0o700 });
    for (const f of ['scripts/pilot/launch.sh', 'scripts/start.sh']) { writeFileSync(join(work, 'repo', f), readFileSync(resolve(f)), { mode: 0o755 }); }
    writeFileSync(join(work, 'bin/mise'), '#!/bin/sh\nprintf "HOST=%s PORT=%s ORIGIN=%s DB=%s SECRETLEN=%s ARGS=%s PWD=%s\\n" "$HOST" "$PORT" "$AUTH_ORIGIN" "$DATABASE_PATH" "${#AUTH_SECRET}" "$*" "$PWD" > "$STUB_OUT"\n', { mode: 0o755 });
    writeFileSync(join(work, 'hub.conf'), conf, { mode }); chmodSync(join(work, 'hub.conf'), mode);
    const env: Record<string, string> = { PATH: '/usr/bin:/bin', HUB_ENV_FILE: join(work, 'hub.conf'), HUB_MISE: join(work, 'bin/mise'), HUB_LOG_DIR: join(work, 'logs'), STUB_OUT: join(work, 'out'), ...extraEnv };
    return () => spawnSync('/bin/sh', [join(work, 'repo/scripts/pilot/launch.sh')], { cwd: '/', env, encoding: 'utf8' });
  }
  afterEach(() => { if (work) rmSync(work, { recursive: true, force: true }); work = ''; });
  const good = `# comment\nAUTH_SECRET=${SECRET}\nDATABASE_PATH=/private/hub.sqlite\nAUTH_ORIGIN="https://hub.example.ts.net"\n`;

  it('loads the allowlisted configuration literally, defaults to loopback, and runs the pinned mise', () => {
    const result = setup(good)();
    expect(result.status, result.stderr).toBe(0);
    const out = readFileSync(join(work, 'out'), 'utf8');
    expect(out).toContain('HOST=127.0.0.1');
    expect(out).toContain('ORIGIN=https://hub.example.ts.net');
    expect(out).toContain('DB=/private/hub.sqlite');
    expect(out).toContain(`SECRETLEN=${SECRET.length}`);
    expect(out).toContain('ARGS=exec -- node build');
    expect(out).toContain(`PWD=${readFileSync(join(work, 'out'), 'utf8').match(/PWD=(.*)/)![1]}`);
    expect(out).toContain('/repo');
    expect(result.stdout + result.stderr).not.toContain(SECRET);
  });
  it('does not evaluate shell syntax in values', () => {
    const marker = join(tmpdir(), `hub-injection-${process.pid}`);
    const result = setup(`AUTH_SECRET=$(touch ${marker})${SECRET}\nDATABASE_PATH=/\`touch ${marker}\`\nAUTH_ORIGIN=https://h.example.ts.net\n`)();
    expect(result.status).toBe(0);
    expect(existsSync(marker)).toBe(false);
    expect(readFileSync(join(work, 'out'), 'utf8')).toContain('DB=/`touch');
  });
  it('accepts an explicit loopback HOST and PORT', () => {
    setup(good + 'HOST=127.0.0.1\nPORT=3456\n')();
    expect(readFileSync(join(work, 'out'), 'utf8')).toContain('PORT=3456');
  });
  it.each([['HOST=0.0.0.0'], ['HOST=::'], ['HOST=192.168.1.4'], ['HOST=hub.local'], ['PORT=abc'], ['PORT=70000'], ['PORT=0'], ['UNKNOWN_KEY=1'], ['export AUTH_SECRET=x'], ['nonsense'], ['AUTH_SECRET=dup']])('refuses %s with exit 78 and never starts the app', (line) => {
    const result = setup(good + line + '\n')();
    expect(result.status).toBe(78);
    expect(existsSync(join(work, 'out'))).toBe(false);
    expect(result.stderr).not.toContain(SECRET);
  });
  it('refuses a group-readable file, a missing file and a symlink', () => {
    expect(setup(good, 0o644)().status).toBe(78);
    rmSync(work, { recursive: true });
    const run = setup(good); rmSync(join(work, 'hub.conf'));
    expect(run().status).toBe(78);
    rmSync(work, { recursive: true });
    const linked = setup(good); writeFileSync(join(work, 'real.conf'), good, { mode: 0o600 }); rmSync(join(work, 'hub.conf')); symlinkSync(join(work, 'real.conf'), join(work, 'hub.conf'));
    expect(linked().status).toBe(78);
    expect(existsSync(join(work, 'out'))).toBe(false);
  });
  it('refuses missing required settings, a short secret, an invalid origin and a missing mise', () => {
    expect(setup('DATABASE_PATH=/x\nAUTH_ORIGIN=https://h.example.ts.net\n')().status).toBe(78);
    expect(setup(`AUTH_SECRET=short\nDATABASE_PATH=/x\nAUTH_ORIGIN=https://h.example.ts.net\n`)().status).toBe(78);
    expect(setup(`AUTH_SECRET=${SECRET}\nDATABASE_PATH=/x\nAUTH_ORIGIN=http://hub.example.ts.net\n`)().status).toBe(78);
    const run = setup(good); rmSync(join(work, 'bin/mise'));
    expect(run().status).toBe(78);
  });
  it('ignores inherited credentials and non-loopback HOST from the launchd environment', () => {
    const result = setup(good, 0o600, { HOST: '0.0.0.0', AUTH_SECRET: 'inherited' })();
    expect(result.status, result.stderr).toBe(0);
    const out = readFileSync(join(work, 'out'), 'utf8');
    expect(out).toContain('HOST=127.0.0.1');
    expect(out).toContain(`SECRETLEN=${SECRET.length}`);
  });
  it('keeps logs bounded by copy-truncating large files at start', () => {
    const run = setup(good, 0o600, { HUB_LOG_MAX_BYTES: '100' });
    writeFileSync(join(work, 'logs/stdout.log'), 'x'.repeat(500)); writeFileSync(join(work, 'logs/stderr.log'), 'ok');
    expect(run().status).toBe(0);
    expect(statSync(join(work, 'logs/stdout.log')).size).toBe(0);
    expect(statSync(join(work, 'logs/stdout.log.1')).size).toBe(500);
    expect(existsSync(join(work, 'logs/stderr.log.1'))).toBe(false);
  });
});

describe('env parsing parity', () => {
  it('rejects the same inputs as the launcher', () => {
    for (const text of ['HOST_X=1\n', 'export AUTH_SECRET=x\n', 'nonsense\n', 'AUTH_SECRET=a\nAUTH_SECRET=b\n']) expect(parseEnvFile(text).errors.length).toBeGreaterThan(0);
    expect(parseEnvFile('AUTH_ORIGIN="https://h.example.ts.net"\nPORT=\'3000\'\n#c\n\n').values).toEqual({ AUTH_ORIGIN: 'https://h.example.ts.net', PORT: '3000' });
  });
});
