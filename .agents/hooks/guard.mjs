import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const respond = (decision, reason) => {
  const payload = reason ? { decision, reason } : { decision };
  console.log(JSON.stringify(payload));
  process.exit(0);
};

// Always emit an explicit decision. Never emit `auto_approve`; `allow` delegates to native policy.
const allow = () => respond('allow');
const deny = reason => respond('deny', reason);
const ask = reason => respond('ask', reason);
const forceAsk = reason => respond('force_ask', reason);

// Shell words per simple command, keeping quoted text whole so commit/review text is not split.
const commands = text => text.split(/&&|\|\||[;|\n]/).map(part => [...part.matchAll(/"(?:\\.|[^"\\])*"|'[^']*'|[^\s"']+/g)].map(match => match[0]));
const stripQuotes = word => {
  if (word.length >= 2 && word.startsWith("'") && word.endsWith("'")) return word.slice(1, -1);
  if (word.length >= 2 && word.startsWith('"') && word.endsWith('"')) return word.slice(1, -1).replace(/\\(["\\$`])/g, '$1');
  return word;
};
const findBinary = (words, binary) => words.findIndex(word => basename(stripQuotes(word)) === binary);

const gitGlobalValueFlags = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env', '--exec-path']);
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

/** Match Git option parsing (including quoted options, clustered short options and unambiguous long prefixes). */
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
    // Positional args: remote (index 0), then refspecs (index >= 1).
    if (positionalIndex >= 1 && (word.startsWith('+') || word.startsWith(':'))) return true;
    positionalIndex++;
  }
  return false;
}

function mergesPr(words) {
  const at = findBinary(words, 'gh');
  return at >= 0 && stripQuotes(words[at + 1] ?? '') === 'pr' && stripQuotes(words[at + 2] ?? '') === 'merge';
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

function isSensitiveFile(filePath, cwd) {
  const normalized = resolve(cwd, filePath).replaceAll('\\', '/');
  const name = basename(normalized);
  if (/^\.env(?:\.|$)/i.test(name) && name !== '.env.example') return true;
  if (/\.(?:sqlite3?|db)(?:-(?:wal|shm|journal))?$/i.test(name)) return true;
  if (/\.(?:pem|key|p12|pfx|age)$/i.test(name)) return true;
  if (/^hub\.conf$/i.test(name)) return true;
  if (/\/\.config\/opencode\/service\.json$/i.test(normalized)) return true;
  return false;
}

function isGlobalAgentConfig(filePath, cwd) {
  const target = resolve(cwd, filePath).replaceAll('\\', '/');
  const repoRoot = resolve(cwd).replaceAll('\\', '/');
  if (target === repoRoot || target.startsWith(`${repoRoot}/`)) return false;
  if (/\/\.gemini\/antigravity\/brain\//.test(target)) return false;
  return (
    /\/\.config\/opencode(?:\/|$)/.test(target) ||
    /\/\.gemini\/(?:config(?:\/|$)|antigravity-cli(?:\/|$)|settings\.json$|GEMINI\.md$|AGENTS\.md$)/.test(target) ||
    /\/\.claude(?:\/|$)/.test(target) ||
    /\/\.codex(?:\/|$)/.test(target)
  );
}

const readTools = new Set(['read_file', 'view_file']);
const writeTools = new Set(['edit_file', 'write_file', 'write_to_file', 'replace_file_content', 'multi_replace_file_content']);

try {
  const event = JSON.parse(readFileSync(0, 'utf8'));
  const toolName = event?.toolCall?.name;
  const args = event?.toolCall?.args;
  if (event?.hookEventName !== 'PreToolUse' || typeof toolName !== 'string' || !args || typeof args !== 'object' || typeof event?.cwd !== 'string') {
    deny('Invalid Antigravity hook payload');
  }

  if (toolName === 'run_command') {
    const command = args.CommandLine;
    if (typeof command !== 'string') deny('Invalid Antigravity run_command payload');
    const parsedCommands = commands(command);
    if (parsedCommands.some(skipsGitHooks)) deny('Do not bypass Git verification hooks');
    if (parsedCommands.some(approvesPr)) deny('Agents must never approve pull requests');
    if (parsedCommands.some(dangerousGitPush)) deny('Blocked dangerous operation; use a reviewed safe workflow');
    if (/\b(?:pkill|killall|sudo)\b|\bgh\s+repo\s+delete\b|\bgit\s+reset\s+[^\n]*--hard\b|\bgit\s+clean\b|\brm\s+-[a-zA-Z]*[rf][a-zA-Z]*/.test(command)) {
      deny('Blocked dangerous operation; use a reviewed safe workflow');
    }
    if (parsedCommands.some(mergesPr)) {
      forceAsk('Merging a pull request requires explicit user authorization and green required checks');
    }
    if (/\bgit\s+push\b[^\n]*--force-with-lease\b/.test(command)) {
      forceAsk('Feature-branch rewrites require human review and an explicit expected commit');
    }
    if (/\bgit\s+(?:-C|-c|--git-dir|--work-tree)(?:\s|=)/.test(command) || /\bcd\s+[^\n]*\bgit\s+commit\b/.test(command)) {
      ask('Git context or configuration changes require human review');
    }
    if (/\bgit\s+branch\b[^\n]*(?:\s-[dD]\b|\s--delete\b)/.test(command)) {
      ask('Branch deletion requires human review');
    }
    if (parsedCommands.some(words => gitSubcommand(words)?.subcommand === 'commit')) {
      const result = spawnSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: event.cwd, encoding: 'utf8' });
      if (result.status !== 0 || ['main', 'master'].includes(result.stdout.trim())) {
        deny('Commits require a feature branch');
      }
    }
    if (/\b(?:tailscale|deploy)\b|(?:^|[\s"'=/~])\.config\/(?:opencode|gh)(?:\/|$|\b)|(?:^|[\s"'=/~])\.gemini\/(?:config|settings\.json|GEMINI\.md|AGENTS\.md|antigravity-cli)(?:\/|$|\b)|(?:~|\$HOME|\/Users\/[^/\s"']+|\/home\/[^/\s"']+)\/\.(?:claude|codex)(?:\/|$|\b)|(?:^|[\s"'=/~])hub\.conf(?:\b|$)|(?:^|[\s"'=/~])\.env(?!\.example\b)(?:\.|\b)|\.(?:sqlite3?|db)(?:-(?:wal|shm|journal))?(?:\b|$)|\.(?:age|pem|key|p12|pfx)(?:\b|$)/i.test(command)) {
      forceAsk('Sensitive operation requires human review');
    }
    allow();
  }

  if (readTools.has(toolName)) {
    const filePath = args.Path ?? args.AbsolutePath;
    if (typeof filePath !== 'string') deny('Invalid Antigravity file read payload');
    if (isSensitiveFile(filePath, event.cwd)) deny('Refusing to read private household data or credentials');
    allow();
  }

  if (writeTools.has(toolName)) {
    const filePath = args.Path ?? args.TargetFile;
    if (typeof filePath !== 'string') deny('Invalid Antigravity file write payload');
    if (isSensitiveFile(filePath, event.cwd)) deny('Refusing to write private household data or credentials');
    if (isGlobalAgentConfig(filePath, event.cwd)) forceAsk('Modifying global agent configuration requires human review');
    allow();
  }

  deny(`Unsupported tool in Antigravity guard hook: ${toolName}`);
} catch {
  deny('Unable to parse or evaluate Antigravity hook payload');
}
