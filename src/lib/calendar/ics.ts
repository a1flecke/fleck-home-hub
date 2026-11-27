import { hasRecurrenceOccurrence } from '../chores/recurrence';
import { addCalendarDays, formatCalendarDate, parseCalendarDate } from './dates';

export const MAX_ICS_BYTES = 256 * 1024;
export const MAX_ICS_EVENTS = 100;
export const MAX_TITLE_LENGTH = 120;
export const MAX_LOCATION_LENGTH = 200;
export const MAX_DESCRIPTION_LENGTH = 1000;
export const MAX_COUNT_OCCURRENCES = 366;

export const importActions = ['import', 'keep_duplicate', 'skip'] as const;
export type ImportAction = (typeof importActions)[number];

export type ImportWarningCode =
  | 'cancelled'
  | 'recurrence_override'
  | 'unknown_timezone'
  | 'multi_day'
  | 'spans_midnight'
  | 'missing_end_time'
  | 'invalid_time'
  | 'unsupported_rrule'
  | 'truncated_fields'
  | 'missing_title';

const BLOCKING_WARNINGS = new Set<ImportWarningCode>([
  'cancelled',
  'recurrence_override',
  'unknown_timezone',
  'multi_day',
  'spans_midnight',
  'missing_end_time',
  'invalid_time',
  'unsupported_rrule',
  'missing_title'
]);

export type IcsParseError = 'empty' | 'too_large' | 'no_events' | 'too_many';

export type ParsedIcsEvent = {
  index: number;
  key: string;
  sourceUid: string | null;
  originalSummary: string;
  title: string;
  date: string;
  endDate: string;
  allDay: boolean;
  startTime: string;
  endTime: string;
  weekdays: number[];
  location: string;
  description: string;
  warnings: ImportWarningCode[];
  blockingWarnings: boolean;
};

export type ExistingCalendarEvent = {
  id: string;
  title: string;
  date: string;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  weekdays: number[];
  sourceUid?: string | null;
};

export type DuplicateMatch = {
  kind: 'uid' | 'probable';
  eventId: string;
  title: string;
  date: string;
  allDay: boolean;
  startTime: string | null;
  endTime: string | null;
};

export type ImportReviewItem = ParsedIcsEvent & {
  action: ImportAction;
  participants: string[];
  existing: DuplicateMatch | null;
  duplicateOfBatch: boolean;
};

export type ImportReview = {
  items: ImportReviewItem[];
  toImport: number;
  toSkip: number;
  warningCount: number;
  duplicateCount: number;
  timezone: string;
};

export type ImportDecision = {
  key: string;
  sourceUid: string | null;
  originalSummary: string;
  action: ImportAction;
  title: string;
  date: string;
  endDate: string;
  allDay: boolean;
  startTime: string;
  endTime: string;
  weekdays: number[];
  location: string;
  description: string;
  participants: string[];
  warnings?: ImportWarningCode[];
};

export type ImportOverrides = Record<string, Partial<Omit<ImportDecision, 'key' | 'sourceUid' | 'originalSummary'>>>;

const WINDOWS_TZ_MAP: Record<string, string> = {
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'US Mountain Standard Time': 'America/Phoenix',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Alaskan Standard Time': 'America/Anchorage',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'UTC': 'UTC',
  'Etc/UTC': 'UTC',
  'GMT Standard Time': 'Europe/London'
};

const BYDAY_MAP: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6
};

export function importItemKey(index: number): string {
  return `ics:${index}`;
}

export function normalizeEventTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function normalizeWeekdays(weekdays: readonly number[]): number[] {
  return [...new Set(weekdays.filter(day => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b);
}

function sameWeekdays(a: readonly number[], b: readonly number[]): boolean {
  const left = normalizeWeekdays(a);
  const right = normalizeWeekdays(b);
  return left.length === right.length && left.every((day, index) => day === right[index]);
}

function unescapeIcsText(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === '\\' && i + 1 < value.length) {
      const next = value[i + 1];
      if (next === 'n' || next === 'N') { out += '\n'; i += 1; continue; }
      if (next === ',' || next === ';' || next === '\\') { out += next; i += 1; continue; }
    }
    out += value[i];
  }
  return out;
}

type IcsProperty = { name: string; params: Record<string, string>; value: string };

function parseLine(line: string): IcsProperty | null {
  let inQuotes = false;
  let colon = -1;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ':' && !inQuotes) { colon = i; break; }
  }
  if (colon <= 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);

  const parts: string[] = [];
  let start = 0;
  inQuotes = false;
  for (let i = 0; i < head.length; i += 1) {
    const ch = head[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ';' && !inQuotes) { parts.push(head.slice(start, i)); start = i + 1; }
  }
  parts.push(head.slice(start));

  const name = parts[0].trim().toUpperCase();
  if (!name) return null;
  const params: Record<string, string> = {};
  for (const param of parts.slice(1)) {
    const eq = param.indexOf('=');
    if (eq <= 0) continue;
    const key = param.slice(0, eq).trim().toUpperCase();
    let val = param.slice(eq + 1).trim();
    if (val.startsWith('"') && val.endsWith('"') && val.length >= 2) val = val.slice(1, -1);
    params[key] = val;
  }
  return { name, params, value };
}

function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function resolveSourceTimeZone(rawTzid: string): string | null {
  const cleaned = rawTzid.trim().replace(/^\/+/, '');
  if (!cleaned) return null;
  const mapped = WINDOWS_TZ_MAP[cleaned] ?? cleaned;
  return isValidTimeZone(mapped) ? mapped : null;
}

function formatInstantInZone(ms: number, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(ms));
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? '00';
  const hour = part('hour') === '24' ? '00' : part('hour');
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    time: `${hour}:${part('minute')}`
  };
}

/** Resolves a wall-clock datetime in `sourceTz` to a UTC epoch millisecond timestamp. */
function wallClockToEpochMs(year: number, month: number, day: number, hour: number, minute: number, second: number, sourceTz: string): number {
  const targetUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = targetUtc;
  for (let pass = 0; pass < 3; pass += 1) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: sourceTz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(new Date(guess));
    const num = (type: string) => Number(parts.find(item => item.type === type)?.value ?? '0');
    const h = num('hour') === 24 ? 0 : num('hour');
    const actualAsUtc = Date.UTC(num('year'), num('month') - 1, num('day'), h, num('minute'), num('second'));
    const diff = targetUtc - actualAsUtc;
    if (diff === 0) break;
    guess += diff;
  }
  return guess;
}

type ParsedDateTime =
  | { kind: 'date'; date: string }
  | { kind: 'instant'; ms: number; date: string; time: string }
  | { kind: 'floating'; date: string; time: string; year: number; month: number; day: number; hour: number; minute: number; second: number }
  | { kind: 'unknown_tz'; date: string; time: string };

function parseIcsDateTime(prop: IcsProperty | undefined, householdTz: string): ParsedDateTime | null {
  if (!prop) return null;
  const raw = prop.value.trim();
  const valueParam = prop.params.VALUE?.toUpperCase();

  const dateMatch = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
  if (dateMatch || valueParam === 'DATE') {
    if (!dateMatch) return null;
    const date = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
    try { parseCalendarDate(date); } catch { return null; }
    return { kind: 'date', date };
  }

  const dtMatch = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(raw);
  if (!dtMatch) return null;
  const year = Number(dtMatch[1]);
  const month = Number(dtMatch[2]);
  const day = Number(dtMatch[3]);
  const hour = Number(dtMatch[4]);
  const minute = Number(dtMatch[5]);
  const second = Number(dtMatch[6]);
  const isUtc = dtMatch[7] === 'Z';

  const dateStr = `${dtMatch[1]}-${dtMatch[2]}-${dtMatch[3]}`;
  try { parseCalendarDate(dateStr); } catch { return null; }
  if (hour > 23 || minute > 59 || second > 60) return null;
  const clampedSecond = Math.min(second, 59);

  if (isUtc) {
    const ms = Date.UTC(year, month - 1, day, hour, minute, clampedSecond);
    const local = formatInstantInZone(ms, householdTz);
    return { kind: 'instant', ms, date: local.date, time: local.time };
  }

  if (prop.params.TZID) {
    const resolved = resolveSourceTimeZone(prop.params.TZID);
    if (!resolved) {
      return { kind: 'unknown_tz', date: dateStr, time: `${dtMatch[4]}:${dtMatch[5]}` };
    }
    const ms = wallClockToEpochMs(year, month, day, hour, minute, clampedSecond, resolved);
    const local = formatInstantInZone(ms, householdTz);
    return { kind: 'instant', ms, date: local.date, time: local.time };
  }

  return {
    kind: 'floating',
    date: dateStr,
    time: `${dtMatch[4]}:${dtMatch[5]}`,
    year,
    month,
    day,
    hour,
    minute,
    second: clampedSecond
  };
}

type ParsedDuration = { days: number; seconds: number };

function parseDuration(raw: string | undefined): ParsedDuration | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const match = /^\+?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(trimmed);
  if (!match) return null;
  if (!match[1] && !match[2] && !match[3] && !match[4] && !match[5]) return null;
  const weeks = Number(match[1] ?? 0);
  const days = weeks * 7 + Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0) * 3600 + Number(match[4] ?? 0) * 60 + Number(match[5] ?? 0);
  return { days, seconds };
}

function endDateFromCount(startDate: string, weekdays: number[], count: number): string | null {
  if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT_OCCURRENCES || !weekdays.length) return null;
  const set = new Set(weekdays);
  let cursor = parseCalendarDate(startDate);
  let found = 0;
  for (let steps = 0; steps < 366 * 8; steps += 1) {
    const dayOfWeek = new Date(cursor).getUTCDay();
    if (set.has(dayOfWeek)) {
      found += 1;
      if (found === count) return formatCalendarDate(cursor);
    }
    cursor += 86_400_000;
  }
  return null;
}

function parseRrule(
  rruleValue: string,
  startDate: string,
  householdTz: string,
  hasExdate: boolean
): { weekdays: number[]; endDate: string; unsupported: boolean } {
  if (hasExdate || !startDate) return { weekdays: [], endDate: '', unsupported: true };
  const parts: Record<string, string> = {};
  for (const segment of rruleValue.split(';')) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) return { weekdays: [], endDate: '', unsupported: true };
    parts[trimmed.slice(0, eq).toUpperCase()] = trimmed.slice(eq + 1).toUpperCase();
  }

  const allowedKeys = new Set(['FREQ', 'INTERVAL', 'BYDAY', 'UNTIL', 'COUNT', 'WKST']);
  if (Object.keys(parts).some(key => !allowedKeys.has(key))) {
    return { weekdays: [], endDate: '', unsupported: true };
  }

  if (parts.INTERVAL && parts.INTERVAL !== '1') {
    return { weekdays: [], endDate: '', unsupported: true };
  }

  let weekdays: number[];
  if (parts.FREQ === 'DAILY') {
    if (parts.BYDAY) return { weekdays: [], endDate: '', unsupported: true };
    weekdays = [0, 1, 2, 3, 4, 5, 6];
  } else if (parts.FREQ === 'WEEKLY') {
    if (parts.BYDAY) {
      const tokens = parts.BYDAY.split(',').map(token => token.trim()).filter(Boolean);
      if (!tokens.length) return { weekdays: [], endDate: '', unsupported: true };
      const parsedDays: number[] = [];
      for (const token of tokens) {
        if (!(token in BYDAY_MAP)) return { weekdays: [], endDate: '', unsupported: true };
        parsedDays.push(BYDAY_MAP[token]);
      }
      weekdays = normalizeWeekdays(parsedDays);
    } else {
      weekdays = [new Date(parseCalendarDate(startDate)).getUTCDay()];
    }
  } else {
    return { weekdays: [], endDate: '', unsupported: true };
  }

  if (parts.UNTIL && parts.COUNT) {
    return { weekdays: [], endDate: '', unsupported: true };
  }

  let endDate = '';
  if (parts.UNTIL) {
    const until = parseIcsDateTime({ name: 'UNTIL', params: {}, value: parts.UNTIL }, householdTz);
    if (!until || until.kind === 'unknown_tz') return { weekdays: [], endDate: '', unsupported: true };
    endDate = until.date;
    if (endDate < startDate) return { weekdays: [], endDate: '', unsupported: true };
  } else if (parts.COUNT) {
    const count = Number(parts.COUNT);
    const computed = endDateFromCount(startDate, weekdays, count);
    if (!computed) return { weekdays: [], endDate: '', unsupported: true };
    endDate = computed;
  }

  if (!hasRecurrenceOccurrence(startDate, endDate || null, weekdays)) {
    return { weekdays: [], endDate: '', unsupported: true };
  }

  return { weekdays, endDate, unsupported: false };
}

function addWarning(warnings: ImportWarningCode[], code: ImportWarningCode) {
  if (!warnings.includes(code)) warnings.push(code);
}

function truncateField(value: string, max: number, warnings: ImportWarningCode[]): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  addWarning(warnings, 'truncated_fields');
  return trimmed.slice(0, max).trimEnd();
}

export function parseIcsCalendar(rawText: string, householdTz: string): { events: ParsedIcsEvent[]; error?: IcsParseError } {
  const byteLength = new TextEncoder().encode(rawText).byteLength;
  if (byteLength > MAX_ICS_BYTES) return { events: [], error: 'too_large' };
  const stripped = rawText.replace(/^\uFEFF/, '');
  if (!stripped.trim()) return { events: [], error: 'empty' };

  const unfolded = stripped.replace(/\r?\n[ \t]/g, '');
  const lines = unfolded.split(/\r?\n/);

  const rawEvents: Array<IcsProperty[]> = [];
  const stack: string[] = [];
  let current: IcsProperty[] | null = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    const prop = parseLine(line);
    if (!prop) continue;
    if (prop.name === 'BEGIN') {
      const block = prop.value.trim().toUpperCase();
      stack.push(block);
      if (block === 'VEVENT' && stack.filter(item => item === 'VEVENT').length === 1) {
        current = [];
      }
      continue;
    }
    if (prop.name === 'END') {
      const block = prop.value.trim().toUpperCase();
      if (block === 'VEVENT' && current && stack.at(-1) === 'VEVENT') {
        rawEvents.push(current);
        current = null;
        if (rawEvents.length > MAX_ICS_EVENTS) return { events: [], error: 'too_many' };
      }
      if (stack.at(-1) === block) stack.pop();
      continue;
    }
    if (current && stack.at(-1) === 'VEVENT') {
      current.push(prop);
    }
  }

  if (!rawEvents.length) return { events: [], error: 'no_events' };

  const tz = isValidTimeZone(householdTz) ? householdTz : 'America/Chicago';
  const events: ParsedIcsEvent[] = rawEvents.map((props, index) => {
    const warnings: ImportWarningCode[] = [];
    const first = (name: string) => props.find(prop => prop.name === name);

    const uidRaw = first('UID')?.value.trim() ?? '';
    const sourceUid = uidRaw ? uidRaw.slice(0, 255) : null;
    const rawSummary = unescapeIcsText(first('SUMMARY')?.value ?? '').trim();
    const rawLocation = unescapeIcsText(first('LOCATION')?.value ?? '');
    const rawDescription = unescapeIcsText(first('DESCRIPTION')?.value ?? '');
    const status = first('STATUS')?.value.trim().toUpperCase() ?? '';
    const hasRecurrenceId = Boolean(first('RECURRENCE-ID'));
    const hasExdate = props.some(prop => prop.name === 'EXDATE');

    const title = truncateField(rawSummary, MAX_TITLE_LENGTH, warnings);
    if (!title) addWarning(warnings, 'missing_title');
    const location = truncateField(rawLocation, MAX_LOCATION_LENGTH, warnings);
    const description = truncateField(rawDescription, MAX_DESCRIPTION_LENGTH, warnings);

    if (status === 'CANCELLED') addWarning(warnings, 'cancelled');
    if (hasRecurrenceId) addWarning(warnings, 'recurrence_override');

    const dtStart = parseIcsDateTime(first('DTSTART'), tz);
    const dtEnd = parseIcsDateTime(first('DTEND'), tz);
    const duration = parseDuration(first('DURATION')?.value);

    let date = '';
    let allDay = false;
    let startTime = '';
    let endTime = '';

    if (!dtStart) {
      addWarning(warnings, 'invalid_time');
    } else if (dtStart.kind === 'date') {
      allDay = true;
      date = dtStart.date;
      if (dtEnd && dtEnd.kind === 'date') {
        const nextDay = addCalendarDays(dtStart.date, 1);
        if (dtEnd.date > nextDay) addWarning(warnings, 'multi_day');
      } else if (duration && (duration.days > 1 || (duration.days === 1 && duration.seconds > 0))) {
        addWarning(warnings, 'multi_day');
      }
    } else {
      allDay = false;
      date = dtStart.date;
      startTime = dtStart.time;
      if (dtStart.kind === 'unknown_tz') addWarning(warnings, 'unknown_timezone');

      let resolvedEndDate = '';
      let resolvedEndTime = '';

      if (dtEnd) {
        if (dtEnd.kind === 'unknown_tz') addWarning(warnings, 'unknown_timezone');
        if (dtEnd.kind === 'date') {
          addWarning(warnings, 'spans_midnight');
        } else {
          resolvedEndDate = dtEnd.date;
          resolvedEndTime = dtEnd.time;
        }
      } else if (duration) {
        if (dtStart.kind === 'instant') {
          const endMs = dtStart.ms + duration.days * 86_400_000 + duration.seconds * 1000;
          const localEnd = formatInstantInZone(endMs, tz);
          resolvedEndDate = localEnd.date;
          resolvedEndTime = localEnd.time;
        } else if (dtStart.kind === 'floating') {
          const base = Date.UTC(dtStart.year, dtStart.month - 1, dtStart.day, dtStart.hour, dtStart.minute, dtStart.second);
          const endUtc = new Date(base + duration.days * 86_400_000 + duration.seconds * 1000);
          resolvedEndDate = endUtc.toISOString().slice(0, 10);
          resolvedEndTime = endUtc.toISOString().slice(11, 16);
        }
      } else {
        addWarning(warnings, 'missing_end_time');
      }

      if (resolvedEndDate) {
        if (resolvedEndDate !== date) {
          addWarning(warnings, 'spans_midnight');
        } else if (resolvedEndTime <= startTime) {
          addWarning(warnings, 'invalid_time');
        } else {
          endTime = resolvedEndTime;
        }
      }
    }

    let weekdays: number[] = [];
    let endDate = '';
    const rruleProp = first('RRULE');
    if (rruleProp) {
      const parsedRule = parseRrule(rruleProp.value, date, tz, hasExdate);
      if (parsedRule.unsupported) {
        addWarning(warnings, 'unsupported_rrule');
      } else {
        weekdays = parsedRule.weekdays;
        endDate = parsedRule.endDate;
      }
    }

    const blockingWarnings = warnings.some(warning => BLOCKING_WARNINGS.has(warning));

    return {
      index,
      key: importItemKey(index),
      sourceUid,
      originalSummary: rawSummary || '(Untitled event)',
      title,
      date,
      endDate,
      allDay,
      startTime,
      endTime,
      weekdays,
      location,
      description,
      warnings,
      blockingWarnings
    };
  });

  return { events };
}

export function findDuplicateMatch(
  candidate: { sourceUid: string | null; title: string; date: string; allDay: boolean; startTime: string; weekdays: readonly number[] },
  existingEvents: readonly ExistingCalendarEvent[]
): DuplicateMatch | null {
  if (candidate.sourceUid) {
    const uidHit = existingEvents.find(existing => existing.sourceUid && existing.sourceUid === candidate.sourceUid);
    if (uidHit) {
      return {
        kind: 'uid',
        eventId: uidHit.id,
        title: uidHit.title,
        date: uidHit.date,
        allDay: uidHit.allDay,
        startTime: uidHit.startTime,
        endTime: uidHit.endTime
      };
    }
  }

  const normalizedTitle = normalizeEventTitle(candidate.title);
  if (!normalizedTitle || !candidate.date) return null;

  const probable = existingEvents.find(existing =>
    normalizeEventTitle(existing.title) === normalizedTitle
    && existing.date === candidate.date
    && existing.allDay === candidate.allDay
    && (candidate.allDay || (existing.startTime ?? '') === candidate.startTime)
    && sameWeekdays(existing.weekdays, candidate.weekdays)
  );

  if (!probable) return null;
  return {
    kind: 'probable',
    eventId: probable.id,
    title: probable.title,
    date: probable.date,
    allDay: probable.allDay,
    startTime: probable.startTime,
    endTime: probable.endTime
  };
}

export function batchEventSignature(candidate: { title: string; date: string; allDay: boolean; startTime: string; weekdays: readonly number[] }): string | null {
  const normalizedTitle = normalizeEventTitle(candidate.title);
  if (!normalizedTitle || !candidate.date) return null;
  const days = normalizeWeekdays(candidate.weekdays).join(',');
  return `${normalizedTitle}|${candidate.date}|${candidate.allDay ? 'all' : candidate.startTime}|${days}`;
}

export function buildImportReview(
  parsedEvents: readonly ParsedIcsEvent[],
  existingEvents: readonly ExistingCalendarEvent[],
  timezone: string,
  overrides: ImportOverrides = {}
): ImportReview {
  const seenUids = new Set<string>();
  const seenSignatures = new Set<string>();

  const items: ImportReviewItem[] = parsedEvents.map(event => {
    const override = overrides[event.key];
    const title = override?.title ?? event.title;
    const date = override?.date ?? event.date;
    const endDate = override?.endDate ?? event.endDate;
    const allDay = override?.allDay ?? event.allDay;
    const startTime = override?.startTime ?? event.startTime;
    const endTime = override?.endTime ?? event.endTime;
    const weekdays = override?.weekdays ? normalizeWeekdays(override.weekdays) : event.weekdays;
    const location = override?.location ?? event.location;
    const description = override?.description ?? event.description;
    const participants = override?.participants ? [...new Set(override.participants)] : [];

    const existing = findDuplicateMatch({ sourceUid: event.sourceUid, title, date, allDay, startTime, weekdays }, existingEvents);
    const sig = batchEventSignature({ title, date, allDay, startTime, weekdays });
    const duplicateOfBatch = Boolean(
      (event.sourceUid && seenUids.has(event.sourceUid))
      || (sig && seenSignatures.has(sig))
    );

    let action: ImportAction;
    if (override?.action && importActions.includes(override.action)) {
      action = override.action;
    } else if (existing || duplicateOfBatch || event.blockingWarnings) {
      action = 'skip';
    } else {
      action = 'import';
    }

    // Skipped rows are excluded from within-batch duplicate tracking so a later active row is not falsely blocked.
    if (action !== 'skip') {
      if (event.sourceUid) seenUids.add(event.sourceUid);
      if (sig) seenSignatures.add(sig);
    }

    return {
      ...event,
      title,
      date,
      endDate,
      allDay,
      startTime,
      endTime,
      weekdays,
      location,
      description,
      participants,
      existing,
      duplicateOfBatch,
      action
    };
  });

  const toImport = items.filter(item => item.action === 'import' || item.action === 'keep_duplicate').length;
  const toSkip = items.length - toImport;
  const warningCount = items.filter(item => item.warnings.length > 0).length;
  const duplicateCount = items.filter(item => Boolean(item.existing) || item.duplicateOfBatch).length;

  return { items, toImport, toSkip, warningCount, duplicateCount, timezone };
}

export function buildReviewFromDecisions(
  decisions: readonly ImportDecision[],
  existingEvents: readonly ExistingCalendarEvent[],
  timezone: string
): ImportReview {
  const parsed: ParsedIcsEvent[] = decisions.map((decision, index) => {
    const warnings = decision.warnings ?? [];
    return {
      index,
      key: decision.key,
      sourceUid: decision.sourceUid,
      originalSummary: decision.originalSummary || decision.title || '(Untitled event)',
      title: decision.title,
      date: decision.date,
      endDate: decision.endDate,
      allDay: decision.allDay,
      startTime: decision.startTime,
      endTime: decision.endTime,
      weekdays: normalizeWeekdays(decision.weekdays),
      location: decision.location,
      description: decision.description,
      warnings,
      blockingWarnings: warnings.some(warning => BLOCKING_WARNINGS.has(warning))
    };
  });
  const overrides: ImportOverrides = Object.fromEntries(decisions.map(decision => [decision.key, {
    action: decision.action,
    title: decision.title,
    date: decision.date,
    endDate: decision.endDate,
    allDay: decision.allDay,
    startTime: decision.startTime,
    endTime: decision.endTime,
    weekdays: decision.weekdays,
    location: decision.location,
    description: decision.description,
    participants: decision.participants
  }]));
  return buildImportReview(parsed, existingEvents, timezone, overrides);
}

export const WARNING_LABELS: Record<ImportWarningCode, string> = {
  cancelled: 'This event is marked cancelled in the file. It is skipped by default.',
  recurrence_override: 'This entry changes one occurrence of a repeating series. Review it carefully or skip it.',
  unknown_timezone: 'The file used an unrecognized time zone. Check the date and times before importing.',
  multi_day: 'This all-day event spans multiple days. The calendar stores single-day events, so it is skipped by default.',
  spans_midnight: 'This timed event crosses midnight. Adjust the date and end time before importing, or skip it.',
  missing_end_time: 'This timed event has no end time. Enter an end time or mark it all day before importing.',
  invalid_time: 'The event date or time is invalid. Correct it before importing, or skip it.',
  unsupported_rrule: 'This repeat rule is not supported automatically (for example, monthly or with excluded dates). You can edit it into a single event or weekly schedule, or skip it.',
  truncated_fields: 'Long text was shortened to fit calendar limits. Check the title, location, and description.',
  missing_title: 'This event has no title. Enter a title before importing, or skip it.'
};
