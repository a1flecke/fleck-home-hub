import { expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, copyFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

it('blocks commits on main and staged secrets while allowing a safe feature commit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-git-test-'));
  const git = (...args: string[]) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  try {
    expect(git('init', '-b', 'main').status).toBe(0);
    git('config', 'user.name', 'Synthetic'); git('config', 'user.email', 'test@example.test');
    mkdirSync(join(dir, '.githooks')); mkdirSync(join(dir, 'scripts')); mkdirSync(join(dir, 'bin'));
    copyFileSync(resolve('.githooks/pre-commit'), join(dir, '.githooks/pre-commit'));
    copyFileSync(resolve('scripts/pre-commit-guard.mjs'), join(dir, 'scripts/pre-commit-guard.mjs'));
    chmodSync(join(dir, '.githooks/pre-commit'), 0o755);
    writeFileSync(join(dir, 'bin/mise'), '#!/bin/sh\nshift 2\nexec "$@"\n', { mode: 0o755 });
    git('config', 'core.hooksPath', '.githooks');
    writeFileSync(join(dir, 'safe.txt'), 'hello\n'); git('add', 'safe.txt');
    const commit = () => spawnSync('git', ['commit', '-m', 'test'], { cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}` } });
    expect(commit().status).not.toBe(0);
    git('switch', '-c', 'feature/test');
    writeFileSync(join(dir, 'bad.txt'), ['-----BEGIN', 'PRIVATE KEY-----\nsynthetic\n-----END', 'PRIVATE KEY-----\n'].join(' ')); git('add', 'bad.txt');
    expect(commit().status).not.toBe(0);
    git('reset', 'bad.txt');
    expect(commit().status).toBe(0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
