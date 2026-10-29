import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

function git(...args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Unable to inspect Git state');
  return result.stdout.trim();
}
try {
  const branch = git('symbolic-ref', '--short', 'HEAD');
  if (branch === 'main' || branch === 'master') throw new Error('Direct pushes to protected branches are forbidden');
  const head = git('rev-parse', 'HEAD');
  if (git('status', '--porcelain', '--untracked-files=all')) throw new Error('Worktree must be clean before pushing');
  const input = readFileSync(0, 'utf8').trim();
  if (!input) throw new Error('Missing push updates');
  for (const line of input.split('\n')) {
    const fields = line.split(' ');
    if (fields.length !== 4) throw new Error('Malformed push update');
    const [localRef, localSha, remoteRef, remoteSha] = fields;
    if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(localSha) || !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(remoteSha) || localSha.length !== head.length || remoteSha.length !== head.length) throw new Error('Invalid object ID');
    if ((localRef !== `refs/heads/${branch}` && localRef !== 'HEAD') || remoteRef !== `refs/heads/${branch}` || localSha !== head) throw new Error('Only the current feature branch may be pushed');
    if (!/^0+$/.test(remoteSha)) {
      const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', remoteSha, head]);
      if (ancestor.status !== 0) throw new Error('Refusing a non-fast-forward update');
    }
  }
} catch (error) {
  console.error(`pre-push: ${error.message}`);
  process.exitCode = 1;
}
