import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

// Guardrails for form-recovery hydration safety, chore-week filter preservation, and duplicate confirmation:
// 1. Editable `<input>` elements in `src/routes/` must not use reactive `value={form...}` (use
//    `defaultValue={...}` so restored values survive pre-hydration edits and active selection).
// 2. `/chores/week`'s jump-to-date GET form must preserve `child` and `status` filters, and
//    `create`/`edit` actions must redirect via `choreWeekReturnUrl(...)` with `{ dueDate, assigneeId }`.
// 3. `/groceries`'s `allowDuplicate` checkbox must not carry `required` (otherwise changing the
//    item name after a duplicate warning is blocked by native validation).

function walkSvelte(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkSvelte(full, acc);
    else if (full.endsWith('.svelte')) acc.push(full);
  }
  return acc;
}

export function reactiveFormValueFindings(files: Record<string, string>): string[] {
  const findings: string[] = [];
  for (const [path, source] of Object.entries(files)) {
    for (const match of source.matchAll(/<input\b[^>]*>/g)) {
      const tag = match[0];
      if (/type\s*=\s*["'](?:hidden|checkbox|radio|submit|button)["']/i.test(tag)) continue;
      if (/\bvalue\s*=\s*\{[^}]*\bform\b/.test(tag)) {
        findings.push(`${path}: editable <input> must use defaultValue instead of reactive value={form...}`);
      }
    }
  }
  return findings;
}

export function choreWeekContextFindings(pageSource: string, serverSource: string): string[] {
  const findings: string[] = [];
  const jumpForm = /<form\b[^>]*aria-label="Jump to a chore week"[^>]*>([\s\S]*?)<\/form>/.exec(pageSource)?.[1] ?? '';
  if (!/name="child"/.test(jumpForm) || !/name="status"/.test(jumpForm)) {
    findings.push('chores/week/+page.svelte Jump to a chore week GET form must carry hidden child and status inputs');
  }
  if (!/\bchoreWeekReturnUrl\s*\(\s*url\.searchParams\s*,\s*'updated'\s*,\s*\{/.test(serverSource)) {
    findings.push('chores/week/+page.server.ts edit action must redirect via choreWeekReturnUrl with target dueDate/assigneeId');
  }
  if (!/\bchoreWeekReturnUrl\s*\(\s*url\.searchParams\s*,\s*'created'\s*,\s*\{/.test(serverSource)) {
    findings.push('chores/week/+page.server.ts create action must redirect via choreWeekReturnUrl with target dueDate/assigneeId');
  }
  return findings;
}

export function duplicateConfirmFindings(groceriesSource: string): string[] {
  const findings: string[] = [];
  const input = /<input\b[^>]*name="allowDuplicate"[^>]*>/.exec(groceriesSource)?.[0];
  if (!input) return ['groceries/+page.svelte allowDuplicate checkbox not found'];
  if (/\brequired\b/.test(input)) {
    findings.push('groceries/+page.svelte allowDuplicate checkbox must not use HTML required (blocks changing item name)');
  }
  return findings;
}

it('enforces editable defaultValue restoration, chore-week filter preservation, and non-blocking duplicate confirmation', () => {
  const svelteFiles = Object.fromEntries(walkSvelte('src/routes').map((p) => [p, readFileSync(p, 'utf8')]));
  expect(reactiveFormValueFindings(svelteFiles)).toEqual([]);
  expect(choreWeekContextFindings(
    readFileSync('src/routes/chores/week/+page.svelte', 'utf8'),
    readFileSync('src/routes/chores/week/+page.server.ts', 'utf8')
  )).toEqual([]);
  expect(duplicateConfirmFindings(readFileSync('src/routes/groceries/+page.svelte', 'utf8'))).toEqual([]);
});

it('detects reactive form value, lost chore-week context, and required allowDuplicate regressions (negative fixtures)', () => {
  expect(reactiveFormValueFindings({
    'src/routes/bad/+page.svelte': '<input name="label" value={form.label} /><input type="hidden" name="id" value={form.id} />'
  })).toEqual([
    'src/routes/bad/+page.svelte: editable <input> must use defaultValue instead of reactive value={form...}'
  ]);

  expect(choreWeekContextFindings(
    '<form method="GET" aria-label="Jump to a chore week"><input name="date" /><button>Show week</button></form>',
    "redirect(303, returnTo(url, 'updated'));"
  )).toEqual([
    'chores/week/+page.svelte Jump to a chore week GET form must carry hidden child and status inputs',
    'chores/week/+page.server.ts edit action must redirect via choreWeekReturnUrl with target dueDate/assigneeId',
    'chores/week/+page.server.ts create action must redirect via choreWeekReturnUrl with target dueDate/assigneeId'
  ]);

  expect(duplicateConfirmFindings('<input type="checkbox" name="allowDuplicate" value="yes" required />')).toEqual([
    'groceries/+page.svelte allowDuplicate checkbox must not use HTML required (blocks changing item name)'
  ]);
});
