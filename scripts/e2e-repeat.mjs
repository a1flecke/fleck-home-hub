// Runs every browser spec marked `// e2e-isolation: fresh-households` twice in one server. A spec
// that leaks state between runs (a reused record name, an exact total over shared data, a one-time
// action on a shared account) fails its second repetition. Extra arguments go to Playwright.
import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const marker = '// e2e-isolation: fresh-households';
const specs = readdirSync('e2e').filter(name => name.endsWith('.spec.ts') && readFileSync(`e2e/${name}`, 'utf8').includes(marker)).sort().map(name => `e2e/${name}`);
if (!specs.length) { console.error('e2e-repeat: no isolated specs found'); process.exit(1); }
console.log(`e2e-repeat: ${specs.length} isolated specs, two repetitions each`);
const run = (args) => spawnSync('pnpm', ['exec', ...args], { stdio: 'inherit' }).status ?? 1;
const sync = run(['svelte-kit', 'sync']);
if (sync !== 0) process.exit(sync);
process.exit(run(['playwright', 'test', ...specs, '--repeat-each=2', ...process.argv.slice(2)]));
