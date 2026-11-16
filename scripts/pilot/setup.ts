// First-install orchestration for an Apple-silicon Mac on a tailnet.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { accessSync, closeSync, constants, lstatSync, mkdirSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { isatty } from 'node:tty';
import { fileURLToPath } from 'node:url';
import { readPrivateConfig } from './envfile.mjs';
import { publishPrivateFile } from './private-files.mjs';
import { DEFAULT_LABEL, planInstall, renderPlist, runCommand } from './launchd.mjs';

type CommandOptions = { env?: NodeJS.ProcessEnv; interactive?: boolean };
export type SetupRunner = (command: string, args: string[], options?: CommandOptions) => { status: number | null; stdout: string };
type SetupOptions = {
  home: string;
  repoRoot: string;
  miseBin: string;
  uid: number;
  run: SetupRunner;
  openPort: (port: number) => Promise<number | undefined>;
  awaitHealth: (base: string, https: boolean) => Promise<boolean>;
  print: (line: string) => void;
};
type Serve = {
  TCP?: Record<string, { HTTPS?: boolean; HTTP?: boolean; TCPForward?: string; TerminateTLS?: string }>;
  Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }>;
  AllowFunnel?: Record<string, boolean>;
  Foreground?: Record<string, Serve>;
  Services?: Record<string, Serve>;
};

class SetupError extends Error {}

function statIfPresent(path: string) {
  try { return lstatSync(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

function privateDirectory(path: string, uid: number) {
  mkdirSync(path, { mode: 0o700, recursive: true });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || (stat.mode & 0o077) !== 0 || stat.uid !== uid) {
    throw new SetupError('Fleck Home Hub needs a private, user-owned configuration directory.');
  }
}

function hasEndpoint(serve: Serve, port: string): boolean {
  const entries = [...Object.keys(serve.Web ?? {}), ...Object.keys(serve.AllowFunnel ?? {})];
  return Boolean(serve.TCP?.[port] || entries.some(key => key.endsWith(':' + port)) ||
    Object.values(serve.Foreground ?? {}).some(config => hasEndpoint(config, port)));
}

function forwardedTo(serve: Serve, port: number, exceptEndpoint?: string): boolean {
  const toPort = (target?: string) => Boolean(target && new RegExp('(^|:)' + port + '(/|$)').test(target));
  return Object.values(serve.TCP ?? {}).some(handler => toPort(handler.TCPForward)) ||
    Object.entries(serve.Web ?? {}).some(([endpoint, entry]) =>
      endpoint !== exceptEndpoint && Object.values(entry.Handlers ?? {}).some(handler => toPort(handler.Proxy))) ||
    [...Object.values(serve.Foreground ?? {}), ...Object.values(serve.Services ?? {})].some(config => forwardedTo(config, port));
}

function routeState(serve: Serve, host: string, httpsPort: string, port: number) {
  const endpoint = host + ':' + httpsPort;
  const handlers = serve.Web?.[endpoint]?.Handlers ?? {};
  const tcp = serve.TCP?.[httpsPort];
  const present = tcp?.HTTPS && !tcp.HTTP && !tcp.TCPForward && !tcp.TerminateTLS &&
    Object.keys(handlers).length === 1 && Object.keys(handlers['/'] ?? {}).length === 1 &&
    handlers['/']?.Proxy === 'http://127.0.0.1:' + port &&
    !Object.keys(serve.Web ?? {}).some(key => key !== endpoint && key.endsWith(':' + httpsPort)) &&
    !Object.entries(serve.AllowFunnel ?? {}).some(([key, enabled]) => enabled && key.endsWith(':' + httpsPort)) &&
    !Object.values(serve.Foreground ?? {}).some(config => hasEndpoint(config, httpsPort));
  if ((!present && hasEndpoint(serve, httpsPort)) || forwardedTo(serve, port, present ? endpoint : undefined)) {
    throw new SetupError('The saved address conflicts with a Tailscale Serve or Funnel route. Existing routes were preserved.');
  }
  return present;
}

function readStatus(run: SetupRunner, args: string[]) {
  const result = run('tailscale', [...args, '--json']);
  if (result.status !== 0 || !result.stdout.trim()) throw new SetupError('Install and sign in to Tailscale on this Mac, then rerun mise run setup.');
  let value: unknown;
  try { value = JSON.parse(result.stdout); } catch { throw new SetupError('Tailscale returned an unrecognized status. Update Tailscale, then retry.'); }
  if (value === null && args[0] === 'serve') return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SetupError('Tailscale returned an unrecognized status. Update Tailscale, then retry.');
  return value;
}

function readHost(run: SetupRunner) {
  const status = readStatus(run, ['status']) as { BackendState?: string; Self?: { DNSName?: string } };
  const host = status.Self?.DNSName?.replace(/\.$/, '').toLowerCase();
  if (status.BackendState !== 'Running' || !host || !/^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/.test(host)) {
    throw new SetupError('Sign in to Tailscale and enable MagicDNS for the tailnet, then rerun mise run setup.');
  }
  return host;
}

function buildMatches(root: string, origin: string) {
  try {
    return lstatSync(join(root, 'build/index.js')).isFile() &&
      /export const origin = (.*);/.exec(readFileSync(join(root, 'build/adapter-node.js'), 'utf8'))?.[1] === JSON.stringify(origin);
  } catch { return false; }
}

export async function setupHub({ home, repoRoot, miseBin, uid, run, openPort, awaitHealth, print }: SetupOptions) {
  const directory = join(home, '.config', 'fleck-home-hub');
  const envFile = join(directory, 'hub.conf');
  const logDir = join(home, 'Library', 'Logs', 'fleck-home-hub');
  const agent = { home, repoRoot, miseBin, logDir, envFile, uid, label: DEFAULT_LABEL };
  const { plistPath, commands: [[bootstrap, ...bootstrapArgs]] } = planInstall(agent);
  const expectedPlist = renderPlist(agent);
  const plist = statIfPresent(plistPath);
  if (plist && (!plist.isFile() || plist.uid !== uid || (plist.mode & 0o077) !== 0 || readFileSync(plistPath, 'utf8') !== expectedPlist)) {
    throw new SetupError('A different LaunchAgent already uses the Fleck Home Hub label. The existing service was preserved.');
  }

  const host = readHost(run);
  const inspectServe = () => readStatus(run, ['serve', 'status']) as Serve;
  const serve = inspectServe();
  privateDirectory(directory, uid);
  if (!statIfPresent(envFile)) {
    if (plist) throw new SetupError('The saved service configuration is missing. Restore it before running setup again.');
    const httpsPort = ['443', '8443', '10000'].find(port => !hasEndpoint(serve, port));
    if (!httpsPort) throw new SetupError('All supported HTTPS ports are in use by Tailscale Serve. Free up port 443, 8443 or 10000, then retry.');
    const preferredPort = forwardedTo(serve, 3000) ? undefined : await openPort(3000);
    const port = preferredPort ?? await openPort(0);
    if (!port || forwardedTo(serve, port)) throw new SetupError('Could not find an unused loopback port. Rerun mise run setup.');
    const database = join(directory, 'hub.sqlite');
    if (statIfPresent(database)) throw new SetupError('A database already exists without a service configuration. Restore its original configuration before continuing.');
    const values = {
      AUTH_SECRET: randomBytes(32).toString('hex'),
      DATABASE_PATH: database,
      AUTH_ORIGIN: 'https://' + host + (httpsPort === '443' ? '' : ':' + httpsPort),
      HOST: '127.0.0.1',
      PORT: String(port)
    };
    try {
      publishPrivateFile(envFile, Object.entries(values).map(([key, value]) => key + '=' + value + '\n').join(''));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      throw new SetupError('Another setup command created the private configuration. Let it finish, then rerun if needed.');
    }
  }

  const values = readPrivateConfig(envFile);
  let origin: URL;
  try { origin = new URL(values.AUTH_ORIGIN); } catch { throw new SetupError('The saved configuration has an invalid HTTPS address. It was preserved.'); }
  const httpsPort = origin.port || '443';
  const port = Number(values.PORT ?? '3000');
  if (origin.hostname !== host || origin.protocol !== 'https:' || origin.origin !== values.AUTH_ORIGIN ||
      !['443', '8443', '10000'].includes(httpsPort) || ![undefined, '127.0.0.1'].includes(values.HOST) ||
      !Number.isInteger(port) || port < 1 || port > 65535 || (values.AUTH_SECRET?.length ?? 0) < 32 ||
      !isAbsolute(values.DATABASE_PATH ?? '') || !statIfPresent(dirname(values.DATABASE_PATH))?.isDirectory()) {
    throw new SetupError('The saved configuration does not match this Mac and tailnet. It was preserved.');
  }
  const routeExists = routeState(serve, host, httpsPort, port);

  const agentTarget = 'gui/' + uid + '/' + DEFAULT_LABEL;
  const agentStatus = run('launchctl', ['print', agentTarget]);
  const loaded = agentStatus.status === 0;
  if (loaded && !plist) throw new SetupError('A LaunchAgent is already loaded without the matching service file. It was left running.');
  const statusArgs = ['--', '--config-file', envFile];
  const databaseExists = Boolean(statIfPresent(values.DATABASE_PATH));
  if (plist && !databaseExists) throw new SetupError('The saved database is missing. Restore it before running setup again.');
  let configured = false;
  if (databaseExists) {
    const status = run(miseBin, ['--quiet', 'run', 'setup-code', ...statusArgs, '--status']);
    const kind = status.stdout.trim();
    if (status.status !== 0 || !['configured', 'pending'].includes(kind)) {
      throw new SetupError('The saved database could not be checked safely. Inspect or restore it before running setup again.');
    }
    configured = kind === 'configured';
    if (configured && !plist) throw new SetupError('The saved LaunchAgent is missing. Restore it before running setup again.');
    if (configured && !routeExists) throw new SetupError('The saved Tailscale Serve route is missing. Restore it before running setup again.');
  }
  const agentPid = (output: string) => /^\s*pid = ([1-9]\d*)$/m.exec(output)?.[1];
  const idle = loaded && !agentPid(agentStatus.stdout);
  if ((!loaded || idle) && !(await openPort(port))) throw new SetupError('Another process is listening on the saved loopback port. Stop it and rerun mise run setup.');

  const mise = (args: string[], failure: string, env?: NodeJS.ProcessEnv) => {
    if (run(miseBin, args, { interactive: true, env }).status !== 0) throw new SetupError(failure);
  };
  const setupCode = ['run', 'setup-code', ...statusArgs];
  if (!loaded && !configured) {
    mise(['install', '--locked'], 'The locked mise tools could not be installed.', { ...process.env, MISE_LOCKED_SCOPES: 'project' });
    mise(['run', 'install'], 'The pinned dependencies could not be installed.');
    if (!buildMatches(repoRoot, origin.origin)) {
      const env: NodeJS.ProcessEnv = { ...process.env, AUTH_ORIGIN: origin.origin };
      delete env.AUTH_SECRET;
      delete env.DATABASE_PATH;
      mise(['run', 'build'], 'The production build failed.', env);
      if (!buildMatches(repoRoot, origin.origin)) throw new SetupError('The production build does not match the chosen HTTPS address.');
    }
    mise([...setupCode, '--prepare'], 'The private database could not be prepared.');
    privateDirectory(logDir, uid);
  }
  if (!loaded) {
    if (configured && !buildMatches(repoRoot, origin.origin)) {
      throw new SetupError('The saved production build is missing or uses a different address. Restore it before running setup again.');
    }
    const installed = plist ? run(bootstrap, bootstrapArgs).status === 0 :
      runCommand('install', agent, { run, apply: true }).code === 0;
    if (!installed) throw new SetupError('The LaunchAgent could not start. Rerun mise run setup from a logged-in Mac session.');
  }
  if (idle && run('launchctl', ['kickstart', agentTarget]).status !== 0) {
    throw new SetupError('The saved LaunchAgent could not start. Inspect the private service logs and rerun mise run setup.');
  }
  if (!await awaitHealth('http://127.0.0.1:' + port, false)) {
    throw new SetupError('The application did not become healthy on this Mac. Inspect the private service logs and rerun mise run setup.');
  }

  const currentAgent = run('launchctl', ['print', agentTarget]);
  const pid = agentPid(currentAgent.stdout);
  const listener = pid && run('lsof', ['-nP', '-a', '-p', pid, '-iTCP:' + port, '-sTCP:LISTEN', '-Fn']);
  if (!listener || listener.status !== 0 ||
      listener.stdout.split('\n').filter(line => line.startsWith('n')).join(' ') !== 'n127.0.0.1:' + port) {
    throw new SetupError('The saved loopback port is not served by the Fleck Home Hub LaunchAgent.');
  }
  if (!routeState(inspectServe(), host, httpsPort, port)) {
    if (configured) throw new SetupError('The saved Tailscale Serve route is missing. Restore it before running setup again.');
    const result = run('tailscale', ['serve', '--bg', '--https=' + httpsPort, 'http://127.0.0.1:' + port]);
    if (result.status !== 0) throw new SetupError('Tailscale could not enable private HTTPS. Check the tailnet’s HTTPS settings, then rerun mise run setup.');
  }
  if (!await awaitHealth(origin.origin, true) || !routeState(inspectServe(), host, httpsPort, port)) {
    throw new SetupError('The private HTTPS address did not become healthy. Check Tailscale Serve, then rerun mise run setup.');
  }
  const url = origin.origin + '/';
  print('Open ' + url);
  if (configured) {
    if (run('open', [url]).status !== 0) throw new SetupError('The app is running. Open the printed address in your browser.');
    return;
  }
  mise([...setupCode, '--if-needed'], 'The one-time setup code could not be issued from this terminal.');
}

async function openPort(port: number): Promise<number | undefined> {
  const server = createServer();
  return new Promise(resolve => {
    server.once('error', () => resolve(undefined));
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      server.close(error => resolve(!error && address && typeof address !== 'string' ? address.port : undefined));
    });
  });
}

async function awaitHealth(base: string, https: boolean) {
  const deadline = Date.now() + (https ? 40_000 : 15_000);
  do {
    try {
      const response = await fetch(base + '/api/auth/ok', { redirect: 'manual', signal: AbortSignal.timeout(2_000) });
      if (response.status === 200 && (await response.json())?.ok === true) return true;
      if (response.status !== 200) await response.body?.cancel();
    } catch { /* launchd and HTTPS certificate initialization can take a moment */ }
    await delay(250);
  } while (Date.now() < deadline);
  return false;
}

function findMise(): string {
  for (const dir of (process.env.PATH ?? '').split(':').filter(isAbsolute)) {
    const file = join(dir, 'mise');
    try { accessSync(file, constants.X_OK); return file; } catch { /* continue searching */ }
  }
  throw new SetupError('Install mise and make it available on PATH.');
}

async function main() {
  if (process.argv.length !== 2) throw new SetupError('Usage: mise run setup');
  if (process.platform !== 'darwin' || process.arch !== 'arm64' || !process.getuid?.()) {
    throw new SetupError('Run mise run setup as your normal user on an Apple-silicon Mac.');
  }
  try {
    const tty = openSync('/dev/tty', 'w');
    try { if (!isatty(tty)) throw new Error(); } finally { closeSync(tty); }
  } catch { throw new SetupError('Run mise run setup from a private terminal on the host Mac.'); }

  const repoRoot = realpathSync(join(dirname(fileURLToPath(import.meta.url)), '../..'));
  await setupHub({
    home: homedir(), repoRoot, miseBin: findMise(), uid: process.getuid(),
    run: (command, args, { env, interactive } = {}) => {
      const result = spawnSync(command, args, {
        cwd: repoRoot, env, encoding: 'utf8',
        ...(interactive ? { stdio: 'inherit' } : { timeout: 15_000 })
      });
      return { status: result.status, stdout: result.stdout ?? '' };
    },
    openPort, awaitHealth, print: console.log
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); } catch (error) {
    console.error(error instanceof SetupError ? error.message : 'Setup stopped while reading or writing local configuration. Check its permissions and rerun mise run setup.');
    process.exitCode = 1;
  }
}
