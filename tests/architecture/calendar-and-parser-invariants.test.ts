import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// Guardrails for calendar recurrence/exceptions and conservative ingredient parsing:
// 1. Recurring calendar events (calendar.ts validate) and recurring chore series (recurring.ts validateSeries)
//    must verify hasRecurrenceOccurrence(...) so zero-occurrence schedules are never persisted.
// 2. calendar.ts cancelOccurrence must verify that the target calendar_event is a repeating series
//    (weekdays IS NOT NULL) before inserting a calendar_exception, preventing phantom one-off rows.
// 3. ingredient-parser.ts must guard percentage product prefixes before matching quantityPattern,
//    and reuse numberAtom across range/sum/alternative guards so fractions and decimals are flagged for review.

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

export function calendarInvariantsFindings(calendarSource: string, recurringSource: string): string[] {
  const findings: string[] = [];
  const validateEvent = extractFunction(calendarSource, 'validate');
  if (!validateEvent || !/\bhasRecurrenceOccurrence\s*\(/.test(validateEvent)) {
    findings.push('calendar.ts validate must check hasRecurrenceOccurrence so zero-occurrence recurring events are rejected');
  }
  const cancelOcc = extractFunction(calendarSource, 'cancelOccurrence');
  if (!cancelOcc || !/SELECT\s+weekdays\s+FROM\s+calendar_event\b/i.test(cancelOcc) || !/!\s*event\.weekdays/.test(cancelOcc)) {
    findings.push('calendar.ts cancelOccurrence must verify calendar_event.weekdays is non-null before inserting into calendar_exception');
  }
  const validateSeries = extractFunction(recurringSource, 'validateSeries');
  if (!validateSeries || !/\bhasRecurrenceOccurrence\s*\(/.test(validateSeries)) {
    findings.push('recurring.ts validateSeries must check hasRecurrenceOccurrence so zero-occurrence recurring chore series are rejected');
  }
  return findings;
}

export function ingredientParserFindings(parserSource: string): string[] {
  const findings: string[] = [];
  const parseBody = extractFunction(parserSource, 'parseIngredientLine');
  if (!parseBody) return ['parseIngredientLine function not found'];
  const percentPos = parseBody.indexOf('percentProductPrefix.test(');
  const quantityPos = parseBody.indexOf('text.match(quantityPattern)');
  if (percentPos < 0 || quantityPos < 0 || percentPos > quantityPos) {
    findings.push('parseIngredientLine must check percentProductPrefix before matching quantityPattern so spaced percentage product names are not split');
  }
  if (!/rangePrefix\s*=\s*new RegExp\([^)]*numberAtom/.test(parserSource)
    || !/sumPrefix\s*=\s*new RegExp\([^)]*numberAtom/.test(parserSource)
    || !/alternativePrefix\s*=\s*new RegExp\([^)]*numberAtom/.test(parserSource)) {
    findings.push('ingredient-parser.ts must build rangePrefix, sumPrefix and alternativePrefix from numberAtom');
  }
  return findings;
}

it('enforces calendar recurrence, one-off exception, and ingredient parser invariants', () => {
  const calendar = readFileSync('src/lib/server/calendar.ts', 'utf8');
  const recurring = readFileSync('src/lib/server/recurring.ts', 'utf8');
  const parser = readFileSync('src/lib/grocery/ingredient-parser.ts', 'utf8');
  expect(calendarInvariantsFindings(calendar, recurring)).toEqual([]);
  expect(ingredientParserFindings(parser)).toEqual([]);
});

it('detects zero-occurrence recurrence, one-off cancelOccurrence, and ingredient-parser regressions (negative fixtures)', () => {
  expect(calendarInvariantsFindings(
    `
      function validate(input: any) { return input; }
      export function cancelOccurrence(db: any, id: string, date: string) {
        db.prepare('INSERT INTO calendar_exception VALUES (?, ?)').run(id, date);
      }
    `,
    `function validateSeries(input: any) { return input; }`
  )).toEqual([
    'calendar.ts validate must check hasRecurrenceOccurrence so zero-occurrence recurring events are rejected',
    'calendar.ts cancelOccurrence must verify calendar_event.weekdays is non-null before inserting into calendar_exception',
    'recurring.ts validateSeries must check hasRecurrenceOccurrence so zero-occurrence recurring chore series are rejected'
  ]);

  expect(ingredientParserFindings(`
    const rangePrefix = /^\\d+\\s*-\\s*\\d/;
    export function parseIngredientLine(text: string) {
      const m = text.match(quantityPattern);
      if (percentProductPrefix.test(text)) return m;
    }
  `)).toEqual([
    'parseIngredientLine must check percentProductPrefix before matching quantityPattern so spaced percentage product names are not split',
    'ingredient-parser.ts must build rangePrefix, sumPrefix and alternativePrefix from numberAtom'
  ]);
});
