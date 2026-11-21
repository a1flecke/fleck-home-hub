const dayMs = 86_400_000;
const maxWeeks = 520;

function parse(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid meal date');
  const time = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date) throw new Error('Invalid meal date');
  return time;
}

function iso(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

export function isValidMealDate(date: string): boolean {
  try { parse(date); return true; } catch { return false; }
}

/** Sunday-based household-local week for a plain calendar date. */
export function weekStart(date: string): string {
  const time = parse(date);
  return iso(time - new Date(time).getUTCDay() * dayMs);
}

export function weekDates(start: string): string[] {
  const first = parse(start);
  return Array.from({ length: 7 }, (_, index) => iso(first + index * dayMs));
}

export function weekForDate(date: string): { start: string; days: string[] } {
  const start = weekStart(date);
  return { start, days: weekDates(start) };
}

export function shiftWeek(start: string, weeks: number): string {
  const first = parse(start);
  if (!Number.isInteger(weeks) || Math.abs(weeks) > maxWeeks) throw new Error('Invalid week shift');
  return iso(first + weeks * 7 * dayMs);
}

function instant(date: string): Date {
  return new Date(`${date}T12:00:00.000Z`);
}

export function mealDayLabel(date: string): string {
  parse(date);
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(instant(date));
}

export function mealWeekLabel(start: string): string {
  const days = weekDates(start);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).formatRange(instant(days[0]), instant(days[6]));
}
