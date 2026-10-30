import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';

it('does not let untrusted forwarded addresses bypass the production sign-in limit', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'tests/fixtures/rate-limit.ts'], {
    env: { ...process.env, NODE_ENV: 'production' }, encoding: 'utf8'
  });
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual([401, 401, 401, 429]);
});
