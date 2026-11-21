import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';

function signInStatuses(nodeEnv: string | undefined) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (nodeEnv === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = nodeEnv;
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'tests/fixtures/rate-limit.ts'], { env, encoding: 'utf8' });
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout) as number[];
}

it('does not let untrusted forwarded addresses bypass the production sign-in limit', () => {
  expect(signInStatuses('production')).toEqual([401, 401, 401, 429]);
});

// The LaunchAgent starts the server with a minimal environment. Better Auth only enables its
// limiter for NODE_ENV=production by default, so an unset value must still fail closed.
it('keeps the sign-in limit when NODE_ENV is missing or unrecognized', () => {
  expect(signInStatuses(undefined)).toEqual([401, 401, 401, 429]);
  expect(signInStatuses('staging')).toEqual([401, 401, 401, 429]);
});

it('leaves the limiter off only for explicit development and test runs', () => {
  expect(signInStatuses('development')).toEqual([401, 401, 401, 401]);
  expect(signInStatuses('test')).toEqual([401, 401, 401, 401]);
});
