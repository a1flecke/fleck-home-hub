import { describe, expect, it } from 'vitest';
import { recoveryDates } from '../src/lib/chores/recovery';

describe('recovery dates', () => {
  it('finds missing scheduled dates in the prior 30 days without including occurrences, skips, or known pauses', () => {
    expect(recoveryDates({ today: '2026-03-02', startDate: '2026-02-25', endDate: null, weekdays: [0, 1, 2, 3, 4, 5, 6], occurrences: ['2026-02-25'], skips: ['2026-02-26'], pauses: [{ start: '2026-02-27', end: '2026-02-28' }] })).toEqual(['2026-02-28', '2026-03-01']);
  });
});

it('limits review to the previous 30 local calendar dates across a leap day', () => {
  const dates = recoveryDates({ today: '2024-03-02', startDate: '2023-01-01', endDate: null, weekdays: [0, 1, 2, 3, 4, 5, 6], occurrences: [], skips: [], pauses: [] });
  expect(dates).toHaveLength(30);
  expect(dates[0]).toBe('2024-02-01');
  expect(dates).toContain('2024-02-29');
  expect(dates.at(-1)).toBe('2024-03-01');
});

it('respects weekdays and a historical end date across a year boundary', () => {
  expect(recoveryDates({ today: '2026-01-06', startDate: '2025-12-20', endDate: '2026-01-03', weekdays: [0, 6], occurrences: [], skips: [], pauses: [] })).toEqual(['2025-12-20', '2025-12-21', '2025-12-27', '2025-12-28', '2026-01-03']);
});

it('excludes an open pause and returns no dates for a future schedule', () => {
  const base = { today: '2026-03-02', startDate: '2026-02-27', endDate: null, weekdays: [0, 1, 2, 3, 4, 5, 6], occurrences: [], skips: [], pauses: [{ start: '2026-02-28', end: null }] };
  expect(recoveryDates(base)).toEqual(['2026-02-27']);
  expect(recoveryDates({ ...base, startDate: '2026-03-03' })).toEqual([]);
});
