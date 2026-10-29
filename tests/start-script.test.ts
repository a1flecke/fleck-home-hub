import { expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

it('binds production server to loopback by default', () => {
  const root = mkdtempSync(join(tmpdir(), 'hub-start-'));
  try {
    mkdirSync(join(root, 'scripts')); mkdirSync(join(root, 'bin'));
    copyFileSync(resolve('scripts/start.sh'), join(root, 'scripts/start.sh'));
    writeFileSync(join(root, 'bin/mise'), '#!/bin/sh\nprintf "%s:%s\\n" "$HOST" "$*" > "$TEST_LOG"\n', { mode: 0o755 });
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${join(root, 'bin')}:/usr/bin:/bin`, TEST_LOG: join(root, 'log') };
    delete env.HOST;
    const result = spawnSync('sh', [join(root, 'scripts/start.sh')], { cwd: root, env, encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(readFileSync(join(root, 'log'), 'utf8')).toBe('127.0.0.1:exec -- node build\n');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
