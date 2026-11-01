import { expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

it.each(['sync-main.sh'])('%s refuses unsafe states and accepts only fixed operations', name => {
  const root = mkdtempSync(join(tmpdir(), 'hub-workflow-'));
  try {
    mkdirSync(join(root, 'scripts')); mkdirSync(join(root, 'bin'));
    copyFileSync(resolve(`scripts/${name}`), join(root, 'scripts', name));
    writeFileSync(join(root, 'bin/git'), `#!/bin/sh
printf '%s\\n' "$*" >> "$GIT_TEST_LOG"
case "$*" in
  'symbolic-ref --short -q HEAD') printf '%s\\n' "$TEST_BRANCH" ;;
  'status --porcelain --untracked-files=all') printf '%s' "$TEST_DIRTY" ;;
  'rev-parse --show-toplevel') pwd ;;
esac
exit 0
`, { mode: 0o755 });
    const log = join(root, 'log');
    const run = (branch: string, dirty: string, args: string[] = []) => spawnSync('sh', [join(root, 'scripts', name), ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, PATH: `${join(root, 'bin')}:/usr/bin:/bin`, GIT_TEST_LOG: log, TEST_BRANCH: branch, TEST_DIRTY: dirty } });
    expect(run('feature/test', '', ['--force']).status).not.toBe(0);
    expect(run('main', '').status).not.toBe(0);
    expect(run('feature/test', '?? data').status).not.toBe(0);
    expect(run('feature/test', '').status).toBe(0);
    const commands = readFileSync(log, 'utf8');
    expect(commands).toContain('fetch origin main');
    expect(commands).not.toMatch(/--force|--delete/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
