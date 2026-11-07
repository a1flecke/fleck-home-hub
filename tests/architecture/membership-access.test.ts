import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, it } from 'vitest';

// A direct read of `membership` ignores `disabled_at`, so a disabled member would stay authorized.
// Only household-access.ts (explicit all-state listing and the disable write) and the creation
// paths that INSERT a new row may name the table; everything else reads `active_membership`.
const direct = /\b(FROM|JOIN|UPDATE|DELETE\s+FROM)\s+membership\b/i;
const allowed = new Set(['src/lib/server/household-access.ts']);

export function directMembershipUses(files: Record<string, string>) {
  return Object.entries(files).filter(([path, text]) => !allowed.has(path) && direct.test(text)).map(([path]) => path);
}

function sources(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) Object.assign(out, sources(path));
    else if (/\.(ts|js|svelte)$/.test(name)) out[relative(process.cwd(), path)] = readFileSync(path, 'utf8');
  }
  return out;
}

it('no application code reads or updates membership outside the access module', () => {
  expect(directMembershipUses(sources('src'))).toEqual([]);
});

it('detects a direct read that would bypass disabled membership (negative fixture)', () => {
  expect(directMembershipUses({ 'src/lib/server/new.ts': "db.prepare('SELECT role FROM membership WHERE user_id = ?')" })).toEqual(['src/lib/server/new.ts']);
  expect(directMembershipUses({ 'src/lib/server/new.ts': 'JOIN membership m ON m.user_id = x' })).toEqual(['src/lib/server/new.ts']);
  expect(directMembershipUses({ 'src/lib/server/ok.ts': 'FROM active_membership WHERE a' })).toEqual([]);
});
