import { occurrenceDates } from './recurrence';

type RecoverySchedule = {
  today: string;
  startDate: string;
  endDate: string | null;
  weekdays: readonly number[];
  occurrences: readonly string[];
  skips: readonly string[];
  pauses: readonly { start: string; end: string | null }[];
};

export function recoveryDates(schedule: RecoverySchedule): string[] {
  occurrenceDates(schedule.today, schedule.today, [0]);
  const today = new Date(`${schedule.today}T00:00:00.000Z`);
  const previous = new Date(today.getTime() - 86_400_000).toISOString().slice(0, 10);
  const limit = new Date(today.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  const start = schedule.startDate > limit ? schedule.startDate : limit;
  const end = schedule.endDate && schedule.endDate < previous ? schedule.endDate : previous;
  if (start > end) return [];
  const excluded = new Set([...schedule.occurrences, ...schedule.skips]);
  return occurrenceDates(start, end, schedule.weekdays).filter(date => !excluded.has(date) && !schedule.pauses.some(pause => date >= pause.start && (!pause.end || date < pause.end)));
}
