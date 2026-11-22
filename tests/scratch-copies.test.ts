import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { ESLint } from 'eslint';

// tests/sign-in-limit.integration.ts copies the application into the checkout (so mise resolves
// the pinned tools) and removes it afterwards. A run killed before cleanup leaves a full copy of
// src with a node_modules link behind; it must never be committed or linted as project source.
const leftover = '.synthetic-sign-in-limit-AbC123/src/hooks.server.ts';

it('ignores leftover sign-in limit copies in git', () => {
  const result = spawnSync('git', ['check-ignore', '--no-index', '--quiet', leftover], { encoding: 'utf8' });
  expect(result.status).toBe(0);
});

it('ignores leftover sign-in limit copies in lint', async () => {
  expect(await new ESLint().isPathIgnored(leftover)).toBe(true);
});

it('still lints and tracks real source', async () => {
  expect(spawnSync('git', ['check-ignore', '--no-index', '--quiet', 'src/hooks.server.ts']).status).toBe(1);
  expect(await new ESLint().isPathIgnored('src/hooks.server.ts')).toBe(false);
});
