import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const deny = message => { console.error(message); process.exit(2); };

// Shell words per simple command, with quoted text kept whole so a commit message is never read as options.
const commands = text => text.split(/&&|\|\||[;|\n]/).map(part => [...part.matchAll(/"(?:\\.|[^"\\])*"|'[^']*'|[^\s"']+/g)].map(match => match[0]));
// Short options whose value follows (rest of the cluster or the next word), and long ones that take a separate value.
const valueShort = { commit: new Set(['m', 'F', 'c', 'C', 't']), push: new Set(['o']) };
const valueLong = /^--(?:message|file|reuse-message|reedit-message|template|push-option|repo|receive-pack|exec)$/;

/** Git accepts clustered short options (-nm) and unambiguous long prefixes (--no-veri), so match how Git parses. */
function skipsGitHooks(words) {
  const at = words.indexOf('git');
  if (at < 0) return false;
  let index = at + 1;
  while (index < words.length && words[index].startsWith('-')) index += words[index] === '-C' || words[index] === '-c' ? 2 : 1;
  const subcommand = words[index];
  if (subcommand !== 'commit' && subcommand !== 'push') return false;
  for (let next = index + 1; next < words.length; next++) {
    const word = words[next];
    if (word === '--') break;
    if (/^["']/.test(word)) continue;
    if (/^--no-ver(?!b)/.test(word)) return true;
    if (valueLong.test(word)) { next++; continue; }
    if (!/^-[A-Za-z]+$/.test(word)) continue;
    const flags = [...word.slice(1)];
    for (const [position, flag] of flags.entries()) {
      if (subcommand === 'commit' && flag === 'n') return true;
      if (valueShort[subcommand].has(flag)) { if (position === flags.length - 1) next++; break; }
    }
  }
  return false;
}
const ask = message => { console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: message } })); process.exit(0); };
try {
  const event = JSON.parse(readFileSync(0, 'utf8'));
  if (event.hook_event_name !== 'PreToolUse' || event.tool_name !== 'Bash' || typeof event.tool_input?.command !== 'string' || typeof event.cwd !== 'string') deny('Invalid Claude hook payload');
  const command = event.tool_input.command;
  if (commands(command).some(skipsGitHooks)) deny('Do not bypass Git verification hooks');
  if (/\b(?:pkill|killall)\b|\bgh\s+repo\s+delete\b|\bgit\s+reset\s+[^\n]*--hard\b|\bgit\s+clean\b|\bgit\s+push\s+[^\n]*(?:--force(?!-with-lease)|--delete|\s\+|\s:)|\brm\s+-[a-zA-Z]*[rf][a-zA-Z]*/.test(command)) deny('Blocked dangerous operation; use a reviewed safe workflow');
  if (/\bgit\s+push\b[^\n]*--force-with-lease\b/.test(command)) ask('Feature-branch rewrites require human review and an explicit expected commit');
  if (/\bgit\s+(?:-C|-c|--git-dir|--work-tree)(?:\s|=)/.test(command) || /\bcd\s+[^\n]*\bgit\s+commit\b/.test(command)) ask('Git context or configuration changes require human review');
  if (/\bgit\s+commit\b/.test(command)) {
    const result = spawnSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: event.cwd, encoding: 'utf8' });
    if (result.status !== 0 || ['main', 'master'].includes(result.stdout.trim())) deny('Commits require a feature branch');
  }
  if (/\b(?:tailscale|deploy|gh\s+pr\s+merge)\b|\.config\/(?:opencode|gh)\b|\.env(?:\.|\b)/.test(command)) {
    ask('Sensitive operation requires human review');
  }
} catch {
  deny('Unable to parse or evaluate Claude hook payload');
}
