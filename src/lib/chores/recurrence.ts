const dayMs = 86_400_000;

function parseDate(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid date');
  const time = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) throw new Error('Invalid date');
  return time;
}

export function localDate(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function occurrenceDates(start: string, end: string, weekdays: readonly number[]): string[] {
  const first = parseDate(start);
  const last = parseDate(end);
  if (last < first || last - first > 366 * dayMs || !weekdays.length || weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6)) throw new Error('Invalid recurrence');
  const result: string[] = [];
  for (let time = first; time <= last; time += dayMs) {
    const date = new Date(time);
    if (weekdays.includes(date.getUTCDay())) result.push(date.toISOString().slice(0, 10));
  }
  return result;
}
