const dayMs = 86_400_000;
const maxWeeks = 520;
const shortMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function parse(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid chore date');
  const time = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date) throw new Error('Invalid chore date');
  return time;
}

function iso(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

export function isChoreWeekDate(date: string): boolean {
  try { parse(date); return true; } catch { return false; }
}

/** Sunday-based household-local week for a plain calendar date. */
export function choreWeekStart(date: string): string {
  const time = parse(date);
  return iso(time - new Date(time).getUTCDay() * dayMs);
}

export function choreWeekDates(start: string): string[] {
  const first = parse(start);
  return Array.from({ length: 7 }, (_, index) => iso(first + index * dayMs));
}

export function shiftChoreWeek(start: string, weeks: number): string {
  const first = parse(start);
  if (!Number.isInteger(weeks) || Math.abs(weeks) > maxWeeks) throw new Error('Invalid chore week shift');
  return iso(first + weeks * 7 * dayMs);
}

export function choreDayLabel(date: string): string {
  const value = new Date(parse(date));
  return `${weekdays[value.getUTCDay()]}, ${shortMonths[value.getUTCMonth()]} ${value.getUTCDate()}`;
}

export function choreWeekLabel(start: string): string {
  const days = choreWeekDates(start);
  const first = new Date(parse(days[0]));
  const last = new Date(parse(days[6]));
  const startLabel = `${shortMonths[first.getUTCMonth()]} ${first.getUTCDate()}`;
  if (first.getUTCFullYear() !== last.getUTCFullYear()) {
    return `${startLabel}, ${first.getUTCFullYear()} – ${shortMonths[last.getUTCMonth()]} ${last.getUTCDate()}, ${last.getUTCFullYear()}`;
  }
  if (first.getUTCMonth() !== last.getUTCMonth()) {
    return `${startLabel} – ${shortMonths[last.getUTCMonth()]} ${last.getUTCDate()}, ${last.getUTCFullYear()}`;
  }
  return `${startLabel} – ${last.getUTCDate()}, ${last.getUTCFullYear()}`;
}

export function choreWeekReturnUrl(
  current: URLSearchParams,
  notice: string,
  target?: { dueDate: string; assigneeId: string }
): string {
  const params = new URLSearchParams();
  if (target) {
    params.set('week', choreWeekStart(target.dueDate));
    params.set('date', target.dueDate);
    if (current.get('child')) params.set('child', target.assigneeId);
    if (current.get('status') === 'todo') params.set('status', 'todo');
  } else {
    for (const key of ['week', 'date', 'child', 'status']) {
      const value = current.get(key);
      if (value) params.set(key, value);
    }
  }
  params.set('notice', notice);
  return `/chores/week?${params.toString()}`;
}
