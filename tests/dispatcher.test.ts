import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('task dispatcher', () => {
  const run = (...args: string[]) => spawnSync('sh', ['scripts/dev.sh', ...args], { encoding: 'utf8' });
  it('rejects an arbitrary executable', () => expect(run('sh').status).not.toBe(0));
  it('rejects flags and extra arguments', () => expect(run('build', '--help').status).not.toBe(0));
  it('rejects traversal', () => expect(run('test', '../package.json').status).not.toBe(0));
  it.each(['tests/dispatcher.test.ts;id', 'tests/dispatcher.test.ts$(id)', 'tests/../tests/dispatcher.test.ts', 'tests/dispatcher.test.ts\n--help'])(
    'rejects shell metacharacters and traversal in %s', path => expect(run('test', path).status).not.toBe(0)
  );
  it('rejects a nonexistent test path', () => expect(run('test', 'tests/nonexistent.test.ts').status).not.toBe(0));
  it('prints usage without executing arbitrary commands', () => expect(run().stderr).toContain('Usage:'));
  it('passes only the selected existing test to mise', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dispatcher-'));
    const log = join(dir, 'args');
    try {
      writeFileSync(join(dir, 'mise'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$DISPATCH_TEST_LOG"\n', { mode: 0o755 });
      const result = spawnSync('sh', ['scripts/dev.sh', 'test', 'tests/dispatcher.test.ts'], {
        env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, DISPATCH_TEST_LOG: log }, encoding: 'utf8'
      });
      expect(result.status).toBe(0);
      expect(readFileSync(log, 'utf8')).toBe('exec\n--\npnpm\nexec\nvitest\nrun\ntests/dispatcher.test.ts\n');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('rejects symlinked test files', () => {
    const link = 'tests/dispatcher-link.test.ts';
    try { symlinkSync('dispatcher.test.ts', link); expect(run('test', link).status).not.toBe(0); }
    finally { rmSync(link, { force: true }); }
  });
});
