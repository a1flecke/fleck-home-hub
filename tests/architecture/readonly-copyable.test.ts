import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, it } from 'vitest';

// Real browsers mask `type="password"` inputs and block clipboard copy from them, so a
// readonly input rendered to let the user copy a one-time link or code must never use
// `type="password"`.
const readonlyPasswordInput = /<input\b[^>]*\b(?:type=["']password["'][^>]*\breadonly\b|\breadonly\b[^>]*\btype=["']password["'])[^>]*>/i;

export function readonlyPasswordInputs(files: Record<string, string>): string[] {
  return Object.entries(files)
    .filter(([, text]) => readonlyPasswordInput.test(text))
    .map(([path]) => path)
    .sort();
}

function svelteSources(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) Object.assign(out, svelteSources(path));
    else if (name.endsWith('.svelte')) out[relative(process.cwd(), path)] = readFileSync(path, 'utf8');
  }
  return out;
}

it('no Svelte component renders a readonly password input that blocks copying', () => {
  expect(readonlyPasswordInputs(svelteSources('src'))).toEqual([]);
});

it('detects readonly password inputs regardless of attribute order (negative fixtures)', () => {
  expect(readonlyPasswordInputs({
    'src/a.svelte': '<input type="password" readonly value={link} />',
    'src/b.svelte': '<input readonly class="x" type="password" value={link} />',
    'src/ok-copy.svelte': '<input type="text" readonly value={link} />',
    'src/ok-secret.svelte': '<input type="password" name="password" required />'
  })).toEqual(['src/a.svelte', 'src/b.svelte']);
});
