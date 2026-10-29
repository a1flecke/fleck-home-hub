import { spawnSync } from 'node:child_process';

function git(...args) {
  const result = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0 || result.error) throw new Error('Could not inspect the Git index');
  return result.stdout;
}
try {
  const branch = git('symbolic-ref', '--quiet', '--short', 'HEAD').trim();
  if (branch === 'main' || branch === 'master' || !branch) throw new Error('Commits must use a feature branch');
  const files = git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z').split('\0').filter(Boolean);
  for (const path of files) {
    const name = path.split('/').at(-1);
    if ((/^\.env(?:\.|$)/i.test(name) && name !== '.env.example') || /\.(?:sqlite3?|db)(?:-(?:wal|shm|journal))?$/i.test(name) || /\.(?:pem|key|p12|pfx)$/i.test(name)) {
      throw new Error(`Refusing sensitive file: ${path}`);
    }
    const content = git('show', `:${path}`);
    if (/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/.test(content) || /\bgh[pousr]_[A-Za-z0-9]{36,}\b/.test(content)) throw new Error(`Potential secret in staged file: ${path}`);
  }
} catch (error) {
  console.error(`pre-commit: ${error.message}`);
  process.exitCode = 1;
}
