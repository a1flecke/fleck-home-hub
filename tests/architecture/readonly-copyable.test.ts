import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, it } from 'vitest';

// Real browsers mask `type="password"` inputs and block clipboard copy from them, so a
// readonly input rendered to let the user copy a one-time link or code must never use
// `type="password"`.
// Likewise, a reactive `value={...}` attribute on a readonly input makes Svelte reassign
// `input.value` during hydration, which collapses an active text selection before the user
// can press Copy; use `defaultValue={...}` instead.
const readonlyInputTag = /<input\b[^>]*\breadonly\b[^>]*>/gi;
const passwordType = /\btype=["']password["']/i;
const reactiveValue = /(?:^|\s)value=\{/;

export function readonlyPasswordInputs(files: Record<string, string>): string[] {
  return Object.entries(files)
    .filter(([, text]) => [...text.matchAll(readonlyInputTag)].some(match => passwordType.test(match[0])))
    .map(([path]) => path)
    .sort();
}

export function readonlyReactiveValueInputs(files: Record<string, string>): string[] {
  return Object.entries(files)
    .filter(([, text]) => [...text.matchAll(readonlyInputTag)].some(match => reactiveValue.test(match[0])))
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

it('no Svelte component uses reactive value={...} on a readonly input that collapses selection on hydration', () => {
  expect(readonlyReactiveValueInputs(svelteSources('src'))).toEqual([]);
});

it('detects readonly password and reactive-value inputs (negative fixtures)', () => {
  expect(readonlyPasswordInputs({
    'src/a.svelte': '<input type="password" readonly defaultValue={link} />',
    'src/b.svelte': '<input readonly class="x" type="password" defaultValue={link} />',
    'src/ok-copy.svelte': '<input type="text" readonly defaultValue={link} />',
    'src/ok-secret.svelte': '<input type="password" name="password" required />'
  })).toEqual(['src/a.svelte', 'src/b.svelte']);

  expect(readonlyReactiveValueInputs({
    'src/bad.svelte': '<input type="text" readonly value={link} />',
    'src/ok.svelte': '<input type="text" readonly defaultValue={link} />'
  })).toEqual(['src/bad.svelte']);
});
