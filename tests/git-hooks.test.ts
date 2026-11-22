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

it('blocks a copied service configuration secret and encrypted backups while allowing placeholders', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-git-secret-'));
  const git = (...args: string[]) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  try {
    expect(git('init', '-b', 'feature/test').status).toBe(0);
    git('config', 'user.name', 'Synthetic'); git('config', 'user.email', 'test@example.test');
    mkdirSync(join(dir, '.githooks')); mkdirSync(join(dir, 'scripts')); mkdirSync(join(dir, 'bin'));
    copyFileSync(resolve('.githooks/pre-commit'), join(dir, '.githooks/pre-commit'));
    copyFileSync(resolve('scripts/pre-commit-guard.mjs'), join(dir, 'scripts/pre-commit-guard.mjs'));
    chmodSync(join(dir, '.githooks/pre-commit'), 0o755);
    writeFileSync(join(dir, 'bin/mise'), '#!/bin/sh\nshift 2\nexec "$@"\n', { mode: 0o755 });
    git('config', 'core.hooksPath', '.githooks');
    const commit = () => spawnSync('git', ['commit', '-m', 'test'], { cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}` } });
    const attempt = (name: string, content: string) => {
      writeFileSync(join(dir, name), content); git('add', name);
      const result = commit();
      if (result.status !== 0) git('reset', '-q', name);
      return result;
    };

    // A copy of hub.conf, as the restore rehearsal guide asks for, under any name.
    const synthetic = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4';
    const copied = attempt('rehearsal-copy.txt', `DATABASE_PATH=/private/x.sqlite\nAUTH_SECRET=${synthetic}\n`);
    expect(copied.status).not.toBe(0);
    expect(copied.stderr).toContain('Potential secret in staged file: rehearsal-copy.txt');
    expect(attempt('quoted.txt', `AUTH_SECRET="${synthetic}"\n`).status).not.toBe(0);
    const named = attempt('hub.conf', 'PORT=3000\n');
    expect(named.status).not.toBe(0);
    expect(named.stderr).toContain('Refusing sensitive file: hub.conf');
    expect(attempt('backup.sqlite.age', 'age-encryption.org/v1\n').status).not.toBe(0);

    // Documentation placeholders, test interpolation and short fixtures stay committable.
    expect(attempt('docs.md', 'AUTH_SECRET=<unique random value, at least 32 characters>\nAUTH_SECRET=${SECRET}\nAUTH_SECRET=short\n').status).toBe(0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
