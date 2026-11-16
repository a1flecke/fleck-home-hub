import { addCalendarDays, dayMs, formatCalendarDate, parseCalendarDate } from './dates';

export type CalendarView = 'day' | 'week' | 'month';

const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function parseView(value: string | null | undefined): CalendarView {
  return value === 'day' || value === 'week' || value === 'month' ? value : 'week';
}

export function shiftMonth(date: string, direction: -1 | 1): string {
  const destination = new Date(parseCalendarDate(date));
  const day = destination.getUTCDate();
  destination.setUTCDate(1);
  destination.setUTCMonth(destination.getUTCMonth() + direction);
  const lastDay = new Date(destination.getTime());
  lastDay.setUTCMonth(lastDay.getUTCMonth() + 1, 0);
  destination.setUTCDate(Math.min(day, lastDay.getUTCDate()));
  return formatCalendarDate(destination.getTime());
}

export function shiftDate(date: string, view: CalendarView, direction: -1 | 1): string {
  if (view === 'month') return shiftMonth(date, direction);
  return addCalendarDays(date, direction * (view === 'week' ? 7 : 1));
}

export function viewRange(date: string, view: CalendarView) {
  const time = parseCalendarDate(date);
  if (view === 'day') return { start: date, end: date };
  if (view === 'week') {
    const weekday = new Date(time).getUTCDay();
    return { start: formatCalendarDate(time - weekday * dayMs), end: formatCalendarDate(time + (6 - weekday) * dayMs) };
  }
  const first = new Date(time);
  first.setUTCDate(1);
  const last = new Date(first.getTime());
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  return { start: formatCalendarDate(first.getTime()), end: formatCalendarDate(last.getTime()) };
}

export function viewHeading(date: string, view: CalendarView): string {
  const time = parseCalendarDate(date);
  const selected = new Date(time);
  if (view === 'day') return `${weekdayNames[selected.getUTCDay()]}, ${monthNames[selected.getUTCMonth()]} ${selected.getUTCDate()}, ${selected.getUTCFullYear()}`;
  if (view === 'month') return `${monthNames[selected.getUTCMonth()]} ${selected.getUTCFullYear()}`;
  const range = viewRange(date, view);
  const start = new Date(parseCalendarDate(range.start));
  const end = new Date(parseCalendarDate(range.end));
  const startMonth = monthNames[start.getUTCMonth()];
  const endMonth = monthNames[end.getUTCMonth()];
  if (start.getUTCFullYear() !== end.getUTCFullYear()) return `Week of ${startMonth} ${start.getUTCDate()}, ${start.getUTCFullYear()} – ${endMonth} ${end.getUTCDate()}, ${end.getUTCFullYear()}`;
  if (startMonth !== endMonth) return `Week of ${startMonth} ${start.getUTCDate()} – ${endMonth} ${end.getUTCDate()}, ${end.getUTCFullYear()}`;
  return `Week of ${startMonth} ${start.getUTCDate()} – ${end.getUTCDate()}, ${end.getUTCFullYear()}`;
}
