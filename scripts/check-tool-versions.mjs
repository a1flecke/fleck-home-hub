import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** @param {string} packageManager @param {string} pnpm */
export function checkVersions(packageManager, pnpm) {
  return /^\d+\.\d+\.\d+$/.test(pnpm) && packageManager === `pnpm@${pnpm}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = readFileSync(new URL('../mise.toml', import.meta.url), 'utf8');
  const match = config.match(/^pnpm\s*=\s*"([^"]+)"\s*$/m);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  if (!match || !checkVersions(pkg.packageManager, match[1])) {
    console.error('pnpm versions do not match or are not exact');
    process.exitCode = 1;
  } else console.log('pnpm versions match');
}
