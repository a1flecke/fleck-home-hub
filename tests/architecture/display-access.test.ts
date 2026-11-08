import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, it } from 'vitest';

// A display credential must never be accepted as a household credential. Only the modules below may
// verify one, mint one, or call the readers that skip member authorization. A new route that needs
// display access must be added here deliberately, with its own authorization tests.
const credentialAllowed = new Set([
  'src/lib/server/display.ts', 'src/lib/server/display-pairing.ts', 'src/lib/server/display-session.ts', 'src/lib/server/display-view.ts',
  'src/routes/display/+page.server.ts', 'src/routes/display/data/+server.ts', 'src/routes/display/pair/+page.server.ts', 'src/routes/settings/displays/+page.server.ts'
]);
const credentialUse = /display-pairing|display-session|verifyDisplayCredential|readDisplayToken|redeemPairing|displayDataForDevice/;
const uncheckedAllowed = new Set(['src/lib/server/calendar.ts', 'src/lib/server/meals.ts', 'src/lib/server/display.ts']);
const uncheckedUse = /householdEventOccurrences|householdSharedMeals/;

export function offenders(files: Record<string, string>, allowed: Set<string>, pattern: RegExp) {
  return Object.entries(files).filter(([path, text]) => !allowed.has(path) && pattern.test(text)).map(([path]) => path);
}

function sources(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) Object.assign(out, sources(path));
    else if (/\.(ts|js|svelte)$/.test(name)) out[relative(process.cwd(), path)] = readFileSync(path, 'utf8');
  }
  return out;
}

it('only the audited modules touch display credentials', () => {
  const files = sources('src');
  expect(offenders(files, credentialAllowed, credentialUse)).toEqual([]);
});

it('only the display projection calls household readers that skip member authorization', () => {
  expect(offenders(sources('src'), uncheckedAllowed, uncheckedUse)).toEqual([]);
});

it('no route besides the audited display routes can read the display tables', () => {
  expect(offenders(sources('src'), new Set([...credentialAllowed, 'src/lib/server/member-disable-worker.js']), /\bdisplay_(device|pairing)\b/)).toEqual([]);
});

it('detects new unaudited uses (negative fixtures)', () => {
  expect(offenders({ 'src/routes/dashboard/+page.server.ts': "import { verifyDisplayCredential } from 'x'" }, credentialAllowed, credentialUse)).toEqual(['src/routes/dashboard/+page.server.ts']);
  expect(offenders({ 'src/routes/groceries/+page.server.ts': 'householdSharedMeals(db)' }, uncheckedAllowed, uncheckedUse)).toEqual(['src/routes/groceries/+page.server.ts']);
  expect(offenders({ 'src/routes/x/+server.ts': 'SELECT * FROM display_device' }, credentialAllowed, /\bdisplay_(device|pairing)\b/)).toEqual(['src/routes/x/+server.ts']);
  expect(offenders({ 'src/lib/server/display.ts': 'householdSharedMeals(db)' }, uncheckedAllowed, uncheckedUse)).toEqual([]);
});
