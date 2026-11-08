#!/usr/bin/env node
// Read-only deployment preflight. It inspects the host and the configured
// paths and prints PASS / WARN / FAIL / UNKNOWN lines. It changes nothing,
// never runs launchctl or tailscale, and never prints AUTH_SECRET.
import { accessSync, constants, existsSync, lstatSync, readFileSync, statfsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseEnvFile } from './envfile.mjs';

/** @typedef {{ id: string, status: 'PASS' | 'WARN' | 'FAIL' | 'UNKNOWN', message: string }} Check */
/** @typedef {(command: string, args: string[]) => ({ status: number | null, stdout: string } | null)} Exec */

export const LABEL_DEFAULT_PORT = 3000;
const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '::1', '[::1]'];
const MIN_FREE_BYTES = 1024 ** 3;

/** @param {string} platform @param {string} arch */
export function platformKey(platform, arch) {
  const os = platform === 'darwin' ? 'macos' : platform;
  return `${os}-${arch}`;
}

/** Tools from `tools` that have no entry for `platform` in the mise lock text. */
export function lockHasPlatform(/** @type {string} */ lockText, /** @type {string[]} */ tools, /** @type {string} */ platform) {
  return tools.filter(tool => !lockText.includes(`[tools.${tool}."platforms.${platform}"]`));
}

/** Same rules as readIdentityConfig in src/lib/server/config.ts (parity is tested). */
export function validateOrigin(/** @type {string | undefined} */ value) {
  let url;
  try { url = new URL(value ?? ''); } catch { return { ok: false, local: false, origin: '' }; }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const ok = (url.protocol === 'https:' || (local && url.protocol === 'http:')) && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash;
  return { ok, local, origin: url.origin };
}

/** @param {string} output lsof -Fn output */
export function parseListeners(output) {
  const names = output.split('\n').filter(line => line.startsWith('n')).map(line => line.slice(1));
  const exposed = names.filter(name => !/^(127\.0\.0\.1|\[::1\]|localhost):/.test(name));
  return { names, exposed };
}

/** @param {string} path @param {string} root */
function isInside(path, root) {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
/** @param {string} path */
function hasDotDot(path) { return path.split(sep).includes('..'); }
/** @template T @param {string} _path @param {() => T} fn @returns {T | undefined} */
function attempt(_path, fn) { try { return fn(); } catch { return undefined; } }

/** @param {Record<string, any>} ctx @returns {Check[]} */
export function runPreflight(ctx) {
  /** @type {Check[]} */
  const checks = [];
  /** @param {string} id @param {Check['status']} status @param {string} message */
  const add = (id, status, message) => { checks.push({ id, status, message }); };
  const repoRoot = ctx.repoRoot;
  const exec = /** @type {Exec} */ (ctx.exec);
  const key = platformKey(ctx.platform, ctx.arch);

  // Host and locked binaries
  if (ctx.platform !== 'darwin') {
    add('host', 'WARN', `${key} is not a macOS deployment target; results are for development or CI only`);
  } else {
    const missing = lockHasPlatform(ctx.lockText, ['node', 'pnpm'], key);
    if (missing.length) add('host', 'FAIL', `mise.lock has no ${key} entry for ${missing.join(', ')}; "mise install --locked" cannot provide the pinned toolchain on this Mac. Do not bypass the lock; add the platform through a reviewed "mise lock" change.`);
    else add('host', 'PASS', `${key}: locked node and pnpm binaries are listed in mise.lock`);
  }

  // mise-managed pinned binaries (mise where is read-only)
  const tools = /** @type {Record<string, string>} */ (ctx.pinned);
  const located = Object.entries(tools).map(([tool, version]) => {
    const result = exec('mise', ['where', `${tool}@${version}`]);
    return { tool, version, ok: !!result && result.status === 0 && existsSync(result.stdout.trim()) };
  });
  const absent = located.filter(entry => !entry.ok);
  if (absent.length) add('toolchain', 'FAIL', `pinned ${absent.map(entry => `${entry.tool}@${entry.version}`).join(', ')} not installed by mise (or mise unavailable); run MISE_LOCKED_SCOPES=project mise install --locked`);
  else add('toolchain', 'PASS', `mise reports pinned ${located.map(entry => `${entry.tool}@${entry.version}`).join(', ')} installed`);

  // Dependencies and build
  add('dependencies', existsSync(join(repoRoot, 'node_modules')) ? 'PASS' : 'FAIL', existsSync(join(repoRoot, 'node_modules')) ? 'node_modules is present' : 'dependencies not installed; run mise run install');
  const buildEntry = join(repoRoot, 'build', 'index.js');
  add('build', existsSync(buildEntry) ? 'PASS' : 'FAIL', existsSync(buildEntry) ? 'production build is present' : 'production build missing; run mise run build with AUTH_ORIGIN set');

  // Configuration source
  /** @type {Record<string, string | undefined>} */
  let config = {};
  let configLoaded = false;
  if (ctx.envFile) {
    const file = ctx.envFile;
    const stat = attempt(file, () => lstatSync(file));
    if (!isAbsolute(file) || hasDotDot(file)) add('env-file', 'FAIL', 'configuration file path must be absolute without ".." segments');
    else if (!stat) add('env-file', 'FAIL', 'configuration file not found');
    else if (!stat.isFile()) add('env-file', 'FAIL', 'configuration path is not a regular file (symlinks are refused)');
    else if ((stat.mode & 0o077) !== 0) add('env-file', 'FAIL', `configuration file mode is ${(stat.mode & 0o777).toString(8)}; run chmod 600`);
    else if (stat.uid !== ctx.uid) add('env-file', 'FAIL', 'configuration file is not owned by the current user');
    else if (isInside(file, repoRoot)) add('env-file', 'FAIL', 'configuration file must live outside the repository');
    else {
      add('env-file', 'PASS', 'configuration file is a private regular file owned by the current user');
      const parsed = parseEnvFile(readFileSync(file, 'utf8'));
      config = parsed.values; configLoaded = true;
      if (parsed.errors.length) { add('env-syntax', 'FAIL', parsed.errors.join('; ')); configLoaded = false; }
    }
  } else {
    config = { AUTH_SECRET: ctx.env.AUTH_SECRET, DATABASE_PATH: ctx.env.DATABASE_PATH, AUTH_ORIGIN: ctx.env.AUTH_ORIGIN, HOST: ctx.env.HOST, PORT: ctx.env.PORT };
    configLoaded = true;
    add('env-file', 'WARN', 'no --config-file given; checked the current process environment, not the service configuration');
  }

  // Required values (never echo the secret or its length)
  const missingKeys = ['AUTH_SECRET', 'DATABASE_PATH', 'AUTH_ORIGIN'].filter(name => !config[name]);
  const secretShort = !!config.AUTH_SECRET && config.AUTH_SECRET.length < 32;
  if (!configLoaded) add('config', 'FAIL', 'configuration not loaded');
  else if (missingKeys.length) add('config', 'FAIL', `missing required setting(s): ${missingKeys.join(', ')}`);
  else if (secretShort) add('config', 'FAIL', 'AUTH_SECRET is shorter than 32 characters');
  else add('config', 'PASS', 'AUTH_SECRET (not shown), DATABASE_PATH and AUTH_ORIGIN are present');

  // Origin
  if (config.AUTH_ORIGIN) {
    const origin = validateOrigin(config.AUTH_ORIGIN);
    if (!origin.ok) add('origin', 'FAIL', 'AUTH_ORIGIN must be an HTTPS origin with no path, or localhost over HTTP');
    else if (origin.local) add('origin', 'WARN', `${origin.origin} is local-only; phones and displays need the HTTPS Tailscale Serve origin`);
    else add('origin', 'WARN', `${origin.origin} is well formed; that it matches the real Tailscale Serve URL requires operator validation`);
    const adapter = join(repoRoot, 'build', 'adapter-node.js');
    const built = attempt(adapter, () => /export const origin = (.*);/.exec(readFileSync(adapter, 'utf8'))?.[1]);
    if (!existsSync(adapter)) add('build-origin', 'FAIL', 'build output missing, so the build-time origin cannot be checked');
    else if (!built) add('build-origin', 'FAIL', 'build-time origin could not be read');
    else if (origin.ok && built === JSON.stringify(origin.origin)) add('build-origin', 'PASS', 'build-time origin matches AUTH_ORIGIN');
    else add('build-origin', 'FAIL', 'build-time origin differs from AUTH_ORIGIN (or none was set); rebuild with AUTH_ORIGIN exported');
  }

  // Bind address
  const host = config.HOST;
  const portText = config.PORT ?? String(LABEL_DEFAULT_PORT);
  const port = /^\d+$/.test(portText) ? Number(portText) : NaN;
  if (host && !LOOPBACK_HOSTS.includes(host)) add('bind', 'FAIL', 'HOST is not a loopback address; the service must listen on 127.0.0.1 and be published only through Tailscale Serve');
  else if (!(port >= 1 && port <= 65535)) add('bind', 'FAIL', 'PORT must be an integer from 1 to 65535');
  else add('bind', 'PASS', `configured to listen on ${host ?? '127.0.0.1 (default)'} port ${port}`);

  // Existing listener on the port (read-only lsof; sees only this user's processes)
  if (port >= 1 && port <= 65535) {
    const result = exec('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fn']);
    if (!result) add('listener', 'UNKNOWN', 'lsof unavailable; could not inspect listeners');
    else {
      const { names, exposed } = parseListeners(result.stdout);
      if (exposed.length) add('listener', 'FAIL', `a listener on port ${port} is not loopback-only: ${exposed.join(', ')}`);
      else if (names.length) add('listener', 'PASS', `port ${port} is listening on loopback only (processes of other users are not visible)`);
      else add('listener', 'PASS', `nothing visible is listening on port ${port} (service not running, or owned by another user)`);
    }
  }

  // Database path and privacy
  const db = config.DATABASE_PATH;
  if (db) {
    const dbDir = dirname(db);
    if (!isAbsolute(db) || hasDotDot(db) || normalize(db) !== db) add('database', 'FAIL', 'DATABASE_PATH must be a normalized absolute path without ".." segments');
    else if (isInside(db, repoRoot)) add('database', 'FAIL', 'DATABASE_PATH must be outside the repository');
    else {
      const dirStat = attempt(dbDir, () => statSync(dbDir));
      const fileStat = attempt(db, () => lstatSync(db));
      if (!dirStat) add('database', 'FAIL', 'database directory does not exist; create a private (chmod 700) directory');
      else if ((dirStat.mode & 0o077) !== 0) add('database', 'FAIL', `database directory mode is ${(dirStat.mode & 0o777).toString(8)}; run chmod 700`);
      else if (fileStat && (!fileStat.isFile() || (fileStat.mode & 0o077) !== 0)) add('database', 'FAIL', 'existing database must be a regular file with mode 600');
      else if (fileStat) add('database', 'PASS', 'database file exists in a private directory with owner-only mode');
      else add('database', 'WARN', 'database does not exist yet; provision it once with mise run bootstrap-account');
      if (dirStat) {
        const free = attempt(dbDir, () => { const s = statfsSync(dbDir); return s.bavail * s.bsize; });
        if (typeof free !== 'number') add('disk', 'UNKNOWN', 'free disk space could not be determined');
        else add('disk', free >= MIN_FREE_BYTES ? 'PASS' : 'WARN', `${Math.floor(free / 1024 ** 2)} MiB free on the database volume`);
      }
    }
  }

  // launchd and service user (launchctl is deliberately not run)
  if (ctx.uid === 0) add('service-user', 'WARN', 'running as root; a LaunchAgent should run as the ordinary household service user');
  else add('service-user', 'PASS', 'running as a non-root user');
  const launchctl = existsSync('/bin/launchctl');
  const agentPlist = join(ctx.home, 'Library', 'LaunchAgents', 'local.fleck.home-hub.plist');
  add('launchd', 'UNKNOWN', `${launchctl ? 'launchctl present' : 'launchctl not found at /bin/launchctl'}; this check does not run it, so the GUI login session and loaded state are undetermined (${existsSync(agentPlist) ? 'a plist is installed' : 'no plist installed'}). Verify with launchctl print gui/$(id -u).`);

  // Tailscale (presence only)
  const found = exec('which', ['tailscale']);
  const cli = found && found.status === 0 ? found.stdout.trim() : '';
  add('tailscale', 'WARN', cli
    ? `CLI found (${cli}); this does not verify tailnet membership, ACLs, Serve configuration or that Funnel is off.`
    : 'Tailscale CLI not found on PATH (the macOS app bundles one); required for phone access, and its presence would not verify tailnet access.');

  // Backup destination
  if (ctx.backupDir) {
    const dir = ctx.backupDir;
    const stat = attempt(dir, () => statSync(dir));
    if (!isAbsolute(dir) || hasDotDot(dir)) add('backup', 'FAIL', 'backup directory must be absolute without ".." segments');
    else if (isInside(dir, repoRoot)) add('backup', 'FAIL', 'backup directory must be outside the repository');
    else if (!stat || !stat.isDirectory()) add('backup', 'FAIL', 'backup directory does not exist');
    else if ((stat.mode & 0o077) !== 0) add('backup', 'FAIL', `backup directory mode is ${(stat.mode & 0o777).toString(8)}; run chmod 700`);
    else if (!attempt(dir, () => { accessSync(dir, constants.W_OK); return true; })) add('backup', 'FAIL', 'backup directory is not writable');
    else {
      const dbDir = db ? attempt(dirname(db), () => statSync(dirname(db))) : undefined;
      const same = dbDir && dbDir.dev === stat.dev;
      add('backup', 'WARN', same
        ? 'backup directory is private and writable but on the same volume as the database; it does not protect against disk or host loss. Off-host copy requires operator validation.'
        : 'backup directory is private and writable; whether it is off-host or encrypted cannot be determined locally');
    }
  } else {
    add('backup', 'WARN', 'no --backup-dir given; backup destination not checked');
  }

  add('sleep', 'WARN', 'sleep and wake behavior is not inspected or changed; validate it manually');
  return checks;
}

/** @param {Check[]} checks */
export function formatReport(checks) {
  const lines = checks.map(check => `[${check.status}] ${check.id}: ${check.message}`);
  const count = (/** @type {string} */ status) => checks.filter(check => check.status === status).length;
  lines.push('', `Summary: ${count('PASS')} PASS, ${count('WARN')} WARN, ${count('FAIL')} FAIL, ${count('UNKNOWN')} UNKNOWN`);
  lines.push('PASS means verified locally. WARN and UNKNOWN need operator validation. A clean preflight is not a pilot sign-off.');
  return lines.join('\n') + '\n';
}

/** @param {Check[]} checks @param {boolean} [strict] */
export function exitCode(checks, strict = false) {
  if (checks.some(check => check.status === 'FAIL')) return 1;
  if (strict && checks.some(check => check.status === 'WARN' || check.status === 'UNKNOWN')) return 2;
  return 0;
}

/** @type {Exec} */
function realExec(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 5000, cwd: repoRootFromScript() });
  if (result.error) return null;
  return { status: result.status, stdout: result.stdout ?? '' };
}
function repoRootFromScript() { return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'); }

/** @param {string} text @param {string} name */
function pinnedVersion(text, name) { return new RegExp(`^${name}\\s*=\\s*"([^"]+)"`, 'm').exec(text)?.[1]; }

function main() {
  const args = process.argv.slice(2);
  /** @type {{ envFile?: string, backupDir?: string, strict: boolean }} */
  const options = { strict: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--strict') options.strict = true;
    else if (arg === '--config-file' && args[index + 1]) options.envFile = args[++index];
    else if (arg === '--backup-dir' && args[index + 1]) options.backupDir = args[++index];
    else { console.error('Usage: preflight.mjs [--config-file PATH] [--backup-dir PATH] [--strict]'); process.exit(64); }
  }
  const repoRoot = repoRootFromScript();
  const mise = readFileSync(join(repoRoot, 'mise.toml'), 'utf8');
  const lockText = existsSync(join(repoRoot, 'mise.lock')) ? readFileSync(join(repoRoot, 'mise.lock'), 'utf8') : '';
  const pinned = Object.fromEntries(['node', 'pnpm'].map(tool => [tool, pinnedVersion(mise, tool) ?? 'unknown']));
  const checks = runPreflight({
    platform: process.platform, arch: process.arch, uid: process.getuid?.() ?? -1, repoRoot, env: process.env, home: process.env.HOME ?? homedir(),
    exec: realExec, lockText, pinned, ...options
  });
  process.stdout.write(formatReport(checks));
  process.exit(exitCode(checks, options.strict));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
