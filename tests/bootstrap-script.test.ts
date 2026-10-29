import { expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

it('requires mise and invokes only locked setup steps', () => {
  const root = mkdtempSync(join(tmpdir(), 'hub-bootstrap-'));
  try {
    mkdirSync(join(root, 'scripts')); mkdirSync(join(root, 'bin'));
    copyFileSync(resolve('scripts/bootstrap.sh'), join(root, 'scripts/bootstrap.sh'));
    for (const name of ['setup-git-hooks.sh', 'doctor.sh']) writeFileSync(join(root, 'scripts', name), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const env = { ...process.env, PATH: `${join(root, 'bin')}:/usr/bin:/bin`, BOOTSTRAP_LOG: join(root, 'log') };
    const run = () => spawnSync('sh', [join(root, 'scripts/bootstrap.sh')], { cwd: root, env, encoding: 'utf8' });
    expect(run().status).not.toBe(0);
    writeFileSync(join(root, 'bin/mise'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$BOOTSTRAP_LOG"\n', { mode: 0o755 });
    expect(run().status).toBe(0);
    expect(readFileSync(join(root, 'log'), 'utf8')).toBe('install --locked\nrun install\n');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
