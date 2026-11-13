export type ExpenseCadence = 'once' | 'weekly' | 'biweekly' | 'monthly' | 'yearly';

const dayMs = 86_400_000;

function parseDate(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid date');
  const time = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) throw new Error('Invalid date');
  return time;
}

export function expenseDates(anchor: string, cadence: ExpenseCadence, from: string, through: string): string[] {
  const start = parseDate(anchor);
  const first = parseDate(from);
  const last = parseDate(through);
  if (last < first || last - first > 90 * dayMs) throw new Error('Invalid date range');
  if (!['once', 'weekly', 'biweekly', 'monthly', 'yearly'].includes(cadence)) throw new Error('Invalid cadence');
  if (cadence === 'once') return start >= first && start <= last ? [anchor] : [];
  const result: string[] = [];
  const original = new Date(start);
  for (let time = first; time <= last; time += dayMs) {
    if (time < start) continue;
    const date = new Date(time);
    const delta = (time - start) / dayMs;
    if (cadence === 'weekly' || cadence === 'biweekly') {
      if (delta % (cadence === 'weekly' ? 7 : 14) === 0) result.push(date.toISOString().slice(0, 10));
      continue;
    }
    if (cadence === 'yearly' && date.getUTCMonth() !== original.getUTCMonth()) continue;
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    if (date.getUTCDate() === Math.min(original.getUTCDate(), lastDay)) result.push(date.toISOString().slice(0, 10));
  }
  return result;
}
