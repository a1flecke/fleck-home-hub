import { describe, expect, it } from 'vitest';
import { isValidMealDate, shiftWeek, weekDates, weekForDate, weekStart } from '../src/lib/meals/week';

describe('household meal week', () => {
  it('starts on Sunday and returns seven consecutive household-local dates', () => {
    expect(weekStart('2026-11-21')).toBe('2026-11-15');
    expect(weekStart('2026-11-15')).toBe('2026-11-15');
    expect(weekDates('2026-11-15')).toEqual([
      '2026-11-15',
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
      '2026-11-21'
    ]);
  });

  it('keeps a date in its week and shifts across month and year boundaries', () => {
    expect(weekForDate('2026-11-21')).toMatchObject({ start: '2026-11-15' });
    expect(shiftWeek('2026-12-27', 1)).toBe('2027-01-03');
    expect(shiftWeek('2027-01-03', -1)).toBe('2026-12-27');
    expect(shiftWeek('2027-01-03', 0)).toBe('2027-01-03');
  });

  it('rejects impossible or malformed dates', () => {
    for (const value of ['2026-02-30', '2026-2-01', '2026-13-01', '', 'not-a-date']) {
      expect(isValidMealDate(value)).toBe(false);
      expect(() => weekStart(value)).toThrow();
    }
    expect(isValidMealDate('2026-02-28')).toBe(true);
    expect(isValidMealDate('2028-02-29')).toBe(true);
    expect(isValidMealDate('2026-02-29')).toBe(false);
  });

  it('refuses a shift outside the supported range', () => {
    expect(() => shiftWeek('2026-11-15', 1_000)).toThrow();
    expect(weekDates('2026-11-15')).toHaveLength(7);
  });
});
