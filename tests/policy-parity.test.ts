import { expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

it('detects policy drift and nonexistent commands', () => {
  const root = mkdtempSync(join(tmpdir(), 'hub-policy-'));
  const run = () => spawnSync(process.execPath, [resolve('scripts/check-agent-policy-parity.mjs'), root], { encoding: 'utf8' });
  try {
    mkdirSync(join(root, '.opencode/commands'), { recursive: true });
    const shared = 'Use mise run test. Never merge or approve your own PR. Never force-push a protected branch. Use --force-with-lease=<full-ref>:<reviewed-remote-commit> for feature branches.';
    writeFileSync(join(root, 'AGENTS.md'), shared);
    writeFileSync(join(root, 'CLAUDE.md'), 'Follow AGENTS.md.');
    writeFileSync(join(root, 'mise.toml'), '[tasks.test]\nrun = "pnpm test"\n');
    writeFileSync(join(root, 'package.json'), JSON.stringify({ packageManager: 'pnpm@12.16.1' }));
    writeFileSync(join(root, '.opencode/commands/work.md'), 'Read AGENTS.md.');
    const policy = { share: 'disabled', permissions: [{ action: 'shell', resource: '*', effect: 'ask' }], policies: [{ action: 'tool.use', resource: 'shell:gh pr merge *', effect: 'deny' }, { action: 'tool.use', resource: 'shell:git push --force *', effect: 'deny' }], agents: { build: { permissions: ['gh pr merge *', 'git push --force *', 'git reset --hard *', 'git clean *'].map(resource => ({ action: 'shell', resource, effect: 'deny' })) } } };
    writeFileSync(join(root, '.opencode/opencode.jsonc'), JSON.stringify(policy));
    expect(run().status).toBe(0);
    writeFileSync(join(root, 'AGENTS.md'), 'Use mise run test. Never merge or approve your own PR. Never force-push.');
    expect(run().status).not.toBe(0);
    writeFileSync(join(root, 'AGENTS.md'), shared);
    writeFileSync(join(root, 'CLAUDE.md'), 'Follow AGENTS.md. Run mise run imaginary.');
    expect(run().status).not.toBe(0);
    writeFileSync(join(root, 'CLAUDE.md'), 'Follow AGENTS.md.');
    policy.permissions[0].effect = 'allow';
    writeFileSync(join(root, '.opencode/opencode.jsonc'), JSON.stringify(policy));
    expect(run().status).not.toBe(0);
    policy.permissions[0].effect = 'ask';
    policy.permissions.push({ action: 'shell', resource: 'git status *', effect: 'allow' });
    writeFileSync(join(root, '.opencode/opencode.jsonc'), JSON.stringify(policy));
    expect(run().status).not.toBe(0);
    policy.permissions.pop();
    const build = policy.agents.build.permissions;
    build.unshift({ action: 'shell', resource: 'git status *', effect: 'allow' });
    writeFileSync(join(root, '.opencode/opencode.jsonc'), `// comment\n${JSON.stringify(policy)}`.replace('{"share"', '{\n// c\n"share"'));
    expect(run().status).toBe(0);
    build.unshift({ action: 'shell', resource: 'bash *', effect: 'allow' });
    writeFileSync(join(root, '.opencode/opencode.jsonc'), JSON.stringify(policy));
    expect(run().status).not.toBe(0);
    build[0].resource = 'mise run e2e *';
    writeFileSync(join(root, '.opencode/opencode.jsonc'), JSON.stringify(policy));
    expect(run().status).toBe(0);
    build[0].resource = './scripts/run-with-mise.sh pnpm exec vitest run *';
    writeFileSync(join(root, '.opencode/opencode.jsonc'), JSON.stringify(policy));
    expect(run().status).toBe(0);
    for (const resource of ['mise exec *', 'mise run *', 'pnpm exec *', 'pnpm *', './scripts/run-with-mise.sh *', './scripts/run-with-mise.sh gh *', './scripts/run-with-mise.sh mise run test *']) {
      build[0].resource = resource;
      writeFileSync(join(root, '.opencode/opencode.jsonc'), JSON.stringify(policy));
      expect(run().status).not.toBe(0);
    }
    build.shift();
    build.push({ action: 'shell', resource: 'gh pr merge *', effect: 'allow' });
    writeFileSync(join(root, '.opencode/opencode.jsonc'), JSON.stringify(policy));
    expect(run().status).not.toBe(0);
    build.pop();
    build.unshift({ action: '*', resource: 'x', effect: 'allow' });
    writeFileSync(join(root, '.opencode/opencode.jsonc'), JSON.stringify(policy));
    expect(run().status).not.toBe(0);
    policy.permissions = [];
    writeFileSync(join(root, '.opencode/opencode.jsonc'), JSON.stringify(policy));
    expect(run().status).not.toBe(0);
    writeFileSync(join(root, '.opencode/opencode.jsonc'), '{');
    expect(run().status).not.toBe(0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
