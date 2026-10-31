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
    writeFileSync(join(dir, 'scripts/verify-before-push.sh'), '#!/bin/sh\ntest -z "${GIT_DIR+x}"\n', { mode: 0o755 });
    writeFileSync(join(dir, 'bin/mise'), '#!/bin/sh\nshift 2\nexec "$@"\n', { mode: 0o755 });
    chmodSync(join(dir, '.githooks/pre-push'), 0o755);
    git('add', '.githooks', 'scripts', 'bin'); git('commit', '-m', 'fixture');
    const current = git('rev-parse', 'HEAD').stdout.trim();
    const tree = git('rev-parse', 'HEAD^{tree}').stdout.trim();
    const remoteAhead = git('commit-tree', tree, '-p', current, '-m', 'remote history').stdout.trim();
    const run = (input: string) => spawnSync('sh', ['.githooks/pre-push', 'origin', 'example'], { cwd: dir, input, encoding: 'utf8', env: { ...process.env, GIT_DIR: join(dir, '.git'), PATH: `${join(dir, 'bin')}:${process.env.PATH}` } });
    expect(run(`refs/heads/feature/test ${current} refs/heads/main ${zero}\n`).status).not.toBe(0);
    expect(run(`(delete) ${zero} refs/heads/feature/test ${current}\n`).status).not.toBe(0);
    expect(run('malformed\n').status).not.toBe(0);
    expect(run(`refs/heads/feature/test ${current} refs/heads/feature/test ${zero}\n`).status).toBe(0);
    expect(run(`refs/heads/feature/test ${current} refs/heads/feature/test ${remoteAhead}\n`).status).toBe(0);
    writeFileSync(join(dir, 'dirty'), 'untracked');
    expect(run(`refs/heads/feature/test ${current} refs/heads/feature/test ${zero}\n`).status).not.toBe(0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it('allows an explicit lease for a rewritten feature branch and rejects a stale lease', () => {
  const root = mkdtempSync(join(tmpdir(), 'hub-lease-'));
  const local = join(root, 'local'); const remote = join(root, 'remote.git'); const other = join(root, 'other');
  const git = (cwd: string, ...args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}` } });
  const ok = (cwd: string, ...args: string[]) => { const result = git(cwd, ...args); expect(result.status, result.stderr).toBe(0); return result.stdout.trim(); };
  try {
    mkdirSync(local); mkdirSync(join(root, 'bin'));
    writeFileSync(join(root, 'bin/mise'), '#!/bin/sh\nshift 2\nexec "$@"\n', { mode: 0o755 });
    ok(root, 'init', '--bare', remote); ok(local, 'init', '-b', 'feature/test');
    ok(local, 'config', 'user.name', 'Synthetic'); ok(local, 'config', 'user.email', 'synthetic@example.test');
    mkdirSync(join(local, 'scripts')); mkdirSync(join(local, '.githooks'));
    copyFileSync(resolve('.githooks/pre-push'), join(local, '.githooks/pre-push'));
    copyFileSync(resolve('scripts/pre-push-guard.mjs'), join(local, 'scripts/pre-push-guard.mjs'));
    writeFileSync(join(local, 'scripts/verify-before-push.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    chmodSync(join(local, '.githooks/pre-push'), 0o755);
    ok(local, 'add', '.'); ok(local, 'commit', '-m', 'initial');
    ok(local, 'remote', 'add', 'origin', remote); ok(local, 'config', 'core.hooksPath', '.githooks');
    ok(local, 'push', 'origin', 'HEAD:refs/heads/feature/test');
    const initial = ok(local, 'rev-parse', 'HEAD');
    ok(local, 'commit', '--amend', '-m', 'rewritten');
    ok(root, 'clone', '-b', 'feature/test', remote, other);
    ok(other, 'config', 'user.name', 'Synthetic'); ok(other, 'config', 'user.email', 'synthetic@example.test');
    ok(other, 'commit', '--allow-empty', '-m', 'concurrent update'); ok(other, 'push', 'origin', 'HEAD:refs/heads/feature/test');
    const advanced = ok(other, 'rev-parse', 'HEAD');
    expect(git(local, 'push', `--force-with-lease=refs/heads/feature/test:${initial}`, 'origin', 'HEAD:refs/heads/feature/test').status).not.toBe(0);
    expect(ok(root, '--git-dir', remote, 'rev-parse', 'refs/heads/feature/test')).toBe(advanced);
    ok(local, 'push', `--force-with-lease=refs/heads/feature/test:${advanced}`, 'origin', 'HEAD:refs/heads/feature/test');
    expect(ok(root, '--git-dir', remote, 'rev-parse', 'refs/heads/feature/test')).toBe(ok(local, 'rev-parse', 'HEAD'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
