import { describe, expect, it } from 'vitest';
import { localDate } from '../src/lib/chores/recurrence';
import { parseView, shiftDate, shiftMonth, viewHeading, viewRange } from '../src/lib/calendar/navigation';

describe('calendar view dates', () => {
  it('shifts a day across month, leap-year and year boundaries', () => {
    expect(shiftDate('2026-12-31', 'day', 1)).toBe('2027-01-01');
    expect(shiftDate('2027-01-01', 'day', -1)).toBe('2026-12-31');
    expect(shiftDate('2028-02-28', 'day', 1)).toBe('2028-02-29');
    expect(shiftDate('2028-02-29', 'day', 1)).toBe('2028-03-01');
    expect(shiftDate('2026-02-28', 'day', 1)).toBe('2026-03-01');
  });

  it('shifts a week by seven calendar days across DST and year boundaries', () => {
    expect(shiftDate('2026-03-07', 'week', 1)).toBe('2026-03-14');
    expect(shiftDate('2026-03-08', 'week', 1)).toBe('2026-03-15');
    expect(shiftDate('2026-12-30', 'week', 1)).toBe('2027-01-06');
    expect(shiftDate('2027-01-06', 'week', -1)).toBe('2026-12-30');
  });

  it('shifts a month and clamps the selected day to the destination month', () => {
    expect(shiftMonth('2026-01-31', 1)).toBe('2026-02-28');
    expect(shiftMonth('2028-01-31', 1)).toBe('2028-02-29');
    expect(shiftMonth('2026-03-31', -1)).toBe('2026-02-28');
    expect(shiftMonth('2026-12-31', 1)).toBe('2027-01-31');
    expect(shiftMonth('2026-01-31', -1)).toBe('2025-12-31');
    expect(shiftMonth('2028-02-29', 1)).toBe('2028-03-29');
    expect(shiftMonth('0099-01-31', 1)).toBe('0099-02-28');
    expect(shiftMonth('0099-01-31', -1)).toBe('0098-12-31');
  });

  it('rejects malformed and nonexistent dates', () => {
    for (const date of ['', '2026-2-3', '2026-02-30', '2026-13-01', 'tomorrow']) {
      expect(() => shiftDate(date, 'day', 1)).toThrow('Invalid calendar date');
    }
  });

  it('normalizes unknown or missing view values to week', () => {
    expect(parseView('day')).toBe('day');
    expect(parseView('week')).toBe('week');
    expect(parseView('month')).toBe('month');
    expect(parseView('year')).toBe('week');
    expect(parseView(null)).toBe('week');
  });

  it('calculates inclusive day, week and month ranges', () => {
    expect(viewRange('2026-11-15', 'day')).toEqual({ start: '2026-11-15', end: '2026-11-15' });
    expect(viewRange('2026-11-15', 'week')).toEqual({ start: '2026-11-15', end: '2026-11-21' });
    expect(viewRange('2026-11-15', 'month')).toEqual({ start: '2026-11-01', end: '2026-11-30' });
    expect(viewRange('2028-02-29', 'month')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
    expect(viewRange('0099-02-15', 'month')).toEqual({ start: '0099-02-01', end: '0099-02-28' });
    expect(viewRange('2026-12-31', 'week')).toEqual({ start: '2026-12-27', end: '2027-01-02' });
  });

  it('formats a human-readable heading for each view', () => {
    expect(viewHeading('2026-11-15', 'day')).toBe('Sunday, November 15, 2026');
    expect(viewHeading('2026-11-15', 'week')).toBe('Week of November 15 – 21, 2026');
    expect(viewHeading('2028-02-29', 'week')).toBe('Week of February 27 – March 4, 2028');
    expect(viewHeading('2026-12-31', 'week')).toBe('Week of December 27, 2026 – January 2, 2027');
    expect(viewHeading('2026-11-15', 'month')).toBe('November 2026');
    expect(viewHeading('2028-02-29', 'month')).toBe('February 2028');
  });

  it('derives today from the household time zone rather than UTC', () => {
    const instant = new Date('2026-11-16T04:30:00.000Z');
    expect(localDate(instant, 'UTC')).toBe('2026-11-16');
    expect(localDate(instant, 'America/Chicago')).toBe('2026-11-15');
    expect(localDate(instant, 'Asia/Tokyo')).toBe('2026-11-16');
  });
});
