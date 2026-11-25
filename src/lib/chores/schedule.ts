import { occurrenceDates } from './recurrence';

const dayMs = 86_400_000;
const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export type ScheduleOccurrence = {
  date: string;
  status: 'todo' | 'pending_verification' | 'needs_rework' | 'verified';
  cancelled: boolean;
};

export type ScheduleVersion = {
  effectiveDate: string;
  endDate: string | null;
  weekdays: readonly number[];
};

export type ScheduleSegment<T extends ScheduleVersion = ScheduleVersion> = {
  version: T;
  startDate: string;
  endDate: string | null;
};

export type SchedulePreviewInput = {
  today: string;
  effectiveDate: string;
  oldWeekdays: number[];
  oldEndDate: string | null;
  newWeekdays: number[];
  newEndDate: string | null;
  occurrences: ScheduleOccurrence[];
  skips: string[];
  horizonDays?: number;
  limit?: number;
};

export type SchedulePreview = {
  firstAffectedDate: string;
  addDates: string[];
  keepDates: string[];
  cancelDates: string[];
  preservedDates: string[];
  counts: { add: number; keep: number; cancel: number; preserved: number };
};

function parse(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid schedule date');
  const time = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date) throw new Error('Invalid schedule date');
  return time;
}

function iso(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  return iso(parse(date) + days * dayMs);
}

export function validateEffectiveDate(effectiveDate: string, today: string): string {
  const effective = parse(effectiveDate);
  const current = parse(today);
  if (effective <= current) throw new Error('Choose an effective date after today');
  return effectiveDate;
}

export function schedulePatternLabel(weekdays: readonly number[], endDate: string | null): string {
  const days = [...new Set(weekdays)].sort((a, b) => a - b);
  if (!days.length || days.some(day => !Number.isInteger(day) || day < 0 || day > 6)) throw new Error('Invalid schedule pattern');
  let pattern: string;
  if (days.length === 7) pattern = 'Every day';
  else if (days.length === 1) pattern = weekdayNames[days[0]];
  else if (days.length === 2) pattern = `${weekdayNames[days[0]]} and ${weekdayNames[days[1]]}`;
  else pattern = `${days.slice(0, -1).map(day => weekdayNames[day]).join(', ')}, and ${weekdayNames[days.at(-1)!]}`;
  return endDate ? `${pattern} through ${endDate}` : pattern;
}

export function scheduleSegments<T extends ScheduleVersion>(versions: readonly T[]): ScheduleSegment<T>[] {
  const sorted = [...versions].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  const segments: ScheduleSegment<T>[] = [];
  for (let index = 0; index < sorted.length; index++) {
    const version = sorted[index];
    const startDate = version.effectiveDate;
    const nextStart = index + 1 < sorted.length ? addDays(sorted[index + 1].effectiveDate, -1) : null;
    let endDate = version.endDate;
    if (nextStart && (!endDate || nextStart < endDate)) endDate = nextStart;
    if (endDate && endDate < startDate) continue;
    segments.push({ version, startDate, endDate });
  }
  return segments;
}

export function scheduleVersionForDate<T extends ScheduleVersion>(versions: readonly T[], date: string): T | undefined {
  return scheduleSegments(versions).find(segment => date >= segment.startDate && (!segment.endDate || date <= segment.endDate))?.version;
}

/**
 * Compare a proposed future recurrence pattern with existing occurrences. Only future unstarted,
 * uncancelled work is eligible to be archived; submitted, rework and verified work is preserved.
 * Previously cancelled occurrences do not block re-adding that date under a new pattern.
 * Lists are bounded for display while counts describe every matching date.
 */
export function previewScheduleChange(input: SchedulePreviewInput): SchedulePreview {
  validateEffectiveDate(input.effectiveDate, input.today);
  const horizon = Math.max(1, Math.min(366, Math.trunc(input.horizonDays ?? 90)));
  const limit = Math.max(1, Math.min(100, Math.trunc(input.limit ?? 50)));
  if (input.newEndDate) {
    parse(input.newEndDate);
    if (input.newEndDate < input.effectiveDate) throw new Error('The end date must be on or after the effective date');
  }
  // Validate the weekday set through the existing recurrence guard.
  occurrenceDates(input.effectiveDate, input.effectiveDate, input.newWeekdays);

  const horizonEnd = addDays(input.effectiveDate, horizon - 1);
  const scheduleEnd = input.newEndDate && input.newEndDate < horizonEnd ? input.newEndDate : horizonEnd;
  const latestOccurrence = input.occurrences.reduce((latest, item) => item.date > latest ? item.date : latest, input.effectiveDate);
  const cappedOccurrence = latestOccurrence > addDays(input.effectiveDate, 366) ? addDays(input.effectiveDate, 366) : latestOccurrence;
  const scanEnd = [scheduleEnd, cappedOccurrence].sort().at(-1)!;
  const recurrenceEnd = input.newEndDate && input.newEndDate < scanEnd ? input.newEndDate : scanEnd;
  const newPattern = recurrenceEnd >= input.effectiveDate
    ? occurrenceDates(input.effectiveDate, recurrenceEnd, input.newWeekdays)
    : [];
  const newDates = new Set(newPattern);
  const activeDates = new Set(input.occurrences.filter(item => !item.cancelled).map(item => item.date));
  const skipDates = new Set(input.skips);
  const add = occurrenceDates(input.effectiveDate, scheduleEnd, input.newWeekdays)
    .filter(date => !activeDates.has(date) && !skipDates.has(date));
  const keep: string[] = [];
  const cancel: string[] = [];
  const preserved: string[] = [];
  for (const occurrence of [...input.occurrences].sort((a, b) => a.date.localeCompare(b.date))) {
    if (occurrence.date < input.effectiveDate || occurrence.cancelled) continue;
    if (occurrence.status !== 'todo') preserved.push(occurrence.date);
    else if (newDates.has(occurrence.date)) keep.push(occurrence.date);
    else cancel.push(occurrence.date);
  }
  return {
    firstAffectedDate: input.effectiveDate,
    addDates: add.slice(0, limit),
    keepDates: keep.slice(0, limit),
    cancelDates: cancel.slice(0, limit),
    preservedDates: preserved.slice(0, limit),
    counts: { add: add.length, keep: keep.length, cancel: cancel.length, preserved: preserved.length }
  };
}
