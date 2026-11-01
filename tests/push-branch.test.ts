import { expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, copyFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const git = (cwd: string, ...args: string[]) => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
};

it('push-branch publishes a rebased feature branch with a lease pinned to the last seen remote tip', () => {
  const base = mkdtempSync(join(tmpdir(), 'hub-push-branch-'));
  try {
    const remote = join(base, 'remote.git');
    const work = join(base, 'work');
    const other = join(base, 'other');
    git(base, 'init', '-q', '--bare', '-b', 'main', remote);
    git(base, 'clone', '-q', remote, work);
    mkdirSync(join(work, 'scripts'));
    copyFileSync(resolve('scripts/push-branch.sh'), join(work, 'scripts/push-branch.sh'));
    writeFileSync(join(work, 'a.txt'), 'a');
    git(work, 'add', '-A');
    git(work, 'commit', '-q', '-m', 'base');
    git(work, 'push', '-q', 'origin', 'HEAD:main');
    const push = () => spawnSync('sh', [join(work, 'scripts/push-branch.sh')], { cwd: work, encoding: 'utf8' });

    expect(push().status).not.toBe(0);
    git(work, 'switch', '-q', '-c', 'feature/x');
    writeFileSync(join(work, 'b.txt'), '1');
    git(work, 'add', '-A');
    git(work, 'commit', '-q', '-m', 'feature');
    expect(push().status).toBe(0);
    expect(git(remote, 'rev-parse', 'refs/heads/feature/x')).toBe(git(work, 'rev-parse', 'HEAD'));

    git(work, 'commit', '-q', '--amend', '-m', 'feature rewritten');
    expect(push().status).toBe(0);
    expect(git(remote, 'rev-parse', 'refs/heads/feature/x')).toBe(git(work, 'rev-parse', 'HEAD'));

    git(base, 'clone', '-q', '-b', 'feature/x', remote, other);
    writeFileSync(join(other, 'c.txt'), '2');
    git(other, 'add', '-A');
    git(other, 'commit', '-q', '-m', 'someone else');
    git(other, 'push', '-q', 'origin', 'feature/x');
    const theirs = git(remote, 'rev-parse', 'refs/heads/feature/x');
    git(work, 'commit', '-q', '--amend', '-m', 'feature rewritten again');
    expect(push().status).not.toBe(0);
    expect(git(remote, 'rev-parse', 'refs/heads/feature/x')).toBe(theirs);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
