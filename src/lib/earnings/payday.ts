import { occurrenceDates } from '../chores/recurrence';

export function nextPayday(today: string, anchor: string, cadenceDays: number): string {
  occurrenceDates(today, today, [0]);
  occurrenceDates(anchor, anchor, [0]);
  if (cadenceDays !== 7 && cadenceDays !== 14) throw new Error('Invalid cadence');
  const start = Date.parse(`${anchor}T00:00:00Z`);
  const current = Date.parse(`${today}T00:00:00Z`);
  const interval = cadenceDays * 86_400_000;
  return new Date(start + Math.max(0, Math.ceil((current - start) / interval)) * interval).toISOString().slice(0, 10);
}
