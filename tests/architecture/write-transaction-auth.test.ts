import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, it } from 'vitest';

// Every SQLite immediate write transaction in server services must check active membership
// (or an audited non-member credential such as a setup code) inside the transaction itself,
// rather than relying on an earlier check before the writer lock is acquired.
// Likewise, inactive recurring series visibility checks must anchor to `paused_on` rather than
// comparing `o.scheduled_date >= ?` (today), which resurrects paused occurrences the next day.
const authMarkers = /\b(authorize|requireParent|requireMember|member|parent|membership|validateSeries|mealIngredients)\s*\(|\bactive_membership\b/;
const preTxAuthMarkers = /\b(authorize|requireParent|requireMember|member|parent|membership|mealIngredients)\s*\(/;
const allowedWithoutMemberAuth = new Set([
  // Host-only first-run setup code issuance runs before any household or membership exists.
  'src/lib/server/setup-code.ts:issueSetupCode'
]);
const allowedPreTxAuth = new Set([
  // Async password hashing runs before the writer lock; membership is rechecked inside .immediate().
  'src/lib/server/managed-children.ts:setChildSignIn'
]);
const rawPausedDateCheck = /r\.state\s*!=\s*'active'[^)\n]*o\.scheduled_date\s*>=\s*\?/;

function extractExportedFunctions(source: string): Array<{ name: string; body: string }> {
  const results: Array<{ name: string; body: string }> = [];
  const header = /export\s+(?:async\s+)?function\s+(\w+)\s*\(/g;
  for (const match of source.matchAll(header)) {
    const name = match[1];
    let index = match.index! + match[0].length;
    let parens = 1;
    while (index < source.length && parens > 0) {
      if (source[index] === '(') parens++;
      else if (source[index] === ')') parens--;
      index++;
    }
    const open = source.indexOf('{', index);
    if (open < 0) continue;
    let depth = 1;
    let end = open + 1;
    while (end < source.length && depth > 0) {
      if (source[end] === '{') depth++;
      else if (source[end] === '}') depth--;
      end++;
    }
    results.push({ name, body: source.slice(open, end) });
  }
  return results;
}

function extractImmediateBlocks(body: string): Array<{ before: string; inside: string }> {
  const blocks: Array<{ before: string; inside: string }> = [];
  const marker = 'db.transaction(';
  let searchFrom = 0;
  while (true) {
    const start = body.indexOf(marker, searchFrom);
    if (start < 0) break;
    let index = start + marker.length;
    let parens = 1;
    while (index < body.length && parens > 0) {
      if (body[index] === '(') parens++;
      else if (body[index] === ')') parens--;
      index++;
    }
    const after = body.slice(index, index + 20);
    if (/^\s*\.immediate\s*\(\s*\)/.test(after)) {
      blocks.push({ before: body.slice(0, start), inside: body.slice(start + marker.length, index - 1) });
    }
    searchFrom = index;
  }
  return blocks;
}

export function immediateTransactionFindings(files: Record<string, string>): string[] {
  const findings: string[] = [];
  for (const [path, text] of Object.entries(files)) {
    for (const fn of extractExportedFunctions(text)) {
      const key = `${path}:${fn.name}`;
      const blocks = extractImmediateBlocks(fn.body);
      if (!blocks.length) continue;
      for (const block of blocks) {
        if (!allowedWithoutMemberAuth.has(key) && !authMarkers.test(block.inside)) {
          findings.push(`${key}: immediate transaction lacks an in-transaction membership check`);
        }
        if (!allowedPreTxAuth.has(key) && preTxAuthMarkers.test(block.before)) {
          findings.push(`${key}: performs authorization before db.transaction(...).immediate()`);
        }
      }
    }
  }
  return findings.sort();
}

export function rawPausedVisibilityFindings(files: Record<string, string>): string[] {
  return Object.entries(files)
    .filter(([, text]) => rawPausedDateCheck.test(text))
    .map(([path]) => path)
    .sort();
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

it('every immediate write transaction checks membership inside the writer lock', () => {
  expect(immediateTransactionFindings(sources('src/lib/server'))).toEqual([]);
});

it('inactive recurring chore visibility queries anchor to paused_on rather than today', () => {
  expect(rawPausedVisibilityFindings(sources('src'))).toEqual([]);
});

it('detects authorization outside an immediate transaction and unanchored paused visibility (negative fixtures)', () => {
  const preAuthOnly = `
    export function badWrite(db: any, actor: string, household: string) {
      authorize(db, actor, household, true);
      return db.transaction(() => {
        db.prepare('INSERT INTO x VALUES (1)').run();
      }).immediate();
    }
  `;
  const goodWrite = `
    export function goodWrite(db: any, actor: string, household: string) {
      return db.transaction(() => {
        authorize(db, actor, household, true);
        db.prepare('INSERT INTO x VALUES (1)').run();
      }).immediate();
    }
  `;
  expect(immediateTransactionFindings({ 'src/lib/server/bad.ts': preAuthOnly, 'src/lib/server/good.ts': goodWrite })).toEqual([
    'src/lib/server/bad.ts:badWrite: immediate transaction lacks an in-transaction membership check',
    'src/lib/server/bad.ts:badWrite: performs authorization before db.transaction(...).immediate()'
  ]);

  expect(rawPausedVisibilityFindings({
    'src/lib/server/bad.ts': "NOT (r.state IS NOT NULL AND r.state != 'active' AND c.status = 'todo' AND o.scheduled_date >= ?)",
    'src/lib/server/good.ts': "NOT (r.state IS NOT NULL AND r.state != 'active' AND c.status = 'todo' AND o.scheduled_date >= COALESCE(r.paused_on, ?))"
  })).toEqual(['src/lib/server/bad.ts']);
});
