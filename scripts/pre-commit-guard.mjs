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
    // hub.conf is the private service configuration; .age is an encrypted household backup.
    if ((/^\.env(?:\.|$)/i.test(name) && name !== '.env.example') || /\.(?:sqlite3?|db)(?:-(?:wal|shm|journal))?$/i.test(name) || /\.(?:pem|key|p12|pfx|age)$/i.test(name) || /^hub\.conf$/i.test(name)) {
      throw new Error(`Refusing sensitive file: ${path}`);
    }
    const content = git('show', `:${path}`);
    // A literal AUTH_SECRET assignment at the start of a line is what a copied hub.conf contains, under
    // any file name. Placeholders (<...>), interpolation (${...}) and short test values do not match.
    const serviceSecret = /^[ \t]*AUTH_SECRET[ \t]*=[ \t]*["']?[^\s"'$<>{}]{32,}/m;
    if (/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/.test(content) || /\bgh[pousr]_[A-Za-z0-9]{36,}\b/.test(content) || serviceSecret.test(content)) throw new Error(`Potential secret in staged file: ${path}`);
  }
} catch (error) {
  console.error(`pre-commit: ${error.message}`);
  process.exitCode = 1;
}
