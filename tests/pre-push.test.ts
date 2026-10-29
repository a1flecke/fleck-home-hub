import { expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, copyFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

it('blocks protected updates, deletion and malformed input; verifies a safe branch', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-push-'));
  const git = (...args: string[]) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  try {
    git('init', '-b', 'feature/test'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.test');
    git('commit', '--allow-empty', '-m', 'initial');
    const head = git('rev-parse', 'HEAD').stdout.trim(); const zero = '0'.repeat(head.length);
    mkdirSync(join(dir, 'scripts')); mkdirSync(join(dir, '.githooks')); mkdirSync(join(dir, 'bin'));
    copyFileSync(resolve('.githooks/pre-push'), join(dir, '.githooks/pre-push'));
    copyFileSync(resolve('scripts/pre-push-guard.mjs'), join(dir, 'scripts/pre-push-guard.mjs'));
    writeFileSync(join(dir, 'scripts/verify-before-push.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    writeFileSync(join(dir, 'bin/mise'), '#!/bin/sh\nshift 2\nexec "$@"\n', { mode: 0o755 });
    chmodSync(join(dir, '.githooks/pre-push'), 0o755);
    git('add', '.githooks', 'scripts', 'bin'); git('commit', '-m', 'fixture');
    const current = git('rev-parse', 'HEAD').stdout.trim();
    const run = (input: string) => spawnSync('sh', ['.githooks/pre-push', 'origin', 'example'], { cwd: dir, input, encoding: 'utf8', env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}` } });
    expect(run(`refs/heads/feature/test ${current} refs/heads/main ${zero}\n`).status).not.toBe(0);
    expect(run(`(delete) ${zero} refs/heads/feature/test ${current}\n`).status).not.toBe(0);
    expect(run('malformed\n').status).not.toBe(0);
    expect(run(`refs/heads/feature/test ${current} refs/heads/feature/test ${zero}\n`).status).toBe(0);
    writeFileSync(join(dir, 'dirty'), 'untracked');
    expect(run(`refs/heads/feature/test ${current} refs/heads/feature/test ${zero}\n`).status).not.toBe(0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
