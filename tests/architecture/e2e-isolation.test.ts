import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

// Guardrail for repeatable browser tests. A spec marked `// e2e-isolation: fresh-households` builds
// every household it touches through e2e/support/households.ts, so it can run any number of times in
// one server (`mise run e2e-repeat` runs the marked specs twice). Shared seeded accounts in
// scripts/e2e-server.ts accumulate balances, records and one-time actions across tests and repeats.
//
// Ratchet: every spec must carry the marker or be listed in LEGACY_SHARED_SPECS. A new spec cannot
// be added to the legacy list, and a migrated spec must be removed from it, so the list only shrinks.

export const ISOLATION_MARKER = '// e2e-isolation: fresh-households';

/** Specs still built on shared seeded households. Remove an entry when its spec is migrated. */
export const LEGACY_SHARED_SPECS = [
  'bulk-groceries.spec.ts', 'calendar-import.spec.ts', 'calendar.spec.ts', 'checklist-event-prep.spec.ts', 'checklist-templates.spec.ts',
  'chore-edit.spec.ts', 'chore-week.spec.ts', 'chores.spec.ts', 'dashboard-calendar.spec.ts', 'display-pairing.spec.ts', 'display.spec.ts',
  'expenses.spec.ts', 'family-checklists.spec.ts', 'family-dinners.spec.ts', 'family-readiness.spec.ts', 'groceries.spec.ts',
  'household-invitations.spec.ts', 'kid-my-day.spec.ts', 'meal-planner.spec.ts', 'meals.spec.ts', 'member-disable.spec.ts',
  'my-day-history.spec.ts', 'onboarding.spec.ts', 'payouts.spec.ts', 'plan-again.spec.ts', 'pwa.spec.ts', 'recovery.spec.ts',
  'recurring-schedule.spec.ts', 'sessions.spec.ts', 'shop-the-week.spec.ts', 'smoke.spec.ts', 'verification-inbox.spec.ts'
];

const seededEmail = /['"`][\w.+-]+@example\.test['"`]/;
const seededPassword = /['"`]synthetic-[\w-]*password['"`]/;

export function isolationFindings(specs: Record<string, string>, legacy: readonly string[]): string[] {
  const findings: string[] = [];
  const names = new Set(Object.keys(specs));
  for (const [name, source] of Object.entries(specs)) {
    const isolated = source.includes(ISOLATION_MARKER);
    if (isolated && legacy.includes(name)) findings.push(`${name} is isolated: remove it from LEGACY_SHARED_SPECS`);
    if (!isolated && !legacy.includes(name)) findings.push(`${name} must build its households with freshHousehold() and carry the isolation marker`);
    if (!isolated) continue;
    if (!/from '\.\/support\/households'/.test(source)) findings.push(`${name} is marked isolated but does not use e2e/support/households`);
    source.split('\n').forEach((line, index) => {
      if (seededEmail.test(line) || seededPassword.test(line)) findings.push(`${name}:${index + 1} isolated spec uses a shared seeded account`);
    });
  }
  for (const name of legacy) if (!names.has(name)) findings.push(`${name} no longer exists: remove it from LEGACY_SHARED_SPECS`);
  return findings;
}

export function seedServiceFindings(seedSource: string, appSources: Record<string, string>): string[] {
  const findings: string[] = [];
  if (!/\.listen\(SEED_PORT, '127\.0\.0\.1'\)/.test(seedSource)) findings.push('the e2e seeding service must listen on 127.0.0.1 only');
  if (!/\.immediate\(\)/.test(seedSource)) findings.push('the e2e seeding service must write each household in one immediate transaction');
  for (const [file, source] of Object.entries(appSources)) if (/e2e-seed-server/.test(source)) findings.push(`${file} must not import the e2e seeding service`);
  return findings;
}

function walk(directory: string, suffix: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path, suffix) : path.endsWith(suffix) ? [path] : [];
  });
}

it('keeps isolated specs off shared seeded accounts and ratchets the legacy list', () => {
  const specs = Object.fromEntries(readdirSync('e2e').filter(name => name.endsWith('.spec.ts')).map(name => [name, readFileSync(join('e2e', name), 'utf8')]));
  expect(isolationFindings(specs, LEGACY_SHARED_SPECS)).toEqual([]);
});

it('runs the marked specs twice in CI', () => {
  expect(readFileSync('scripts/e2e-repeat.mjs', 'utf8')).toContain(`'${ISOLATION_MARKER}'`);
  expect(readFileSync('scripts/e2e-repeat.mjs', 'utf8')).toContain("'--repeat-each=2'");
  expect(readFileSync('mise.toml', 'utf8')).toMatch(/\[tasks\.e2e-repeat\][^[]*run = "node scripts\/e2e-repeat\.mjs"/);
  expect(readFileSync('.github/workflows/ci.yml', 'utf8')).toContain('- run: mise run e2e-repeat');
});

it('keeps the seeding service local and out of the application', () => {
  const app = Object.fromEntries([...walk('src', '.ts'), ...walk('src', '.svelte'), ...walk('src', '.js')].map(file => [file, readFileSync(file, 'utf8')]));
  expect(seedServiceFindings(readFileSync('scripts/e2e-seed-server.ts', 'utf8'), app)).toEqual([]);
});

it('detects shared accounts, unmarked specs and a stale legacy list (negative fixtures)', () => {
  const isolated = `${ISOLATION_MARKER}\nimport { freshHousehold } from './support/households';\n`;
  expect(isolationFindings({
    'new.spec.ts': "test('x', async () => {});",
    'migrated.spec.ts': isolated,
    'leaky.spec.ts': `${isolated}const email = 'parent@example.test';\nconst password = 'synthetic-parent-password';\nconst attacker = 'https://attacker.example.test';\n`,
    'unwired.spec.ts': `${ISOLATION_MARKER}\n`
  }, ['migrated.spec.ts', 'gone.spec.ts'])).toEqual([
    'new.spec.ts must build its households with freshHousehold() and carry the isolation marker',
    'migrated.spec.ts is isolated: remove it from LEGACY_SHARED_SPECS',
    'leaky.spec.ts:3 isolated spec uses a shared seeded account',
    'leaky.spec.ts:4 isolated spec uses a shared seeded account',
    'unwired.spec.ts is marked isolated but does not use e2e/support/households',
    'gone.spec.ts no longer exists: remove it from LEGACY_SHARED_SPECS'
  ]);
  expect(seedServiceFindings("server.listen(SEED_PORT);", { 'src/routes/x.ts': "import { startSeedServer } from '../../scripts/e2e-seed-server';" })).toEqual([
    'the e2e seeding service must listen on 127.0.0.1 only',
    'the e2e seeding service must write each household in one immediate transaction',
    'src/routes/x.ts must not import the e2e seeding service'
  ]);
});
