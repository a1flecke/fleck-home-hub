import { describe, expect, it } from 'vitest';
import { localDate, occurrenceDates } from '../src/lib/chores/recurrence';

describe('household-local recurrence', () => {
  it('uses the household date across DST and UTC boundaries', () => {
    expect(localDate(new Date('2026-03-08T05:30:00Z'), 'America/Chicago')).toBe('2026-03-07');
    expect(localDate(new Date('2026-03-08T08:30:00Z'), 'America/Chicago')).toBe('2026-03-08');
    expect(localDate(new Date('2026-11-01T07:30:00Z'), 'America/Chicago')).toBe('2026-11-01');
    expect(localDate(new Date('2026-03-08T05:30:00Z'), 'Asia/Tokyo')).toBe('2026-03-08');
  });
  it('generates weekdays across leap years and month boundaries', () => {
    expect(occurrenceDates('2028-02-27', '2028-03-02', [0, 2, 4])).toEqual(['2028-02-27', '2028-02-29', '2028-03-02']);
  });
  it('rejects invalid dates, weekdays, and unbounded ranges', () => {
    expect(() => occurrenceDates('2026-02-30', '2026-03-02', [1])).toThrow();
    expect(() => occurrenceDates('2026-01-01', '2030-01-01', [1])).toThrow();
    expect(() => occurrenceDates('2026-01-01', '2026-01-02', [7])).toThrow();
    expect(() => localDate(new Date(), 'Not/A_Timezone')).toThrow();
  });
});
