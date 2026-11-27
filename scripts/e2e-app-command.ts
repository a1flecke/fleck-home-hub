import { existsSync } from 'node:fs';

/**
 * How the browser-test servers start the application. By default each runs its own production
 * build (`node .e2e-build/<name>`, prepared by scripts/e2e-prepare.mjs for that server's origin),
 * which is what the household installs; E2E_SERVER=dev uses `vite dev` instead, for debugging.
 *
 * NODE_ENV=test keeps Better Auth's sign-in limiter off for the suite's many sign-ins, exactly as
 * under `vite dev`; `mise run sign-in-limit-test` covers the limiter with the real launcher.
 */
export function appCommand(port: number, origin: string, build: 'main' | 'onboarding'): { command: string; args: string[]; env: Record<string, string> } {
  if (process.env.E2E_SERVER === 'dev') {
    return { command: 'pnpm', args: ['exec', 'vite', 'dev', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], env: {} };
  }
  const out = `.e2e-build/${build}`;
  if (!existsSync(`${out}/index.js`)) throw new Error(`No production build in ${out}: run \`node scripts/e2e-prepare.mjs\` (mise run e2e does this) or set E2E_SERVER=dev`);
  return { command: 'node', args: [out], env: { HOST: '127.0.0.1', PORT: String(port), ORIGIN: origin, NODE_ENV: 'test' } };
}
