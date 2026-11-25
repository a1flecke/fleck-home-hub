import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { spawnSync } from 'node:child_process';

const deny = message => { console.error(message); process.exit(2); };
const ask = message => { console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: message } })); process.exit(0); };

// Shell words per simple command, keeping quoted text whole so a commit message is never split.
const commands = text => text.split(/&&|\|\||[;|\n]/).map(part => [...part.matchAll(/"(?:\\.|[^"\\])*"|'[^']*'|[^\s"']+/g)].map(match => match[0]));
const stripQuotes = word => {
  if (word.length >= 2 && word.startsWith("'") && word.endsWith("'")) return word.slice(1, -1);
  if (word.length >= 2 && word.startsWith('"') && word.endsWith('"')) return word.slice(1, -1).replace(/\\(["\\$`])/g, '$1');
  return word;
};
const findBinary = (words, binary) => words.findIndex(word => basename(stripQuotes(word)) === binary);

const gitGlobalValueFlags = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env', '--exec-path']);
// Short options whose value follows (rest of the cluster or the next word), and long ones that take a separate value.
const valueShort = { commit: new Set(['m', 'F', 'c', 'C', 't']), push: new Set(['o']) };
const valueLong = /^--(?:message|file|reuse-message|reedit-message|template|push-option|repo|receive-pack|exec)$/;

function gitSubcommand(words) {
  const at = findBinary(words, 'git');
  if (at < 0) return null;
  let index = at + 1;
  while (index < words.length) {
    const word = stripQuotes(words[index]);
    if (!word.startsWith('-')) break;
    index += gitGlobalValueFlags.has(word) ? 2 : 1;
  }
  if (index >= words.length) return null;
  return { subcommand: stripQuotes(words[index]), nextIndex: index + 1 };
}

/** Git accepts quoted options, clustered short options (-nm) and unambiguous long prefixes (--no-veri), so match how Git parses. */
function skipsGitHooks(words) {
  const parsed = gitSubcommand(words);
  if (!parsed || (parsed.subcommand !== 'commit' && parsed.subcommand !== 'push')) return false;
  const { subcommand, nextIndex } = parsed;
  for (let next = nextIndex; next < words.length; next++) {
    const word = stripQuotes(words[next]);
    if (word === '--') break;
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

function dangerousGitPush(words) {
  const parsed = gitSubcommand(words);
  if (!parsed || parsed.subcommand !== 'push') return false;
  let afterDoubleDash = false;
  let positionalIndex = 0;
  for (let next = parsed.nextIndex; next < words.length; next++) {
    const word = stripQuotes(words[next]);
    if (!afterDoubleDash && word === '--') { afterDoubleDash = true; continue; }
    if (!afterDoubleDash && word.startsWith('-')) {
      if (word === '--force' || word.startsWith('--force=') || word === '--delete' || word === '--tags' || word === '--mirror') return true;
      if (valueLong.test(word)) { next++; continue; }
      if (/^-[A-Za-z]+$/.test(word)) {
        const flags = [...word.slice(1)];
        for (const [position, flag] of flags.entries()) {
          if (flag === 'f' || flag === 'd') return true;
          if (valueShort.push.has(flag)) { if (position === flags.length - 1) next++; break; }
        }
      }
      continue;
    }
    if (positionalIndex >= 1 && (word.startsWith('+') || word.startsWith(':'))) return true;
    positionalIndex++;
  }
  return false;
}

function approvesPr(words) {
  const at = findBinary(words, 'gh');
  if (at < 0 || stripQuotes(words[at + 1] ?? '') !== 'pr' || stripQuotes(words[at + 2] ?? '') !== 'review') return false;
  const reviewValueLong = /^--(?:body|body-file|repo)$/;
  const reviewValueShort = new Set(['b', 'F', 'R']);
  for (let next = at + 3; next < words.length; next++) {
    const word = stripQuotes(words[next]);
    if (word === '--') break;
    if (word === '--approve' || word.startsWith('--approve=')) return true;
    if (reviewValueLong.test(word)) { next++; continue; }
    if (!/^-[A-Za-z]+$/.test(word)) continue;
    const flags = [...word.slice(1)];
    for (const [position, flag] of flags.entries()) {
      if (flag === 'a') return true;
      if (reviewValueShort.has(flag)) { if (position === flags.length - 1) next++; break; }
    }
  }
  return false;
}

function mergesPr(words) {
  const at = findBinary(words, 'gh');
  return at >= 0 && stripQuotes(words[at + 1] ?? '') === 'pr' && stripQuotes(words[at + 2] ?? '') === 'merge';
}

try {
  const event = JSON.parse(readFileSync(0, 'utf8'));
  if (event.hook_event_name !== 'PreToolUse' || event.tool_name !== 'Bash' || typeof event.tool_input?.command !== 'string' || typeof event.cwd !== 'string') deny('Invalid Claude hook payload');
  const command = event.tool_input.command;
  const parsedCommands = commands(command);
  if (parsedCommands.some(skipsGitHooks)) deny('Do not bypass Git verification hooks');
  if (parsedCommands.some(approvesPr)) deny('Agents must never approve pull requests');
  if (parsedCommands.some(dangerousGitPush)) deny('Blocked dangerous operation; use a reviewed safe workflow');
  if (/\b(?:pkill|killall|sudo)\b|\bgh\s+repo\s+delete\b|\bgit\s+reset\s+[^\n]*--hard\b|\bgit\s+clean\b|\brm\s+-[a-zA-Z]*[rf][a-zA-Z]*/.test(command)) deny('Blocked dangerous operation; use a reviewed safe workflow');
  if (parsedCommands.some(mergesPr)) ask('Merging a pull request requires explicit user authorization and green required checks');
  if (/\bgit\s+push\b[^\n]*--force-with-lease\b/.test(command)) ask('Feature-branch rewrites require human review and an explicit expected commit');
  if (/\bgit\s+(?:-C|-c|--git-dir|--work-tree)(?:\s|=)/.test(command) || /\bcd\s+[^\n]*\bgit\s+commit\b/.test(command)) ask('Git context or configuration changes require human review');
  if (/\bgit\s+branch\b[^\n]*(?:\s-[dD]\b|\s--delete\b)/.test(command)) ask('Branch deletion requires human review');
  if (parsedCommands.some(words => gitSubcommand(words)?.subcommand === 'commit')) {
    const result = spawnSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: event.cwd, encoding: 'utf8' });
    if (result.status !== 0 || ['main', 'master'].includes(result.stdout.trim())) deny('Commits require a feature branch');
  }
  if (/\b(?:tailscale|deploy)\b|(?:^|[\s"'=/~])\.config\/(?:opencode|gh)(?:\/|$|\b)|(?:^|[\s"'=/~])\.gemini\/(?:config|settings\.json|GEMINI\.md|AGENTS\.md|antigravity-cli)(?:\/|$|\b)|(?:~|\$HOME|\/Users\/[^/\s"']+|\/home\/[^/\s"']+)\/\.(?:claude|codex)(?:\/|$|\b)|(?:^|[\s"'=/~])hub\.conf(?:\b|$)|(?:^|[\s"'=/~])\.env(?!\.example\b)(?:\.|\b)|\.(?:sqlite3?|db)(?:-(?:wal|shm|journal))?(?:\b|$)|\.(?:age|pem|key|p12|pfx)(?:\b|$)/i.test(command)) {
    ask('Sensitive operation requires human review');
  }
} catch {
  deny('Unable to parse or evaluate Claude hook payload');
}
