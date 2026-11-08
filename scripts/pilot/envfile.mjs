// Strict parser for the private service configuration file. It never evaluates
// the file: lines are KEY=VALUE for an allowlist of keys, with no expansion.
// scripts/pilot/launch.sh implements the same rules in POSIX shell; the tests
// run both against the same fixtures.
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
