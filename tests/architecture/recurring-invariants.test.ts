import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// Guardrails for recurring schedule revisions and household balance summaries:
// 1. Revising a recurring schedule must not overwrite recurring_series.start_date (keep start_date immutable
//    and record effective-dated schedule versions in recurring_series_version).
// 2. Queries checking recurring_occurrence by series_id + scheduled_date must filter archived_at IS NULL
//    so previously cancelled occurrences never block re-adding weekdays or distort skips/recovery.
// 3. Household review summaries must enumerate active children from active_membership rather than only
//    grouping pending_verification chores, so children with zero pending work are never omitted from owed totals.

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

export function revisionStartDateFindings(source: string): string[] {
  const body = extractFunction(source, 'reviseSeriesSchedule');
  if (!body) return ['reviseSeriesSchedule function not found'];
  const overwritesStartDate = /UPDATE\s+recurring_series\s+SET[\s\S]*?\bstart_date\s*=/i;
  return overwritesStartDate.test(body)
    ? ['reviseSeriesSchedule must not overwrite recurring_series.start_date']
    : [];
}

export function unarchivedOccurrenceQueryFindings(files: Record<string, string>): string[] {
  const findings: string[] = [];
  const sqlLiterals = /(['`"])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  for (const [path, text] of Object.entries(files)) {
    for (const match of text.matchAll(sqlLiterals)) {
      const sql = match[2];
      if (!/\bSELECT\b[\s\S]*\bFROM\s+recurring_occurrence\b/i.test(sql)) continue;
      if (!/\bseries_id\s*=/.test(sql)) continue;
      if (!/\barchived_at\s+IS\s+NULL\b/i.test(sql)) {
        findings.push(`${path}: recurring_occurrence lookup by series_id must filter archived_at IS NULL`);
      }
    }
  }
  return findings;
}

export function reviewSummaryChildEnumerationFindings(source: string): string[] {
  const body = extractFunction(source, 'reviewChildSummaries');
  if (!body) return ['reviewChildSummaries function not found'];
  return /\bFROM\s+active_membership\b/i.test(body)
    ? []
    : ['reviewChildSummaries must enumerate active children from active_membership so zero-pending children remain in verified owed totals'];
}

export function scheduleOccurrenceScanFindings(source: string): string[] {
  const findings: string[] = [];
  const occurrencesBody = extractFunction(source, 'scheduleOccurrences');
  if (!occurrencesBody) {
    findings.push('scheduleOccurrences function not found');
  } else {
    if (/\bscheduled_date\s*<=/i.test(occurrencesBody) || /\bLIMIT\b/i.test(occurrencesBody)) {
      findings.push('scheduleOccurrences must not cap existing occurrences with scheduled_date <= or LIMIT');
    }
  }
  const reviseBody = extractFunction(source, 'reviseSeriesSchedule');
  if (!reviseBody) {
    findings.push('reviseSeriesSchedule function not found');
  } else if (!/\bdateMatchesSchedule\s*\(/.test(reviseBody)) {
    findings.push('reviseSeriesSchedule must evaluate every materialized future occurrence with dateMatchesSchedule instead of a bounded date set');
  }
  return findings;
}

it('reviseSeriesSchedule preserves recurring_series.start_date', () => {
  const recurring = readFileSync('src/lib/server/recurring.ts', 'utf8');
  expect(revisionStartDateFindings(recurring)).toEqual([]);
});

it('scheduleOccurrences and reviseSeriesSchedule evaluate all materialized future occurrences without a 366-day or LIMIT cap', () => {
  const recurring = readFileSync('src/lib/server/recurring.ts', 'utf8');
  expect(scheduleOccurrenceScanFindings(recurring)).toEqual([]);
});

it('recurring_occurrence lookups by series_id filter archived_at IS NULL', () => {
  const files = {
    'src/lib/server/recurring.ts': readFileSync('src/lib/server/recurring.ts', 'utf8'),
    'src/lib/server/recovery.ts': readFileSync('src/lib/server/recovery.ts', 'utf8')
  };
  expect(unarchivedOccurrenceQueryFindings(files)).toEqual([]);
});

it('reviewChildSummaries enumerates active children from active_membership', () => {
  const verification = readFileSync('src/lib/server/verification.ts', 'utf8');
  expect(reviewSummaryChildEnumerationFindings(verification)).toEqual([]);
});

it('detects recurring revision, archived-occurrence, scan-cap and summary-enumeration regressions (negative fixtures)', () => {
  expect(revisionStartDateFindings(`
    export function reviseSeriesSchedule(db: any) {
      db.prepare('UPDATE recurring_series SET title = ?, start_date = ? WHERE id = ?').run();
    }
  `)).toEqual(['reviseSeriesSchedule must not overwrite recurring_series.start_date']);

  expect(scheduleOccurrenceScanFindings(`
    function scheduleOccurrences(db: any, id: string, from: string, through: string) {
      return db.prepare('SELECT o.scheduled_date FROM recurring_occurrence o WHERE o.series_id = ? AND o.archived_at IS NULL AND o.scheduled_date >= ? AND o.scheduled_date <= ? LIMIT 500').all(id, from, through);
    }
    export function reviseSeriesSchedule(db: any) {
      const newDates = new Set<string>();
      return newDates;
    }
  `)).toEqual([
    'scheduleOccurrences must not cap existing occurrences with scheduled_date <= or LIMIT',
    'reviseSeriesSchedule must evaluate every materialized future occurrence with dateMatchesSchedule instead of a bounded date set'
  ]);

  expect(unarchivedOccurrenceQueryFindings({
    'src/lib/server/bad.ts': "db.prepare('SELECT 1 FROM recurring_occurrence WHERE series_id = ? AND scheduled_date = ?').get()",
    'src/lib/server/good.ts': "db.prepare('SELECT 1 FROM recurring_occurrence o WHERE o.series_id = ? AND o.scheduled_date = ? AND o.archived_at IS NULL').get()"
  })).toEqual(['src/lib/server/bad.ts: recurring_occurrence lookup by series_id must filter archived_at IS NULL']);

  expect(reviewSummaryChildEnumerationFindings(`
    export function reviewChildSummaries(db: any) {
      return db.prepare("SELECT c.assignee_id FROM chore c WHERE c.status = 'pending_verification' GROUP BY c.assignee_id").all();
    }
  `)).toEqual(['reviewChildSummaries must enumerate active children from active_membership so zero-pending children remain in verified owed totals']);
});
