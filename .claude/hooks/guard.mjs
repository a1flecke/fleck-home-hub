import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const deny = message => { console.error(message); process.exit(2); };
try {
  const event = JSON.parse(readFileSync(0, 'utf8'));
  if (event.hook_event_name !== 'PreToolUse' || event.tool_name !== 'Bash' || typeof event.tool_input?.command !== 'string' || typeof event.cwd !== 'string') deny('Invalid Claude hook payload');
  const command = event.tool_input.command;
  if (/\b(?:pkill|killall)\b|\bgh\s+repo\s+delete\b|\bgit\s+reset\s+[^\n]*--hard\b|\bgit\s+clean\b|\bgit\s+push\s+[^\n]*(?:--force|--delete|\s\+|\s:)|\brm\s+-[a-zA-Z]*[rf][a-zA-Z]*/.test(command)) deny('Blocked dangerous operation; use a reviewed safe workflow');
  if (/\bgit\s+commit\b/.test(command)) {
    const result = spawnSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: event.cwd, encoding: 'utf8' });
    if (result.status !== 0 || ['main', 'master'].includes(result.stdout.trim())) deny('Commits require a feature branch');
  }
  if (/\b(?:tailscale|deploy|gh\s+pr\s+merge)\b|\.config\/(?:opencode|gh)\b|\.env(?:\.|\b)/.test(command)) {
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: 'Sensitive operation requires human review' } }));
  }
} catch {
  deny('Unable to parse or evaluate Claude hook payload');
}
