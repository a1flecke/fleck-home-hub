export type CalendarView = 'day' | 'week' | 'month';

const dayMs = 86_400_000;
const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function parseDate(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid calendar date');
  const time = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) throw new Error('Invalid calendar date');
  return time;
}

function formatDate(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

export function parseView(value: string | null | undefined): CalendarView {
  return value === 'day' || value === 'week' || value === 'month' ? value : 'week';
}

export function shiftMonth(date: string, direction: -1 | 1): string {
  const destination = new Date(parseDate(date));
  const day = destination.getUTCDate();
  destination.setUTCDate(1);
  destination.setUTCMonth(destination.getUTCMonth() + direction);
  const lastDay = new Date(destination.getTime());
  lastDay.setUTCMonth(lastDay.getUTCMonth() + 1, 0);
  destination.setUTCDate(Math.min(day, lastDay.getUTCDate()));
  return formatDate(destination.getTime());
}

export function shiftDate(date: string, view: CalendarView, direction: -1 | 1): string {
  if (view === 'month') return shiftMonth(date, direction);
  const time = parseDate(date);
  return formatDate(time + direction * (view === 'week' ? 7 : 1) * dayMs);
}

export function viewRange(date: string, view: CalendarView) {
  const time = parseDate(date);
  if (view === 'day') return { start: date, end: date };
  if (view === 'week') {
    const weekday = new Date(time).getUTCDay();
    return { start: formatDate(time - weekday * dayMs), end: formatDate(time + (6 - weekday) * dayMs) };
  }
  const first = new Date(time);
  first.setUTCDate(1);
  const last = new Date(first.getTime());
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  return { start: formatDate(first.getTime()), end: formatDate(last.getTime()) };
}

export function viewHeading(date: string, view: CalendarView): string {
  const time = parseDate(date);
  const selected = new Date(time);
  if (view === 'day') return `${weekdayNames[selected.getUTCDay()]}, ${monthNames[selected.getUTCMonth()]} ${selected.getUTCDate()}, ${selected.getUTCFullYear()}`;
  if (view === 'month') return `${monthNames[selected.getUTCMonth()]} ${selected.getUTCFullYear()}`;
  const range = viewRange(date, view);
  const start = new Date(parseDate(range.start));
  const end = new Date(parseDate(range.end));
  const startMonth = monthNames[start.getUTCMonth()];
  const endMonth = monthNames[end.getUTCMonth()];
  if (start.getUTCFullYear() !== end.getUTCFullYear()) return `Week of ${startMonth} ${start.getUTCDate()}, ${start.getUTCFullYear()} – ${endMonth} ${end.getUTCDate()}, ${end.getUTCFullYear()}`;
  if (startMonth !== endMonth) return `Week of ${startMonth} ${start.getUTCDate()} – ${endMonth} ${end.getUTCDate()}, ${end.getUTCFullYear()}`;
  return `Week of ${startMonth} ${start.getUTCDate()} – ${end.getUTCDate()}, ${end.getUTCFullYear()}`;
}
