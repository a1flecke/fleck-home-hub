import { occurrenceDates } from './recurrence';
import { scheduleSegments, type ScheduleVersion } from './schedule';

type RecoverySchedule = {
  today: string;
  startDate: string;
  endDate: string | null;
  weekdays: readonly number[];
  occurrences: readonly string[];
  skips: readonly string[];
  pauses: readonly { start: string; end: string | null }[];
  versions?: readonly ScheduleVersion[];
};

export function recoveryDates(schedule: RecoverySchedule): string[] {
  occurrenceDates(schedule.today, schedule.today, [0]);
  const today = new Date(`${schedule.today}T00:00:00.000Z`);
  const previous = new Date(today.getTime() - 86_400_000).toISOString().slice(0, 10);
  const limit = new Date(today.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  const excluded = new Set([...schedule.occurrences, ...schedule.skips]);
  const versions = schedule.versions?.length
    ? schedule.versions
    : [{ effectiveDate: schedule.startDate, endDate: schedule.endDate, weekdays: schedule.weekdays }];
  const dates: string[] = [];
  for (const segment of scheduleSegments(versions)) {
    const start = segment.startDate > limit ? segment.startDate : limit;
    const end = segment.endDate && segment.endDate < previous ? segment.endDate : previous;
    if (start > end) continue;
    for (const date of occurrenceDates(start, end, segment.version.weekdays)) {
      if (!excluded.has(date) && !schedule.pauses.some(pause => date >= pause.start && (!pause.end || date < pause.end))) {
        dates.push(date);
      }
    }
  }
  return dates;
}
