import { describe, expect, it } from 'vitest';
import { previewScheduleChange, schedulePatternLabel, validateEffectiveDate } from '../src/lib/chores/schedule';

const base = {
  today: '2026-11-22',
  effectiveDate: '2026-11-23',
  oldWeekdays: [1, 3],
  oldEndDate: null,
  newWeekdays: [2, 4],
  newEndDate: null,
  skips: [] as string[],
  occurrences: [] as { date: string; status: 'todo' | 'pending_verification' | 'needs_rework' | 'verified'; cancelled: boolean }[]
};

describe('recurring schedule preview', () => {
  it('starts after today and labels the old and new patterns', () => {
    expect(() => validateEffectiveDate('2026-11-22', '2026-11-22')).toThrow();
    expect(() => validateEffectiveDate('2026-11-21', '2026-11-22')).toThrow();
    expect(validateEffectiveDate('2026-11-23', '2026-11-22')).toBe('2026-11-23');
    expect(schedulePatternLabel([1, 3], null)).toBe('Monday and Wednesday');
    expect(schedulePatternLabel([0, 1, 2, 3, 4, 5, 6], '2026-12-31')).toBe('Every day through 2026-12-31');
  });

  it('cancels only obsolete unstarted work and preserves submitted or verified occurrences', () => {
    const preview = previewScheduleChange({
      ...base,
      horizonDays: 21,
      occurrences: [
        { date: '2026-11-23', status: 'todo', cancelled: false },
        { date: '2026-11-25', status: 'pending_verification', cancelled: false },
        { date: '2026-11-30', status: 'todo', cancelled: false },
        { date: '2026-12-02', status: 'verified', cancelled: false },
        { date: '2026-11-24', status: 'todo', cancelled: true }
      ]
    });
    expect(preview.firstAffectedDate).toBe('2026-11-23');
    expect(preview.cancelDates).toEqual(['2026-11-23', '2026-11-30']);
    expect(preview.preservedDates).toEqual(['2026-11-25', '2026-12-02']);
    expect(preview.addDates).toContain('2026-11-26');
    expect(preview.addDates).not.toContain('2026-11-23');
    expect(preview.addDates).not.toContain('2026-11-24');
    expect(preview.counts).toMatchObject({ add: preview.addDates.length, cancel: 2, keep: 0, preserved: 2 });
  });

  it('keeps matching unstarted dates and respects skips', () => {
    const preview = previewScheduleChange({
      ...base,
      newWeekdays: [1, 3],
      horizonDays: 14,
      skips: ['2026-11-30'],
      occurrences: [
        { date: '2026-11-23', status: 'todo', cancelled: false },
        { date: '2026-11-25', status: 'todo', cancelled: false },
        { date: '2026-11-30', status: 'todo', cancelled: false },
        { date: '2026-12-02', status: 'todo', cancelled: false }
      ]
    });
    expect(preview.keepDates).toEqual(['2026-11-23', '2026-11-25', '2026-11-30', '2026-12-02']);
    expect(preview.cancelDates).toEqual([]);
    expect(preview.addDates).toEqual([]);
  });

  it('cancels dates beyond a shortened end date', () => {
    const preview = previewScheduleChange({
      ...base,
      oldWeekdays: [0, 1, 2, 3, 4, 5, 6],
      newWeekdays: [0, 1, 2, 3, 4, 5, 6],
      newEndDate: '2026-11-29',
      horizonDays: 90,
      occurrences: [
        { date: '2026-11-24', status: 'todo', cancelled: false },
        { date: '2026-11-25', status: 'todo', cancelled: false },
        { date: '2026-11-26', status: 'todo', cancelled: false },
        { date: '2026-11-27', status: 'todo', cancelled: false },
        { date: '2026-11-28', status: 'todo', cancelled: false },
        { date: '2026-11-29', status: 'todo', cancelled: false },
        { date: '2026-11-30', status: 'todo', cancelled: false },
        { date: '2026-12-01', status: 'todo', cancelled: false }
      ]
    });
    expect(preview.cancelDates).toEqual(['2026-11-30', '2026-12-01']);
    expect(preview.addDates).toEqual(['2026-11-23']);
    expect(preview.counts.add).toBe(1);
  });

  it('bounds long previews while keeping complete counts', () => {
    const preview = previewScheduleChange({
      ...base,
      oldWeekdays: [0, 1, 2, 3, 4, 5, 6],
      newWeekdays: [0, 1, 2, 3, 4, 5, 6],
      horizonDays: 90,
      limit: 5
    });
    expect(preview.addDates).toHaveLength(5);
    expect(preview.counts.add).toBe(90);
  });
});
