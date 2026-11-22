import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';

const run = (payload: string) => spawnSync(process.execPath, ['.claude/hooks/guard.mjs'], { input: payload, encoding: 'utf8' });
const event = (command: string) => JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: process.cwd() });
describe('Claude PreToolUse hook', () => {
  it('blocks destructive commands', () => expect(run(event('git reset --hard')).status).toBe(2));
  it('asks before a feature-branch force-with-lease while still denying plain force', () => {
    const result = run(event('git push --force-with-lease=refs/heads/feature/test:abc origin HEAD:refs/heads/feature/test'));
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('ask');
    expect(run(event('git push --force origin HEAD')).status).toBe(2);
  });
  it('allows a safe inspection command', () => expect(run(event('git status --short')).status).toBe(0));
  it('fails closed for malformed events', () => {
    expect(run('{').status).toBe(2);
    expect(run(JSON.stringify({ tool_input: {} })).status).toBe(2);
  });
  it('asks for sensitive operations', () => {
    const result = run(event('tailscale serve reset'));
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('ask');
  });
  it('requires review for Git context changes and refuses hook bypasses', () => {
    for (const command of ['git -C /tmp/example commit -m example', 'cd /tmp/example && git commit -m example', 'git -c core.hooksPath=/dev/null commit -m example']) {
      const result = run(event(command));
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('ask');
    }
    expect(run(event('git commit --no-verify -m example')).status).toBe(2);
    expect(run(event('git -C /tmp/example status; rm -rf /tmp/example')).status).toBe(2);
  });
  // Git accepts clustered short options and any unambiguous long-option prefix, so these all skip
  // the commit or push hook. The pre-push hook runs the full verification and refuses main.
  it('refuses every spelling of a commit or push hook bypass', () => {
    const skip = ['--no', 'verify'].join('-');
    for (const command of [
      `git commit -nm example`, `git commit -anm example`, `git commit -an -m example`,
      `git commit ${skip.slice(0, -2)} -m example`, `git commit ${skip.slice(0, -3)} -m example`, `git commit ${skip}=true -m example`,
      `git push ${skip}`, `git push ${skip.slice(0, -1)} origin HEAD`, `git push origin HEAD ${skip}`,
      `git status && git commit -nm example`
    ]) expect(run(event(command)).status, command).toBe(2);
  });
  it('does not mistake commit message text or other options for a hook bypass', () => {
    for (const command of [
      'git commit -m "fix -n handling"', "git commit -m 'drop --no-verify from docs'", 'git commit -am example',
      'git commit -m example -m "second -n paragraph"', 'git commit --no-edit', 'git push -n origin HEAD', 'git push --dry-run origin HEAD'
    ]) expect(run(event(command)).status, command).toBe(0);
  });
});
