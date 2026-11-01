import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.argv[2] || '.');
const read = path => readFileSync(join(root, path), 'utf8');
const problems = [];
const namedTaskAllow = /^(?:mise run (?:test|e2e|typecheck|lint|build|verify|doctor|agent-policy)(?: \*)?|pnpm (?:exec )?vitest run \*|pnpm exec playwright test \*|pnpm exec svelte-kit sync)$/;
const unsafeBuildAllow = x => x.effect === 'allow' && (x.action === 'shell' ? x.resource === '*' || (/^(?:sh|bash|zsh|env|xargs|eval|exec|sudo|rm|mise|pnpm|\.\/scripts\/run-with-mise\.sh)\b/.test(x.resource) && !namedTaskAllow.test(x.resource)) : /[*?]/.test(x.action));
try {
  const shared = read('AGENTS.md');
  const claude = read('CLAUDE.md');
  const config = JSON.parse(read('.opencode/opencode.jsonc').replace(/^\s*\/\/.*$/gm, ''));
  const mise = read('mise.toml');
  const pkg = JSON.parse(read('package.json'));
  const surfaces = [['AGENTS.md', shared], ['CLAUDE.md', claude]];
  for (const dir of ['.claude/rules', '.opencode/commands']) {
    if (existsSync(join(root, dir))) for (const file of readdirSync(join(root, dir)).filter(x => x.endsWith('.md'))) surfaces.push([`${dir}/${file}`, read(`${dir}/${file}`)]);
  }
  if (!claude.includes('AGENTS.md')) problems.push('CLAUDE.md must reference shared policy');
  if (!/never merge or approve/i.test(shared) || !/force-push a protected branch/i.test(shared) || !/--force-with-lease=<full-ref>:<reviewed-remote-commit>/.test(shared)) problems.push('Missing shared merge or feature-branch lease policy');
  if (!/^pnpm@\d+\.\d+\.\d+$/.test(pkg.packageManager)) problems.push('packageManager must pin pnpm');
  if (config.share !== 'disabled') problems.push('OpenCode sharing must be disabled');
  if (!Array.isArray(config.permissions) || !config.permissions.some(x => x.action === 'shell' && x.resource === '*' && x.effect === 'ask') || config.permissions.some(x => x.effect === 'allow' && (x.action === 'shell' || /[*?]/.test(x.action)))) problems.push('OpenCode project shell rules must default to ask; wildcard action allows are forbidden');
  const build = config.agents?.build?.permissions ?? [];
  if (!Array.isArray(build) || build.some(unsafeBuildAllow)) problems.push('OpenCode build agent must not allow a shell-wide wildcard, an interpreter or a command runner');
  for (const resource of ['gh pr merge *', 'git push --force *', 'git reset --hard *', 'git clean *']) if (build.findLast(x => x.action === 'shell' && x.resource === resource)?.effect !== 'deny') problems.push(`Build agent must finally deny: ${resource}`);
  for (const resource of ['shell:gh pr merge *', 'shell:git push --force *']) if (!config.policies?.some(x => x.action === 'tool.use' && x.resource === resource && x.effect === 'deny')) problems.push(`Missing hard deny: ${resource}`);
  for (const [path, text] of surfaces) {
    if (path.startsWith('.opencode/commands/') && !text.includes('AGENTS.md')) problems.push(`${path}: missing shared policy reference`);
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
