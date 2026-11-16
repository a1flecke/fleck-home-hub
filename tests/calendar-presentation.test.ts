import { describe, expect, it } from 'vitest';
import { eventTimeLabel, groupByDate, monthGrid, monthPreviewLimit, sortOccurrences } from '../src/lib/calendar/presentation';

type Fixture = {
  id: string;
  title: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  seriesDate?: string;
  weekdays?: number[];
};

function occurrence(overrides: Partial<Fixture> & Pick<Fixture, 'id' | 'title' | 'date'>): Fixture {
  return { startTime: '09:00', endTime: '10:00', allDay: false, ...overrides };
}

describe('calendar occurrence ordering', () => {
  it('sorts all-day first, then start time, title and stable identity', () => {
    const events = [
      occurrence({ id: 'z', title: 'Zebra', date: '2026-11-15' }),
      occurrence({ id: 'b', title: 'Practice', date: '2026-11-15' }),
      occurrence({ id: 'a', title: 'Practice', date: '2026-11-15' }),
      occurrence({ id: 'trip', title: 'Trip', date: '2026-11-15', startTime: null, endTime: null, allDay: true }),
      occurrence({ id: 'breakfast', title: 'Breakfast', date: '2026-11-15', startTime: '08:00', endTime: '09:00' }),
      occurrence({ id: 'appointment', title: 'Appointment', date: '2026-11-15', startTime: '10:00', endTime: '11:00' }),
    ];
    expect(sortOccurrences(events).map(event => `${event.title}:${event.id}`)).toEqual([
      'Trip:trip',
      'Breakfast:breakfast',
      'Practice:a',
      'Practice:b',
      'Zebra:z',
      'Appointment:appointment',
    ]);
  });

  it('keeps two same-title occurrences on the same day without dropping either', () => {
    const groups = groupByDate('2026-11-15', '2026-11-15', [
      occurrence({ id: 'second', title: 'Practice', date: '2026-11-15', startTime: '09:00', endTime: '10:00' }),
      occurrence({ id: 'first', title: 'Practice', date: '2026-11-15', startTime: '09:00', endTime: '11:00' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].events.map(event => event.id)).toEqual(['first', 'second']);
  });
});

describe('calendar agenda grouping', () => {
  it('includes empty and cancelled dates while ignoring occurrences outside the range', () => {
    const groups = groupByDate('2026-11-15', '2026-11-18', [
      occurrence({ id: 'monday', title: 'Monday walk', date: '2026-11-16', startTime: null, endTime: null, allDay: true }),
      occurrence({ id: 'wednesday', title: 'Wednesday dinner', date: '2026-11-18' }),
      occurrence({ id: 'outside', title: 'Outside range', date: '2026-11-19' }),
    ]);
    expect(groups.map(group => [group.date, group.events.map(event => event.title)])).toEqual([
      ['2026-11-15', []],
      ['2026-11-16', ['Monday walk']],
      ['2026-11-17', []],
      ['2026-11-18', ['Wednesday dinner']],
    ]);
  });

  it('groups recurring series occurrences and leaves a cancelled date empty', () => {
    const groups = groupByDate('2026-11-15', '2026-11-29', [
      occurrence({ id: 'swim', title: 'Swim', date: '2026-11-15', seriesDate: '2026-11-01', weekdays: [0] }),
      occurrence({ id: 'swim', title: 'Swim', date: '2026-11-29', seriesDate: '2026-11-01', weekdays: [0] }),
    ]);
    expect(groups.filter(group => group.events.length).map(group => group.date)).toEqual(['2026-11-15', '2026-11-29']);
    expect(groups.find(group => group.date === '2026-11-22')?.events).toEqual([]);
  });

  it('groups a week across a leap day and a month boundary', () => {
    const groups = groupByDate('2028-02-27', '2028-03-04', [
      occurrence({ id: 'leap', title: 'Leap day', date: '2028-02-29', startTime: null, endTime: null, allDay: true }),
      occurrence({ id: 'march', title: 'March first', date: '2028-03-01' }),
    ]);
    expect(groups.map(group => group.date)).toEqual([
      '2028-02-27',
      '2028-02-28',
      '2028-02-29',
      '2028-03-01',
      '2028-03-02',
      '2028-03-03',
      '2028-03-04',
    ]);
    expect(groups[2].events.map(event => event.title)).toEqual(['Leap day']);
    expect(groups[3].events.map(event => event.title)).toEqual(['March first']);
  });
});

describe('month grid', () => {
  it('builds a Sunday-first seven-day grid with leading and trailing padding', () => {
    const weeks = monthGrid('2028-02-01', '2028-02-29', []);
    expect(weeks).toHaveLength(5);
    expect(weeks.every(week => week.length === 7)).toBe(true);
    expect(weeks[0].map(cell => cell?.date ?? null)).toEqual([null, null, '2028-02-01', '2028-02-02', '2028-02-03', '2028-02-04', '2028-02-05']);
    expect(weeks[4].map(cell => cell?.date ?? null)).toEqual(['2028-02-27', '2028-02-28', '2028-02-29', null, null, null, null]);
    expect(weeks.flat().filter(cell => cell !== null).map(cell => cell!.day)).toEqual(Array.from({ length: 29 }, (_, index) => index + 1));
  });

  it('counts events beyond the month preview and keeps every occurrence for the agenda', () => {
    const events = [1, 2, 3, 4, 5].map(index => occurrence({
      id: `event-${index}`,
      title: `Event ${index}`,
      date: '2028-06-15',
      startTime: `0${index}:00`,
      endTime: `0${index + 1}:00`,
    }));
    const cell = monthGrid('2028-06-01', '2028-06-30', events)[2][4];
    expect(cell?.date).toBe('2028-06-15');
    expect(cell?.events.map(event => event.title)).toEqual(['Event 1', 'Event 2', 'Event 3', 'Event 4', 'Event 5']);
    expect(cell?.hiddenCount).toBe(5 - monthPreviewLimit);
    expect(monthGrid('2028-06-01', '2028-06-30', events.slice(0, 2))[2][4]?.hiddenCount).toBe(0);
    expect(monthGrid('2028-06-01', '2028-06-30', [])[2][4]?.hiddenCount).toBe(0);
  });

  it('excludes occurrences outside the selected month', () => {
    const weeks = monthGrid('2028-02-01', '2028-02-29', [
      occurrence({ id: 'january', title: 'January event', date: '2028-01-31' }),
      occurrence({ id: 'february', title: 'February event', date: '2028-02-15' }),
      occurrence({ id: 'march', title: 'March event', date: '2028-03-01' }),
    ]);
    const titles = weeks.flat().flatMap(cell => cell?.events.map(event => event.title) ?? []);
    expect(titles).toEqual(['February event']);
  });
});

describe('occurrence time labels', () => {
  it('labels all-day and timed occurrences', () => {
    expect(eventTimeLabel(occurrence({ id: 'all-day', title: 'Trip', date: '2026-11-15', startTime: null, endTime: null, allDay: true }))).toBe('All day');
    expect(eventTimeLabel(occurrence({ id: 'timed', title: 'Dinner', date: '2026-11-15', startTime: '18:30', endTime: '20:00' }))).toBe('18:30–20:00');
  });
});
