import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = (payload: string) => spawnSync(process.execPath, ['.agents/hooks/guard.mjs'], { input: payload, encoding: 'utf8' });
const toolEvent = (name: string, args: Record<string, unknown>, cwd = process.cwd()) =>
  JSON.stringify({ hookEventName: 'PreToolUse', toolCall: { id: 'toolu_test', name, args }, cwd });
const commandEvent = (CommandLine: string, cwd = process.cwd()) => toolEvent('run_command', { CommandLine }, cwd);

const parseDecision = (payload: string) => {
  const result = run(payload);
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as { decision: string; reason?: string };
};

// Commit checks inspect the active branch, and CI runs on a detached HEAD, so commit cases use
// synthetic repositories to isolate branch and hook-bypass rules.
const featureRepo = mkdtempSync(join(tmpdir(), 'hub-antigravity-hook-feature-'));
const mainRepo = mkdtempSync(join(tmpdir(), 'hub-antigravity-hook-main-'));
spawnSync('git', ['init', '-q', '-b', 'feature/hook-test'], { cwd: featureRepo });
spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: mainRepo });
afterAll(() => {
  rmSync(featureRepo, { recursive: true, force: true });
  rmSync(mainRepo, { recursive: true, force: true });
});

const bypassReason = 'Do not bypass Git verification hooks';

describe('Antigravity PreToolUse hook', () => {
  it('fails closed for malformed or unexpected payloads', () => {
    for (const payload of [
      '{',
      JSON.stringify({}),
      JSON.stringify({ hookEventName: 'PostToolUse', toolCall: { name: 'run_command', args: { CommandLine: 'git status' } }, cwd: featureRepo }),
      JSON.stringify({ hookEventName: 'PreToolUse', toolCall: { name: 'run_command', args: {} }, cwd: featureRepo }),
      JSON.stringify({ hookEventName: 'PreToolUse', toolCall: { name: 'read_file', args: {} }, cwd: featureRepo }),
      JSON.stringify({ hookEventName: 'PreToolUse', toolCall: { name: 'unknown_tool', args: {} }, cwd: featureRepo }),
    ]) {
      expect(parseDecision(payload).decision, payload).toBe('deny');
    }
  });

  it('denies destructive commands, privilege escalation, and PR self-approval', () => {
    for (const command of [
      'git reset --hard',
      'git clean -fd',
      'rm -rf /tmp/example',
      'pkill node',
      'killall node',
      'gh repo delete a1flecke/fleck-home-hub',
      'sudo ls',
      'git push --force origin HEAD',
      'git push -f origin HEAD',
      'git push -uf origin HEAD',
      'git push -d origin feature/old',
      '/usr/bin/git push -f origin HEAD',
      'git push origin +HEAD:main',
      'git push origin :feature/old',
      'git push --delete origin feature/old',
      'git push --tags',
      'git push --mirror',
      'gh pr review 123 --approve',
      "gh pr review 123 '--approve'",
      'gh pr review 123 "-a"',
      '/opt/homebrew/bin/gh pr review 123 --approve',
      'gh pr review -a 123',
      'gh pr review 123 -ab "looks good"',
      'git -C /tmp/example status; rm -rf /tmp/example',
    ]) {
      expect(parseDecision(commandEvent(command, featureRepo)).decision, command).toBe('deny');
    }
  });

  it('denies commits on main and allows ordinary commits on a feature branch', () => {
    expect(parseDecision(commandEvent('git commit -m example', mainRepo)).decision).toBe('deny');
    expect(parseDecision(commandEvent('git commit -m example', featureRepo)).decision).toBe('allow');
  });

  it('denies every spelling of a commit or push hook bypass', () => {
    const skip = ['--no', 'verify'].join('-');
    for (const command of [
      'git commit -nm example',
      'git commit -anm example',
      'git commit -an -m example',
      `git commit ${skip.slice(0, -2)} -m example`,
      `git commit ${skip.slice(0, -3)} -m example`,
      `git commit ${skip}=true -m example`,
      `git push ${skip}`,
      `git push ${skip.slice(0, -1)} origin HEAD`,
      `git push origin HEAD ${skip}`,
      `git commit '${skip}' -m example`,
      'git commit "-n" -m example',
      `git push '${skip}' origin HEAD`,
      `/usr/bin/git commit ${skip} -m example`,
      `git --namespace foo commit ${skip} -m example`,
      'git status && git commit -nm example',
    ]) {
      const output = parseDecision(commandEvent(command, featureRepo));
      expect(output.decision, command).toBe('deny');
      expect(output.reason, command).toContain(bypassReason);
    }
  });

  it('does not mistake commit message text or other options for a hook bypass or PR approval', () => {
    for (const command of [
      'git status --short',
      './scripts/dev.sh test tests/antigravity-hook.test.ts',
      'git commit -m "fix -n handling"',
      "git commit -m 'drop --no-verify from docs'",
      'git commit -am example',
      'git commit -m example -m "second -n paragraph"',
      'git commit --no-edit',
      'git push -n origin HEAD',
      'git push --dry-run origin HEAD',
      'cat .env.example',
      'gh pr review 123 --comment -b "looks good"',
      'gh pr review 123 --comment -b "-a"',
    ]) {
      const output = parseDecision(commandEvent(command, featureRepo));
      expect(output.decision, command).toBe('allow');
      expect(output.decision, command).not.toBe('auto_approve');
    }
  });

  it('forces review before PR merges, feature-branch rewrites, and sensitive commands', () => {
    for (const command of [
      'gh pr merge 123 --rebase',
      'git push --force-with-lease=refs/heads/feature/test:abc origin HEAD:refs/heads/feature/test',
      'tailscale serve reset',
      'cat .env',
      'cat .env.local',
      'cat hub.conf',
      'cat data/hub.sqlite',
      'cat data/hub.db',
      'cat backup.age',
      'cat ~/.config/opencode/service.json',
      'ls ~/.gemini/config',
      'cat ~/.claude/settings.json',
      'cat ~/.codex/config.toml',
    ]) {
      expect(parseDecision(commandEvent(command, featureRepo)).decision, command).toBe('force_ask');
    }
  });

  it('asks for Git context changes and branch deletions', () => {
    for (const command of [
      'git -C /tmp/example commit -m example',
      'cd /tmp/example && git commit -m example',
      'git -c core.hooksPath=/dev/null commit -m example',
      'git branch -d feature/old',
      'git branch -D feature/old',
      'git branch --delete feature/old',
    ]) {
      expect(parseDecision(commandEvent(command, featureRepo)).decision, command).toBe('ask');
    }
  });

  it('denies reading private household data, secrets, and service credentials across read tools', () => {
    for (const [tool, key, path] of [
      ['read_file', 'Path', join(featureRepo, '.env')],
      ['read_file', 'Path', join(featureRepo, '.env.local')],
      ['view_file', 'AbsolutePath', join(featureRepo, 'data/hub.sqlite')],
      ['read_file', 'Path', join(featureRepo, 'data/hub.sqlite-wal')],
      ['read_file', 'Path', join(featureRepo, 'data/hub.sqlite3')],
      ['read_file', 'Path', join(featureRepo, 'data/hub.db')],
      ['read_file', 'Path', join(featureRepo, 'data/hub.db-shm')],
      ['read_file', 'Path', join(featureRepo, 'hub.conf')],
      ['read_file', 'Path', join(featureRepo, 'backup.age')],
      ['read_file', 'Path', join(featureRepo, 'server.key')],
      ['read_file', 'Path', '/Users/test/.config/opencode/service.json'],
    ] as const) {
      expect(parseDecision(toolEvent(tool, { [key]: path }, featureRepo)).decision, path).toBe('deny');
    }

    for (const [tool, key, path] of [
      ['read_file', 'Path', join(featureRepo, '.env.example')],
      ['view_file', 'AbsolutePath', join(featureRepo, 'AGENTS.md')],
      ['read_file', 'Path', join(featureRepo, 'GEMINI.md')],
    ] as const) {
      expect(parseDecision(toolEvent(tool, { [key]: path }, featureRepo)).decision, path).toBe('allow');
    }
  });

  it('gates edits to global agent configs and private secret files while allowing workspace and artifact files', () => {
    for (const [tool, key, path] of [
      ['edit_file', 'Path', '/Users/test/.config/opencode/config.json'],
      ['write_file', 'Path', '/Users/test/.gemini/config/hooks.json'],
      ['write_to_file', 'TargetFile', '/Users/test/.gemini/settings.json'],
      ['replace_file_content', 'TargetFile', '/Users/test/.gemini/GEMINI.md'],
      ['multi_replace_file_content', 'TargetFile', '/Users/test/.gemini/antigravity-cli/settings.json'],
      ['edit_file', 'Path', '/Users/test/.claude/settings.json'],
      ['write_file', 'Path', '/Users/test/.codex/config.toml'],
    ] as const) {
      expect(parseDecision(toolEvent(tool, { [key]: path }, featureRepo)).decision, path).toBe('force_ask');
    }

    for (const path of [
      join(featureRepo, '.env'),
      join(featureRepo, '.env.production'),
      join(featureRepo, 'hub.conf'),
      join(featureRepo, 'backup.age'),
    ]) {
      expect(parseDecision(toolEvent('write_file', { Path: path }, featureRepo)).decision, path).toBe('deny');
    }

    for (const [tool, key, path] of [
      ['write_file', 'Path', '/Users/test/.gemini/antigravity/brain/conv-1/plan.md'],
      ['edit_file', 'Path', join(featureRepo, '.agents/hooks.json')],
      ['edit_file', 'Path', join(featureRepo, '.claude/settings.json')],
      ['write_file', 'Path', join(featureRepo, '.env.example')],
      ['replace_file_content', 'TargetFile', join(featureRepo, 'src/routes/+page.svelte')],
    ] as const) {
      expect(parseDecision(toolEvent(tool, { [key]: path }, featureRepo)).decision, path).toBe('allow');
    }
  });
});
