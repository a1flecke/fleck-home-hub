import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

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

export function draftRecoveryAndCalendarFindings(sources: {
  groceriesPage: string;
  checklistPage: string;
  calendarRoute: string;
  calendarServer: string;
  displayServer: string;
  checklistsServer: string;
}): string[] {
  const findings: string[] = [];

  if (!/initialGroceryState\s*\(\s*data\.items\s*,\s*form\?\.edit\s*\)/.test(sources.groceriesPage)) {
    findings.push('groceries/+page.svelte must initialize items and removed-edit state via initialGroceryState(data.items, form?.edit) so concurrently deleted edit drafts survive SSR and JS-off POSTs');
  }
  if (!/removedChecklistItemDraft\s*\(\s*data\.list\.items\s*,\s*form\?\.editItem\s*\)/.test(sources.checklistPage)) {
    findings.push('lists/[id]/+page.svelte must surface concurrently deleted item edit drafts via removedChecklistItemDraft(data.list.items, form?.editItem)');
  }
  if (!/findSavedEventElsewhere\s*\(/.test(sources.calendarRoute) || /listEvents\s*\([^)]*addCalendarDays\s*\(\s*start\s*,\s*365\s*\)/.test(sources.calendarRoute)) {
    findings.push('calendar/+page.server.ts savedElsewhere must use findSavedEventElsewhere relative to the viewed range instead of scanning 365 days from seriesDate');
  }

  const occurrencesBody = extractFunction(sources.calendarServer, 'householdEventOccurrences');
  if (!occurrencesBody || !/weekdays\s+IS\s+NULL\s+AND\s+start_date\s*>=\s*\?/i.test(occurrencesBody)) {
    findings.push('calendar.ts householdEventOccurrences must bound one-off events in SQL with (weekdays IS NULL AND start_date >= ?)');
  }
  if (/\.flatMap\s*\([\s\S]*?FROM\s+calendar_participant/i.test(occurrencesBody) || /\.filter\s*\([\s\S]*?FROM\s+calendar_exception/i.test(occurrencesBody)) {
    findings.push('calendar.ts householdEventOccurrences must batch calendar_exception and calendar_participant lookups rather than running per-row queries inside loops');
  }

  const cancelBody = extractFunction(sources.calendarServer, 'cancelOccurrence');
  if (!cancelBody || /\blistEvents\s*\(/.test(cancelBody)) {
    findings.push('calendar.ts cancelOccurrence must check the single target event by primary key instead of calling listEvents inside BEGIN IMMEDIATE');
  }

  const upcomingBody = extractFunction(sources.calendarServer, 'listUpcomingEvents');
  if (!upcomingBody || !/includeParticipants\s*:\s*false/.test(upcomingBody)) {
    findings.push('calendar.ts listUpcomingEvents must pass { includeParticipants: false } to householdEventOccurrences');
  }

  const displayBody = extractFunction(sources.displayServer, 'sharedProjection');
  if (!displayBody || !/householdEventOccurrences\s*\([^)]*includeParticipants\s*:\s*false/.test(displayBody)) {
    findings.push('display.ts sharedProjection must pass { includeParticipants: false } to householdEventOccurrences');
  }

  const isScheduledBody = extractFunction(sources.checklistsServer, 'isScheduled');
  if (!isScheduledBody || /\blistEvents\s*\(/.test(isScheduledBody) || !/\bhasEventOccurrence\s*\(/.test(isScheduledBody)) {
    findings.push('checklists.ts isScheduled must call hasEventOccurrence instead of scanning the household calendar with listEvents');
  }

  return findings;
}

it('preserves deleted-item edit drafts, viewed-date calendar links, and bounded calendar queries', () => {
  expect(draftRecoveryAndCalendarFindings({
    groceriesPage: readFileSync('src/routes/groceries/+page.svelte', 'utf8'),
    checklistPage: readFileSync('src/routes/lists/[id]/+page.svelte', 'utf8'),
    calendarRoute: readFileSync('src/routes/calendar/+page.server.ts', 'utf8'),
    calendarServer: readFileSync('src/lib/server/calendar.ts', 'utf8'),
    displayServer: readFileSync('src/lib/server/display.ts', 'utf8'),
    checklistsServer: readFileSync('src/lib/server/checklists.ts', 'utf8')
  })).toEqual([]);
});

it('catches regressions across draft recovery and calendar query invariants (negative fixtures)', () => {
  const broken = draftRecoveryAndCalendarFindings({
    groceriesPage: 'let items = $state(untrack(() => data.items));',
    checklistPage: 'let visibleItems = $derived(data.list.items);',
    calendarRoute: 'return listEvents(db, actor, household, start, addCalendarDays(start, 365));',
    calendarServer: [
      'export function listUpcomingEvents() { return listEvents(); }',
      'export function householdEventOccurrences() {',
      '  db.prepare("SELECT * FROM calendar_event WHERE start_date <= ? AND (end_date IS NULL OR end_date >= ?)");',
      '  return rows.flatMap(r => { db.prepare("SELECT user_id FROM calendar_participant WHERE event_id = ?"); return dates.filter(d => !db.prepare("SELECT 1 FROM calendar_exception WHERE event_id = ?").get()); });',
      '}',
      'export function cancelOccurrence() { if (!listEvents(db, actor, household, date, date).some(i => i.id === id)) throw new Error(); }'
    ].join('\n'),
    displayServer: 'function sharedProjection() { const events = householdEventOccurrences(db, household, today, end); }',
    checklistsServer: 'function isScheduled() { return listEvents(db, actor, household, date, date).some(e => e.id === eventId); }'
  });
  expect(broken).toHaveLength(9);
});
