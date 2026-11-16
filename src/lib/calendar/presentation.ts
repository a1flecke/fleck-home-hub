import { eachCalendarDate, parseCalendarDate } from './dates';

export type CalendarOccurrence = {
  id: string;
  title: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
};

export type CalendarDay<T extends CalendarOccurrence = CalendarOccurrence> = { date: string; events: T[] };
export type MonthCell<T extends CalendarOccurrence = CalendarOccurrence> = { date: string; day: number; events: T[]; hiddenCount: number };

export const monthPreviewLimit = 3;

export function eventTimeLabel(event: CalendarOccurrence): string {
  return event.allDay ? 'All day' : `${event.startTime ?? ''}–${event.endTime ?? ''}`;
}

function compareOccurrences(a: CalendarOccurrence, b: CalendarOccurrence) {
  return a.date.localeCompare(b.date)
    || Number(b.allDay) - Number(a.allDay)
    || (a.startTime ?? '').localeCompare(b.startTime ?? '')
    || a.title.localeCompare(b.title)
    || a.id.localeCompare(b.id);
}

export function sortOccurrences<T extends CalendarOccurrence>(events: readonly T[]): T[] {
  return [...events].sort(compareOccurrences);
}

export function groupByDate<T extends CalendarOccurrence>(from: string, through: string, events: readonly T[]): CalendarDay<T>[] {
  const groups = new Map<string, T[]>();
  for (const date of eachCalendarDate(from, through)) groups.set(date, []);
  for (const event of events) groups.get(event.date)?.push(event);
  return [...groups].map(([date, items]) => ({ date, events: sortOccurrences(items) }));
}

export function monthGrid<T extends CalendarOccurrence>(from: string, through: string, events: readonly T[], previewLimit = monthPreviewLimit): (MonthCell<T> | null)[][] {
  const groups = new Map(groupByDate(from, through, events).map(group => [group.date, group.events]));
  const dates = eachCalendarDate(from, through);
  const cells: (MonthCell<T> | null)[] = Array.from({ length: new Date(parseCalendarDate(dates[0])).getUTCDay() }, () => null);
  for (const date of dates) {
    const dayEvents = groups.get(date) ?? [];
    cells.push({ date, day: Number(date.slice(8, 10)), events: dayEvents, hiddenCount: Math.max(0, dayEvents.length - previewLimit) });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, index) => cells.slice(index * 7, index * 7 + 7));
}
