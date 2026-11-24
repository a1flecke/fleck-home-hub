import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.argv[2] || '.');
const read = path => readFileSync(join(root, path), 'utf8');
const problems = [];
const runner = 'pnpm (?:exec )?vitest run \\*|pnpm exec playwright test \\*|pnpm exec svelte-kit sync|pnpm run (?:test|e2e|lint|typecheck|build) \\*';
const namedTaskAllow = new RegExp(`^(?:mise run (?:test|e2e|typecheck|lint|build|verify|doctor|agent-policy)(?: \\*)?|(?:\\./scripts/run-with-mise\\.sh )?(?:${runner}))$`);
const unsafeBuildAllow = x => x.effect === 'allow' && (x.action === 'shell' ? x.resource === '*' || (/^(?:sh|bash|zsh|env|xargs|eval|exec|sudo|rm|mise|pnpm|\.\/scripts\/run-with-mise\.sh)\b/.test(x.resource) && !namedTaskAllow.test(x.resource)) : /[*?]/.test(x.action));
try {
  const shared = read('AGENTS.md');
  const claude = read('CLAUDE.md');
  const gemini = read('GEMINI.md');
  const config = JSON.parse(read('.opencode/opencode.jsonc').replace(/^\s*\/\/.*$/gm, ''));
  const antigravityHooks = JSON.parse(read('.agents/hooks.json'));
  const mise = read('mise.toml');
  const pkg = JSON.parse(read('package.json'));
  const surfaces = [['AGENTS.md', shared], ['CLAUDE.md', claude], ['GEMINI.md', gemini]];
  for (const dir of ['.claude/rules', '.opencode/commands', '.agents/rules']) {
    if (existsSync(join(root, dir))) for (const file of readdirSync(join(root, dir)).filter(x => x.endsWith('.md'))) surfaces.push([`${dir}/${file}`, read(`${dir}/${file}`)]);
  }
  const skillsDir = join(root, '.agents/skills');
  if (existsSync(skillsDir)) {
    for (const entry of readdirSync(skillsDir, { withFileTypes: true }).filter(x => x.isDirectory())) {
      const relPath = `.agents/skills/${entry.name}/SKILL.md`;
      if (!existsSync(join(root, relPath))) { problems.push(`${relPath}: missing SKILL.md`); continue; }
      const text = read(relPath);
      surfaces.push([relPath, text]);
      const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      const name = frontmatter?.[1].match(/^name:\s*(.+)$/m)?.[1].trim().replace(/^["']|["']$/g, '');
      const description = frontmatter?.[1].match(/^description:\s*(.+)$/m)?.[1].trim();
      if (name !== entry.name || !description) problems.push(`${relPath}: frontmatter must declare matching name and non-empty description`);
    }
  }
  if (!claude.includes('AGENTS.md')) problems.push('CLAUDE.md must reference shared policy');
  if (!gemini.includes('AGENTS.md')) problems.push('GEMINI.md must reference shared policy');
  if (!/never merge or approve/i.test(shared) || !/force-push a protected branch/i.test(shared) || !/--force-with-lease=<full-ref>:<reviewed-remote-commit>/.test(shared)) problems.push('Missing shared merge or feature-branch lease policy');
  if (!/^pnpm@\d+\.\d+\.\d+$/.test(pkg.packageManager)) problems.push('packageManager must pin pnpm');
  const enabledHooks = Object.values(antigravityHooks && typeof antigravityHooks === 'object' ? antigravityHooks : {}).filter(entry => entry && typeof entry === 'object' && entry.enabled !== false);
  const preToolUseGroups = enabledHooks.flatMap(entry => (Array.isArray(entry.PreToolUse) ? entry.PreToolUse : []));
  const guardGroup = preToolUseGroups.find(group => {
    if (typeof group?.matcher !== 'string' || !Array.isArray(group.hooks)) return false;
    try {
      const re = new RegExp(`^(?:${group.matcher})$`);
      return re.test('run_command') && re.test('read_file') && re.test('write_file');
    } catch { return false; }
  });
  const guardCommand = guardGroup?.hooks?.find(h => (h?.type ?? 'command') === 'command' && typeof h?.command === 'string')?.command;
  const guardScriptMatch = guardCommand?.match(/(\.\/[^\s"']+\.(?:mjs|js|sh))/);
  if (!guardGroup || !guardScriptMatch || !existsSync(join(root, '.agents', guardScriptMatch[1]))) {
    problems.push('Antigravity .agents/hooks.json must enable a PreToolUse guard hook matching run_command, read_file, and write_file with an existing script');
  }
  if (config.share !== 'disabled') problems.push('OpenCode sharing must be disabled');
  if (!Array.isArray(config.permissions) || !config.permissions.some(x => x.action === 'shell' && x.resource === '*' && x.effect === 'ask') || config.permissions.some(x => x.effect === 'allow' && (x.action === 'shell' || /[*?]/.test(x.action)))) problems.push('OpenCode project shell rules must default to ask; wildcard action allows are forbidden');
  const build = config.agents?.build?.permissions ?? [];
  if (!Array.isArray(build) || build.some(unsafeBuildAllow)) problems.push('OpenCode build agent must not allow a shell-wide wildcard, an interpreter or a command runner');
  for (const resource of ['gh pr merge *', 'git push --force *', 'git reset --hard *', 'git clean *']) if (build.findLast(x => x.action === 'shell' && x.resource === resource)?.effect !== 'deny') problems.push(`Build agent must finally deny: ${resource}`);
  // Skipping Git hooks bypasses the commit secret guard and the pre-push verification.
  for (const resource of ['git commit *--no-ver*', 'git push *--no-ver*']) if (build.findLast(x => x.action === 'shell' && x.resource === resource)?.effect !== 'deny') problems.push(`Build agent must finally deny: ${resource}`);
  for (const resource of ['shell:gh pr merge *', 'shell:git push --force *', 'shell:git commit *--no-ver*', 'shell:git push *--no-ver*']) if (!config.policies?.some(x => x.action === 'tool.use' && x.resource === resource && x.effect === 'deny')) problems.push(`Missing hard deny: ${resource}`);
  for (const [path, text] of surfaces) {
    if ((path.startsWith('.opencode/commands/') || path.startsWith('.agents/skills/')) && !text.includes('AGENTS.md')) problems.push(`${path}: missing shared policy reference`);
    if (/(?:^|\s)(?:npm|yarn)\s+(?:install|run|test|build)\b/m.test(text)) problems.push(`${path}: conflicting package manager`);
    for (const match of text.matchAll(/\bmise run ([\w:-]+)/g)) {
      if (!new RegExp(`^\\[tasks\\.(?:"${match[1]}"|${match[1]})\\]$`, 'm').test(mise)) problems.push(`${path}: missing mise task ${match[1]}`);
    }
    for (const match of text.matchAll(/\bscripts\/[\w./-]+\.(?:sh|mjs|ts)\b/g)) if (!existsSync(join(root, match[0]))) problems.push(`${path}: missing ${match[0]}`);
  }
} catch {
  problems.push('Missing or invalid policy configuration');
}
if (problems.length) { for (const problem of problems) console.error(problem); process.exitCode = 1; }
else console.log('Agent policy invariants pass');
