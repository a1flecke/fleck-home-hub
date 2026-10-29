import { expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

it('configures hooks per worktree and refuses to overwrite another hook path', () => {
  const base = mkdtempSync(join(tmpdir(), 'hub-hooks-'));
  const root = join(base, 'main'); const linked = join(base, 'linked');
  const git = (cwd: string, ...args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf8' });
  try {
    mkdirSync(root); expect(git(root, 'init', '-b', 'main').status).toBe(0);
    git(root, 'config', 'user.name', 'Synthetic'); git(root, 'config', 'user.email', 'test@example.test');
    expect(git(root, 'commit', '--allow-empty', '-m', 'initial').status).toBe(0);
    mkdirSync(join(root, 'scripts')); mkdirSync(join(root, '.githooks'));
    copyFileSync(resolve('scripts/setup-git-hooks.sh'), join(root, 'scripts/setup-git-hooks.sh'));
    const setup = (cwd: string) => spawnSync('sh', [join(root, 'scripts/setup-git-hooks.sh')], { cwd, encoding: 'utf8', env: { ...process.env, GIT_WORK_TREE: cwd, GIT_DIR: git(cwd, 'rev-parse', '--absolute-git-dir').stdout.trim() } });
    expect(setup(root).status).toBe(0);
    expect(git(root, 'config', '--worktree', '--get', 'core.hooksPath').stdout.trim()).toBe('.githooks');
    expect(git(root, 'worktree', 'add', '-b', 'feature/test', linked).status).toBe(0);
    mkdirSync(join(linked, '.githooks'));
    expect(setup(linked).status).toBe(0);
    expect(git(linked, 'config', '--worktree', '--get', 'core.hooksPath').stdout.trim()).toBe('.githooks');
    git(linked, 'config', '--worktree', 'core.hooksPath', '/tmp/unrelated-hooks');
    expect(setup(linked).status).not.toBe(0);
    expect(git(linked, 'config', '--worktree', '--get', 'core.hooksPath').stdout.trim()).toBe('/tmp/unrelated-hooks');
  } finally { rmSync(base, { recursive: true, force: true }); }
});

it('refuses to enable worktree configuration when shared core.worktree needs migration', () => {
  const root = mkdtempSync(join(tmpdir(), 'hub-hooks-config-'));
  const git = (...args: string[]) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  try {
    expect(git('init', '-b', 'main').status).toBe(0);
    expect(git('config', '--local', 'core.worktree', root).status).toBe(0);
    mkdirSync(join(root, '.githooks'));
    const result = spawnSync('sh', [resolve('scripts/setup-git-hooks.sh')], { cwd: root, encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(git('config', '--local', '--get', 'core.worktree').stdout.trim()).toBe(root);
    expect(git('config', '--local', '--get', 'extensions.worktreeConfig').stdout.trim()).not.toBe('true');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
