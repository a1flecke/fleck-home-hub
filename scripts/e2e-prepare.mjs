// Builds the application before a browser-test run. AUTH_ORIGIN is a build-time input (it sets
// SvelteKit's paths.origin, and Better Auth only serves /api/auth for that origin), so each test
// server gets its own build in .e2e-build/, leaving the deployable build/ untouched. The main
// server's build runs last so .svelte-kit/output (read by e2e/support/modules.ts) describes it.
// Skipped with E2E_SERVER=dev, where the servers run `vite dev` instead.
import { spawnSync } from 'node:child_process';

export const E2E_BUILDS = [
  { out: '.e2e-build/onboarding', origin: 'http://127.0.0.1:4174' },
  { out: '.e2e-build/main', origin: 'http://127.0.0.1:4173' }
];

if (process.env.E2E_SERVER !== 'dev') {
  for (const build of E2E_BUILDS) {
    const result = spawnSync('pnpm', ['exec', 'vite', 'build'], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, AUTH_ORIGIN: build.origin, E2E_BUILD_OUT: build.out } });
    if (result.status !== 0) { console.error(`e2e-prepare: vite build for ${build.origin} failed`); process.exit(result.status ?? 1); }
  }
  console.log('e2e-prepare: production builds ready');
}
