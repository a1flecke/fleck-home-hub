export const dayMs = 86_400_000;

export function parseCalendarDate(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid calendar date');
  const time = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) throw new Error('Invalid calendar date');
  return time;
}

export function formatCalendarDate(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

export function addCalendarDays(date: string, days: number): string {
  if (!Number.isInteger(days)) throw new Error('Invalid calendar day offset');
  return formatCalendarDate(parseCalendarDate(date) + days * dayMs);
}

export function eachCalendarDate(from: string, through: string): string[] {
  const first = parseCalendarDate(from);
  const last = parseCalendarDate(through);
  if (last < first || last - first > 366 * dayMs) throw new Error('Invalid calendar range');
  const dates: string[] = [];
  for (let time = first; time <= last; time += dayMs) dates.push(formatCalendarDate(time));
  return dates;
}
