import { describe, expect, it } from 'vitest';
import {
  choreDayLabel,
  choreWeekDates,
  choreWeekLabel,
  choreWeekReturnUrl,
  choreWeekStart,
  isChoreWeekDate,
  shiftChoreWeek
} from '../src/lib/chores/week';

describe('household chore week', () => {
  it('starts on Sunday and returns seven consecutive household-local dates', () => {
    expect(choreWeekStart('2026-11-22')).toBe('2026-11-22');
    expect(choreWeekStart('2026-11-21')).toBe('2026-11-15');
    expect(choreWeekDates('2026-11-15')).toEqual([
      '2026-11-15',
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
      '2026-11-21'
    ]);
  });

  it('shifts across month and year boundaries', () => {
    expect(shiftChoreWeek('2026-12-27', 1)).toBe('2027-01-03');
    expect(shiftChoreWeek('2027-01-03', -1)).toBe('2026-12-27');
    expect(shiftChoreWeek('2026-11-15', 0)).toBe('2026-11-15');
    expect(() => shiftChoreWeek('2026-11-15', 1_000)).toThrow();
  });

  it('labels the week and each day with plain calendar dates', () => {
    expect(choreWeekLabel('2026-11-15')).toBe('Nov 15 – 21, 2026');
    expect(choreDayLabel('2026-11-15')).toBe('Sunday, Nov 15');
    expect(choreDayLabel('2026-11-21')).toBe('Saturday, Nov 21');
  });

  it('rejects impossible or malformed dates', () => {
    for (const value of ['2026-02-30', '2026-2-01', '2026-13-01', '', 'not-a-date']) {
      expect(isChoreWeekDate(value)).toBe(false);
      expect(() => choreWeekStart(value)).toThrow();
    }
    expect(isChoreWeekDate('2026-02-28')).toBe(true);
    expect(isChoreWeekDate('2028-02-29')).toBe(true);
    expect(isChoreWeekDate('2026-02-29')).toBe(false);
  });

  it('routes edited and created chores to their new week/child context while preserving matching filters', () => {
    const filtered = new URLSearchParams('week=2099-03-08&date=2099-03-12&child=kid-a&status=todo');
    expect(choreWeekReturnUrl(filtered, 'updated', { dueDate: '2099-03-20', assigneeId: 'kid-b' }))
      .toBe('/chores/week?week=2099-03-15&date=2099-03-20&child=kid-b&status=todo&notice=updated');

    const unfiltered = new URLSearchParams('week=2099-03-08&date=2099-03-12');
    expect(choreWeekReturnUrl(unfiltered, 'updated', { dueDate: '2099-03-20', assigneeId: 'kid-b' }))
      .toBe('/chores/week?week=2099-03-15&date=2099-03-20&notice=updated');

    const verifiedFilter = new URLSearchParams('week=2099-03-08&child=kid-a&status=verified');
    expect(choreWeekReturnUrl(verifiedFilter, 'created', { dueDate: '2099-03-12', assigneeId: 'kid-a' }))
      .toBe('/chores/week?week=2099-03-08&date=2099-03-12&child=kid-a&notice=created');

    expect(choreWeekReturnUrl(filtered, 'cancelled'))
      .toBe('/chores/week?week=2099-03-08&date=2099-03-12&child=kid-a&status=todo&notice=cancelled');
  });
});
