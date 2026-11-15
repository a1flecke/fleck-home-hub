import { afterEach, beforeEach, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupHub, type SetupRunner } from '../../scripts/pilot/setup';
import { parseEnvFile } from '../../scripts/pilot/envfile.mjs';

const host = 'mac.example.ts.net';
const target = 'http://127.0.0.1:31842';
const unrelated = { Handlers: { '/': { Proxy: 'http://127.0.0.1:9999' } } };
let home: string;
let repoRoot: string;
let ready: boolean;
let loaded: boolean;
let failBootstrap: boolean;
let publicRoute: Record<string, boolean>;
let web: Record<string, typeof unrelated>;
let tcp: Record<string, { HTTPS: boolean }>;
let calls: string[][];
let probeHttps: boolean;
let ownsListener: boolean;
let output: string[];

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'hub-setup-'));
  repoRoot = join(home, 'repo');
  mkdirSync(repoRoot);
  writeFileSync(join(home, 'mise'), '', { mode: 0o700 });
  ready = loaded = failBootstrap = false;
  probeHttps = ownsListener = true;
  publicRoute = {};
  web = { [host + ':443']: unrelated };
  tcp = { '443': { HTTPS: true } };
  calls = [];
  output = [];
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const configFile = () => join(home, '.config/fleck-home-hub/hub.conf');
const plist = () => join(home, 'Library/LaunchAgents/local.fleck.home-hub.plist');

function invoke() {
  const run: SetupRunner = (command, args, options) => {
    calls.push([command, ...args]);
    let status = 0;
    let stdout = '';
    if (command === 'tailscale') {
      if (args[0] === 'status') stdout = JSON.stringify({ BackendState: 'Running', Self: { DNSName: host + '.' } });
      else if (args[1] === 'status') stdout = JSON.stringify({ Web: web, TCP: tcp, AllowFunnel: publicRoute });
      else {
        expect(ready).toBe(true);
        expect(args).toEqual(['serve', '--bg', '--https=8443', target]);
        web[host + ':8443'] = { Handlers: { '/': { Proxy: target } } };
        tcp['8443'] = { HTTPS: true };
      }
    } else if (command === 'launchctl') {
      if (args[0] === 'print') {
        status = loaded ? 0 : 113;
        stdout = loaded ? '    pid = 12345\n' : '';
      }
      if (args[0] === 'bootstrap') {
        status = failBootstrap ? 1 : 0;
        loaded = ready = status === 0;
      }
    } else if (command === 'lsof') {
      expect(args).toContain('12345');
      stdout = ownsListener ? 'p12345\nn127.0.0.1:31842\n' : '';
    } else if (args.includes('build')) {
      expect(options?.env?.AUTH_ORIGIN).toBe('https://' + host + ':8443');
      expect(options?.env?.AUTH_SECRET).toBeUndefined();
      mkdirSync(join(repoRoot, 'build'), { recursive: true });
      writeFileSync(join(repoRoot, 'build/adapter-node.js'), 'export const origin = "' + options!.env!.AUTH_ORIGIN + '";');
      writeFileSync(join(repoRoot, 'build/index.js'), '');
    } else if (args.includes('--if-needed')) {
      expect(output).toEqual(['Open https://' + host + ':8443/']);
    }
    return { status, stdout };
  };
  return setupHub({
    home, repoRoot, miseBin: join(home, 'mise'), uid: process.getuid!(),
    run, openPort: async (port) => port === 3000 ? undefined : port || 31842,
    awaitHealth: async (_base, https) => https ? probeHttps : ready,
    print: line => output.push(line)
  });
}

it('uses the available ports and prints the URL before issuing a code', async () => {
  await invoke();
  expect(statSync(configFile()).mode & 0o777).toBe(0o600);
  const { values } = parseEnvFile(readFileSync(configFile(), 'utf8'));
  expect(values.AUTH_SECRET).toMatch(/^[a-f0-9]{64}$/);
  expect(values.AUTH_ORIGIN).toBe('https://' + host + ':8443');
  expect(values.PORT).toBe('31842');
  expect(web[host + ':443']).toEqual(unrelated);
  expect(readFileSync(plist(), 'utf8')).not.toContain(values.AUTH_SECRET);
  expect(calls.flat().join(' ')).not.toContain(values.AUTH_SECRET);
  expect(calls.some(call => call.includes('--prepare'))).toBe(true);
  expect(calls.some(call => call.includes('--if-needed'))).toBe(true);
});

it('resumes after launchd fails without replacing private configuration or the plist', async () => {
  failBootstrap = true;
  await expect(invoke()).rejects.toThrow(/LaunchAgent/);
  expect(output).toEqual([]);
  const savedConfig = readFileSync(configFile(), 'utf8');
  const savedPlist = readFileSync(plist(), 'utf8');
  failBootstrap = false;
  await invoke();
  expect(readFileSync(configFile(), 'utf8')).toBe(savedConfig);
  expect(readFileSync(plist(), 'utf8')).toBe(savedPlist);
  expect(web[host + ':443']).toEqual(unrelated);
  output = [];
  calls = [];
  await invoke();
  expect(calls.some(call => call.includes('build') || call.includes('bootstrap') || call[1] === 'serve' && call[2] === '--bg')).toBe(false);
});

it('withholds the URL and code when HTTPS is unavailable', async () => {
  probeHttps = false;
  await expect(invoke()).rejects.toThrow(/HTTPS/);
  expect(output).toEqual([]);
  expect(calls.some(call => call.includes('--if-needed'))).toBe(false);
});

it('refuses to run if the saved endpoint has been made public', async () => {
  await invoke();
  publicRoute[host + ':8443'] = true;
  calls = [];
  await expect(invoke()).rejects.toThrow(/Serve/);
  expect(calls.some(call => call[0] === 'launchctl' || call[1] === 'serve' && call[2] === '--bg')).toBe(false);
});

it('leaves an existing unrecognized service file alone', async () => {
  mkdirSync(join(home, 'Library/LaunchAgents'), { recursive: true });
  writeFileSync(plist(), 'unrelated service');
  await expect(invoke()).rejects.toThrow(/LaunchAgent/);
  expect(readFileSync(plist(), 'utf8')).toBe('unrelated service');
  expect(existsSync(configFile())).toBe(false);
});

it('does not publish an application listening under a different process', async () => {
  ownsListener = false;
  await expect(invoke()).rejects.toThrow(/not served by the Fleck Home Hub LaunchAgent/);
  expect(web[host + ':8443']).toBeUndefined();
  expect(output).toEqual([]);
});
