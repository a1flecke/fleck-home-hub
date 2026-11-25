import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// Guardrails for chore reuse idempotency and weekly chore board filtering:
// 1. createReuseBatch must validate/normalize the request payload BEFORE checking chore_reuse_batch
//    and compare all stored payload fields on key reuse, throwing 'key-conflict' on mismatch.
// 2. loadChoreWeek must compute whole-week counts/child totals via SQL GROUP BY and apply childId
//    and status filters in SQL WHERE before the CHORE_WEEK_ROW_LIMIT cap.

function extractFunction(source: string, name: string): string {
  const match = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source);
  if (!match) return '';
  let index = match.index + match[0].length;
  let parens = 1;
  while (index < source.length && parens > 0) {
    if (source[index] === '(') parens++;
    else if (source[index] === ')') parens--;
    index++;
  }
  while (index < source.length && /\s/.test(source[index])) index++;
  if (source[index] === ':') {
    index++;
    let typeDepth = 0;
    while (index < source.length) {
      const ch = source[index];
      if (ch === '{' && typeDepth === 0) {
        let probe = index + 1;
        let braceDepth = 1;
        while (probe < source.length && braceDepth > 0) {
          if (source[probe] === '{') braceDepth++;
          else if (source[probe] === '}') braceDepth--;
          probe++;
        }
        while (probe < source.length && /\s/.test(source[probe])) probe++;
        if (source[probe] === '{' || source[probe] === '|' || source[probe] === '&') {
          index = probe;
          continue;
        }
        break;
      }
      if (ch === '(' || ch === '<' || ch === '[') typeDepth++;
      else if (ch === ')' || ch === '>' || ch === ']') typeDepth = Math.max(0, typeDepth - 1);
      index++;
    }
  }
  const open = source.indexOf('{', index);
  if (open < 0) return '';
  let depth = 1;
  let end = open + 1;
  while (end < source.length && depth > 0) {
    if (source[end] === '{') depth++;
    else if (source[end] === '}') depth--;
    end++;
  }
  return source.slice(open, end);
}

export function reuseIdempotencyFindings(source: string): string[] {
  const body = extractFunction(source, 'createReuseBatch');
  if (!body) return ['createReuseBatch function not found'];
  const findings: string[] = [];
  const normalizePos = body.indexOf('normalizeReuseFields(');
  const assigneesPos = body.indexOf('uniqueAssigneeIds(');
  const lookupPos = body.search(/FROM\s+chore_reuse_batch\b/i);
  if (normalizePos < 0 || assigneesPos < 0 || lookupPos < 0 || normalizePos > lookupPos || assigneesPos > lookupPos) {
    findings.push('createReuseBatch must normalize fields and assignees before looking up chore_reuse_batch');
  }
  for (const column of ['actor_id', 'source_chore_id', 'title', 'description', 'reward_cents', 'due_date', 'assignee_ids']) {
    if (!new RegExp(`SELECT[\\s\\S]*?\\b${column}\\b[\\s\\S]*?FROM\\s+chore_reuse_batch\\b`, 'i').test(body)) {
      findings.push(`createReuseBatch must select and compare ${column} on idempotency key reuse`);
    }
  }
  if (!body.includes("'key-conflict'")) {
    findings.push("createReuseBatch must reject mismatched idempotency key reuse with 'key-conflict'");
  }
  return findings;
}

export function choreWeekFilterFindings(source: string): string[] {
  const body = extractFunction(source, 'loadChoreWeek');
  if (!body) return ['loadChoreWeek function not found'];
  const findings: string[] = [];
  if (!/\bGROUP\s+BY\s+c\.status\b/i.test(body)) {
    findings.push('loadChoreWeek must compute whole-week status counts via SQL GROUP BY c.status');
  }
  if (!/\bGROUP\s+BY\s+c\.assignee_id\b/i.test(body)) {
    findings.push('loadChoreWeek must compute whole-week child totals via SQL GROUP BY c.assignee_id');
  }
  if (!/c\.assignee_id\s*=\s*\?/.test(body) || !/c\.status\s*=\s*\?/.test(body)) {
    findings.push('loadChoreWeek must apply childId and status filters in SQL WHERE before LIMIT');
  }
  return findings;
}

it('createReuseBatch validates payloads before idempotency lookup and rejects key conflicts', () => {
  const reuse = readFileSync('src/lib/server/chore-reuse.ts', 'utf8');
  expect(reuseIdempotencyFindings(reuse)).toEqual([]);
});

it('loadChoreWeek aggregates whole-week counts in SQL and filters before LIMIT', () => {
  const week = readFileSync('src/lib/server/chore-week.ts', 'utf8');
  expect(choreWeekFilterFindings(week)).toEqual([]);
});

it('detects reuse key-conflict and chore-week filter-after-limit regressions (negative fixtures)', () => {
  expect(reuseIdempotencyFindings(`
    export function createReuseBatch(db: any, input: any) {
      const existing = db.prepare('SELECT chore_ids FROM chore_reuse_batch WHERE id = ?').get(input.key);
      if (existing) return { created: false, choreIds: JSON.parse(existing.chore_ids) };
      normalizeReuseFields(input);
      uniqueAssigneeIds(input.assigneeIds);
    }
  `)).toEqual([
    'createReuseBatch must normalize fields and assignees before looking up chore_reuse_batch',
    'createReuseBatch must select and compare actor_id on idempotency key reuse',
    'createReuseBatch must select and compare source_chore_id on idempotency key reuse',
    'createReuseBatch must select and compare title on idempotency key reuse',
    'createReuseBatch must select and compare description on idempotency key reuse',
    'createReuseBatch must select and compare reward_cents on idempotency key reuse',
    'createReuseBatch must select and compare due_date on idempotency key reuse',
    'createReuseBatch must select and compare assignee_ids on idempotency key reuse',
    "createReuseBatch must reject mismatched idempotency key reuse with 'key-conflict'"
  ]);

  expect(choreWeekFilterFindings(`
    export function loadChoreWeek(db: any) {
      const rows = db.prepare('SELECT * FROM chore c WHERE c.due_date >= ? LIMIT ?').all();
      return rows.filter((row: any) => row.assigneeId === 'kid');
    }
  `)).toEqual([
    'loadChoreWeek must compute whole-week status counts via SQL GROUP BY c.status',
    'loadChoreWeek must compute whole-week child totals via SQL GROUP BY c.assignee_id',
    'loadChoreWeek must apply childId and status filters in SQL WHERE before LIMIT'
  ]);
});
