// Strict parser for the private service configuration file. It never evaluates
// the file: lines are KEY=VALUE for an allowlist of keys, with no expansion.
// scripts/pilot/launch.sh implements the same rules in POSIX shell; the tests
// run both against the same fixtures.
import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

export const ALLOWED_KEYS = ['AUTH_SECRET', 'DATABASE_PATH', 'AUTH_ORIGIN', 'HOST', 'PORT'];

/** @param {string} text @returns {{ values: Record<string, string>, errors: string[] }} */
export function parseEnvFile(text) {
  /** @type {Record<string, string>} */
  const values = {};
  /** @type {string[]} */
  const errors = [];
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  lines.forEach((line, index) => {
    const number = index + 1;
    if (line === '' || line.startsWith('#')) return;
    const separator = line.indexOf('=');
    if (separator < 1) { errors.push(`line ${number}: expected KEY=VALUE`); return; }
    const key = line.slice(0, separator);
    let value = line.slice(separator + 1);
    if (!ALLOWED_KEYS.includes(key)) { errors.push(`line ${number}: key is not allowed (${key.replace(/[^A-Za-z0-9_]/g, '?').slice(0, 40)})`); return; }
    if (key in values) { errors.push(`line ${number}: ${key} is defined twice`); return; }
    if (value.includes('\r')) { errors.push(`line ${number}: carriage return in value`); return; }
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) value = value.slice(1, -1);
    values[key] = value;
  });
  return { values, errors };
}

/** @param {string} path */
export function readPrivateConfig(path) {
  if (!isAbsolute(path)) throw new Error('Expected an absolute config file path');
  const file = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(file);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()) throw new Error('Private configuration file required');
    const parsed = parseEnvFile(readFileSync(file, 'utf8'));
    if (parsed.errors.length) throw new Error('Invalid configuration file');
    return parsed.values;
  } finally { closeSync(file); }
}
