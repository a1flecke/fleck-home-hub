#!/usr/bin/env node
// Generates, and optionally installs, a per-user LaunchAgent for Fleck Home Hub.
// Everything is a dry run unless --apply is given. The plist contains paths
// only: no credentials, no secrets in arguments.
import { chmodSync, existsSync, lstatSync, mkdirSync, rmSync, writeFileSync, statSync, accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const DEFAULT_LABEL = 'local.fleck.home-hub';

/** @typedef {{ repoRoot: string, envFile: string, miseBin: string, logDir: string, label: string, home: string, uid: number }} Options */
/** @typedef {(command: string, args: string[]) => ({ status: number | null, stdout: string })} Runner */

/** @param {string} value */
const xml = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** @param {string} path @param {string} root */
const inside = (path, root) => { const rel = relative(root, path); return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)); };

/** @param {Options} o @returns {string[]} problems */
export function validateOptions(o) {
  /** @type {string[]} */
  const problems = [];
  for (const [name, value] of /** @type {[string, string][]} */ ([['repo', o.repoRoot], ['env file', o.envFile], ['mise', o.miseBin], ['log directory', o.logDir]])) {
    // eslint-disable-next-line no-control-regex
    if (!isAbsolute(value) || /[\u0000-\u001f]/.test(value) || value.split('/').includes('..')) problems.push(`${name} must be an absolute path without control characters or ".." segments`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(o.label)) problems.push('label may contain only letters, digits, dot, underscore and hyphen');
  if (problems.length) return problems;
  if (inside(o.envFile, o.repoRoot)) problems.push('the private configuration file must live outside the repository');
  if (inside(o.logDir, o.repoRoot)) problems.push('the log directory must live outside the repository');
  return problems;
}

/** @param {Options} o */
export function renderPlist(o) {
  const problems = validateOptions(o);
  if (problems.length) throw new Error(problems.join('; '));
  const launcher = join(o.repoRoot, 'scripts', 'pilot', 'launch.sh');
  const entries = /** @type {[string, string][]} */ ([
    ['HUB_ENV_FILE', o.envFile], ['HUB_MISE', o.miseBin], ['HUB_LOG_DIR', o.logDir], ['PATH', `${dirname(o.miseBin)}:/usr/bin:/bin`]
  ]).map(([k, v]) => `    <key>${k}</key>\n    <string>${xml(v)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(o.label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(launcher)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(o.repoRoot)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${entries}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>Umask</key>
  <integer>63</integer>
  <key>StandardOutPath</key>
  <string>${xml(join(o.logDir, 'stdout.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${xml(join(o.logDir, 'stderr.log'))}</string>
</dict>
</plist>
`;
}

/** @param {Options} o */
export function planInstall(o) {
  const plistPath = join(o.home, 'Library', 'LaunchAgents', `${o.label}.plist`);
  return { plistPath, commands: [['launchctl', 'bootstrap', `gui/${o.uid}`, plistPath]] };
}

/** @param {string} command @param {Options} o @param {{ apply: boolean, run: Runner }} io @returns {{ code: number, output: string }} */
export function runCommand(command, o, io) {
  const target = `gui/${o.uid}/${o.label}`;
  const { plistPath } = planInstall(o);
  /** @type {Record<string, string[][]>} */
  const planned = {
    preview: [], install: planInstall(o).commands,
    uninstall: [['launchctl', 'bootout', target]], restart: [['launchctl', 'kickstart', '-k', target]], status: [['launchctl', 'print', target]]
  };
  if (!(command in planned)) return { code: 64, output: 'Usage: launchd.mjs preview|install|uninstall|restart|status [--apply]\n' };
  const problems = validateOptions(o);
  if (problems.length) return { code: 1, output: `Refusing: ${problems.join('; ')}\n` };
  if (command === 'preview') return { code: 0, output: renderPlist(o) };
  const lines = planned[command].map(parts => parts.join(' '));
  if (!io.apply) {
    return { code: 0, output: `Dry run: nothing changed. With --apply this would ${command === 'install' ? `write ${plistPath} (mode 600, never overwriting) and ` : ''}run:\n  ${lines.join('\n  ')}\n` };
  }
  if (command === 'install') {
    const stat = (() => { try { return lstatSync(o.envFile); } catch { return undefined; } })();
    if (!stat || !stat.isFile() || (stat.mode & 0o077) !== 0) return { code: 1, output: 'Refusing: the private configuration file must be a regular, non-symlink file with mode 600\n' };
    try { accessSync(o.miseBin, constants.X_OK); } catch { return { code: 1, output: 'Refusing: mise is not executable at the given path\n' }; }
    if (existsSync(plistPath)) return { code: 1, output: `Refusing: ${plistPath} already exists; run uninstall first\n` };
    mkdirSync(o.logDir, { recursive: true, mode: 0o700 }); chmodSync(o.logDir, 0o700);
    mkdirSync(dirname(plistPath), { recursive: true });
    writeFileSync(plistPath, renderPlist(o), { flag: 'wx', mode: 0o600 });
  }
  for (const [cmd, ...args] of planned[command]) {
    const result = io.run(cmd, args);
    if (result.status !== 0) return { code: 1, output: `${command} failed: ${cmd} exited ${result.status}. ${command === 'uninstall' ? 'The plist was left in place.' : ''}\n` };
  }
  if (command === 'uninstall' && existsSync(plistPath)) rmSync(plistPath);
  return { code: 0, output: `${command} completed.\n` };
}

/** @type {Runner} */
const realRunner = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  return { status: result.error ? 127 : result.status, stdout: result.stdout ?? '' };
};

function findMise() {
  for (const dir of (process.env.PATH ?? '').split(':')) {
    const candidate = join(dir, 'mise');
    try { if (dir && isAbsolute(dir) && statSync(candidate).isFile()) return candidate; } catch { /* keep looking */ }
  }
  return join(homedir(), '.local', 'bin', 'mise');
}

function main() {
  const [command = 'preview', ...rest] = process.argv.slice(2);
  const home = process.env.HOME ?? homedir();
  const o = /** @type {Options} */ ({
    repoRoot: resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'), envFile: join(home, '.config', 'fleck-home-hub', 'hub.conf'),
    miseBin: findMise(), logDir: join(home, 'Library', 'Logs', 'fleck-home-hub'), label: DEFAULT_LABEL, home, uid: process.getuid?.() ?? -1
  });
  let apply = false;
  /** @type {Record<string, 'repoRoot' | 'envFile' | 'miseBin' | 'logDir' | 'label'>} */
  const flags = { '--repo': 'repoRoot', '--config-file': 'envFile', '--mise': 'miseBin', '--log-dir': 'logDir', '--label': 'label' };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--apply') apply = true;
    else if (flags[rest[i]] && rest[i + 1]) o[flags[rest[i]]] = rest[++i];
    else { console.error('Usage: launchd.mjs preview|install|uninstall|restart|status [--apply] [--repo P] [--config-file P] [--mise P] [--log-dir P] [--label L]'); process.exit(64); }
  }
  const result = runCommand(command, o, { apply, run: realRunner });
  (result.code === 0 ? process.stdout : process.stderr).write(result.output);
  process.exit(result.code);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
