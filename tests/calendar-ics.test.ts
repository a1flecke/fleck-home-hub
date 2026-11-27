import { describe, expect, it } from 'vitest';
import {
  buildImportReview,
  MAX_ICS_BYTES,
  MAX_ICS_EVENTS,
  normalizeEventTitle,
  parseIcsCalendar,
  type ExistingCalendarEvent
} from '../src/lib/calendar/ics';

function wrap(...blocks: string[]): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Synthetic//Test//EN', ...blocks, 'END:VCALENDAR'].join('\r\n');
}

function vevent(lines: string[]): string {
  return ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n');
}

describe('parseIcsCalendar', () => {
  it('unfolds folded lines, unescapes RFC 5545 text, and ignores nested VALARM blocks', () => {
    const ics = wrap(vevent([
      'UID:synthetic-1@example.test',
      'SUMMARY:Soccer practice\\, Field',
      '  4 \\; Varsity',
      'LOCATION:North Park\\, East\\nLot',
      'DESCRIPTION:Bring water\\, cleats\\\\shin guards\\nArrive 10 min early',
      'DTSTART;VALUE=DATE:20261110',
      'DTEND;VALUE=DATE:20261111',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'SUMMARY:Alarm title must be ignored',
      'DESCRIPTION:Alarm description must be ignored',
      'TRIGGER:-PT15M',
      'END:VALARM'
    ]));

    const parsed = parseIcsCalendar(ics, 'America/Chicago');
    expect(parsed.error).toBeUndefined();
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0]).toMatchObject({
      sourceUid: 'synthetic-1@example.test',
      title: 'Soccer practice, Field 4 ; Varsity',
      location: 'North Park, East\nLot',
      description: 'Bring water, cleats\\shin guards\nArrive 10 min early',
      date: '2026-11-10',
      allDay: true,
      startTime: '',
      endTime: '',
      weekdays: [],
      warnings: [],
      blockingWarnings: false
    });
  });

  it('converts UTC, IANA TZID, Windows TZID, and floating timestamps into household-local time across DST', () => {
    const ics = wrap(
      // UTC during CDT (UTC-5 in America/Chicago): 2026-07-15 23:00Z -> 18:00 CDT
      vevent([
        'UID:utc-summer@example.test',
        'SUMMARY:Summer swim meet',
        'DTSTART:20260715T230000Z',
        'DTEND:20260716T003000Z'
      ]),
      // UTC during CST (UTC-6 in America/Chicago): 2026-11-15 01:00Z -> 2026-11-14 19:00 CST (date shifts back!)
      vevent([
        'UID:utc-winter@example.test',
        'SUMMARY:Winter concert',
        'DTSTART:20261115T010000Z',
        'DTEND:20261115T023000Z'
      ]),
      // Explicit IANA TZID America/New_York -> America/Chicago (1 hour earlier)
      vevent([
        'UID:iana-ny@example.test',
        'SUMMARY:Grandma video call',
        'DTSTART;TZID=America/New_York:20261118T190000',
        'DTEND;TZID=America/New_York:20261118T200000'
      ]),
      // Windows TZID Pacific Standard Time -> America/Chicago (2 hours later)
      vevent([
        'UID:win-pst@example.test',
        'SUMMARY:Uncle flight arrival',
        'DTSTART;TZID="Pacific Standard Time":20261120T140000',
        'DURATION:PT1H30M'
      ]),
      // Floating local time stays in household wall clock
      vevent([
        'UID:floating@example.test',
        'SUMMARY:Piano lesson',
        'DTSTART:20261121T163000',
        'DTEND:20261121T171500'
      ])
    );

    const parsed = parseIcsCalendar(ics, 'America/Chicago');
    expect(parsed.error).toBeUndefined();
    expect(parsed.events.map(event => ({
      title: event.title,
      date: event.date,
      startTime: event.startTime,
      endTime: event.endTime,
      warnings: event.warnings
    }))).toEqual([
      { title: 'Summer swim meet', date: '2026-07-15', startTime: '18:00', endTime: '19:30', warnings: [] },
      { title: 'Winter concert', date: '2026-11-14', startTime: '19:00', endTime: '20:30', warnings: [] },
      { title: 'Grandma video call', date: '2026-11-18', startTime: '18:00', endTime: '19:00', warnings: [] },
      { title: 'Uncle flight arrival', date: '2026-11-20', startTime: '16:00', endTime: '17:30', warnings: [] },
      { title: 'Piano lesson', date: '2026-11-21', startTime: '16:30', endTime: '17:15', warnings: [] }
    ]);
  });

  it('maps supported DAILY and WEEKLY RRULEs with BYDAY, UNTIL, and COUNT', () => {
    const ics = wrap(
      vevent([
        'UID:weekly-until@example.test',
        'SUMMARY:Band rehearsal',
        'DTSTART;TZID=America/Chicago:20260901T153000',
        'DTEND;TZID=America/Chicago:20260901T163000',
        'RRULE:FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20261001T235959Z'
      ]),
      vevent([
        'UID:weekly-count@example.test',
        'SUMMARY:Robotics club',
        'DTSTART:20260907T160000',
        'DTEND:20260907T173000',
        'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=5'
      ]),
      vevent([
        'UID:daily-count@example.test',
        'SUMMARY:Summer camp',
        'DTSTART;VALUE=DATE:20260615',
        'DTEND;VALUE=DATE:20260616',
        'RRULE:FREQ=DAILY;COUNT=5'
      ]),
      vevent([
        'UID:weekly-implicit-day@example.test',
        'SUMMARY:Library storytime',
        'DTSTART;VALUE=DATE:20260905',
        'RRULE:FREQ=WEEKLY;UNTIL=20260926'
      ])
    );

    const parsed = parseIcsCalendar(ics, 'America/Chicago');
    expect(parsed.error).toBeUndefined();
    expect(parsed.events.map(event => ({
      title: event.title,
      date: event.date,
      endDate: event.endDate,
      weekdays: event.weekdays,
      warnings: event.warnings
    }))).toEqual([
      { title: 'Band rehearsal', date: '2026-09-01', endDate: '2026-10-01', weekdays: [2, 4], warnings: [] },
      // Mon Sep 7 (#1), Wed Sep 9 (#2), Mon Sep 14 (#3), Wed Sep 16 (#4), Mon Sep 21 (#5)
      { title: 'Robotics club', date: '2026-09-07', endDate: '2026-09-21', weekdays: [1, 3], warnings: [] },
      // Jun 15..19 (5 days)
      { title: 'Summer camp', date: '2026-06-15', endDate: '2026-06-19', weekdays: [0, 1, 2, 3, 4, 5, 6], warnings: [] },
      // 2026-09-05 is Saturday (6)
      { title: 'Library storytime', date: '2026-09-05', endDate: '2026-09-26', weekdays: [6], warnings: [] }
    ]);
  });

  it('flags multi-day, midnight-spanning, missing end time, unknown TZID, unsupported/zero-occurrence RRULE, EXDATE, CANCELLED, and RECURRENCE-ID', () => {
    const ics = wrap(
      vevent([
        'UID:multiday@example.test',
        'SUMMARY:Spring break',
        'DTSTART;VALUE=DATE:20260316',
        'DTEND;VALUE=DATE:20260320'
      ]),
      vevent([
        'UID:midnight@example.test',
        'SUMMARY:Overnight lock-in',
        'DTSTART:20260410T210000',
        'DTEND:20260411T070000'
      ]),
      vevent([
        'UID:no-end@example.test',
        'SUMMARY:Quick drop-off',
        'DTSTART:20260412T080000'
      ]),
      vevent([
        'UID:bad-tz@example.test',
        'SUMMARY:Mars webinar',
        'DTSTART;TZID=Mars/Olympus_Mons:20260414T100000',
        'DTEND;TZID=Mars/Olympus_Mons:20260414T110000'
      ]),
      vevent([
        'UID:monthly@example.test',
        'SUMMARY:PTA meeting',
        'DTSTART:20260415T180000',
        'DTEND:20260415T190000',
        'RRULE:FREQ=MONTHLY;BYDAY=3WE'
      ]),
      vevent([
        'UID:zero-occ@example.test',
        'SUMMARY:No matching weekday',
        // 2026-04-15 is Wednesday; UNTIL 2026-04-16 is Thursday; BYDAY=SA has zero occurrences
        'DTSTART;VALUE=DATE:20260415',
        'RRULE:FREQ=WEEKLY;BYDAY=SA;UNTIL=20260416'
      ]),
      vevent([
        'UID:with-exdate@example.test',
        'SUMMARY:Weekly tutoring',
        'DTSTART:20260416T160000',
        'DTEND:20260416T170000',
        'RRULE:FREQ=WEEKLY;BYDAY=TH',
        'EXDATE:20260423T160000'
      ]),
      vevent([
        'UID:cancelled@example.test',
        'SUMMARY:Rainout game',
        'STATUS:CANCELLED',
        'DTSTART;VALUE=DATE:20260418'
      ]),
      vevent([
        'UID:override@example.test',
        'RECURRENCE-ID:20260420T160000',
        'SUMMARY:Moved practice',
        'DTSTART:20260420T170000',
        'DTEND:20260420T180000'
      ])
    );

    const parsed = parseIcsCalendar(ics, 'America/Chicago');
    expect(parsed.error).toBeUndefined();
    expect(parsed.events.map(event => ({ uid: event.sourceUid, warnings: event.warnings, blocking: event.blockingWarnings }))).toEqual([
      { uid: 'multiday@example.test', warnings: ['multi_day'], blocking: true },
      { uid: 'midnight@example.test', warnings: ['spans_midnight'], blocking: true },
      { uid: 'no-end@example.test', warnings: ['missing_end_time'], blocking: true },
      { uid: 'bad-tz@example.test', warnings: ['unknown_timezone'], blocking: true },
      { uid: 'monthly@example.test', warnings: ['unsupported_rrule'], blocking: true },
      { uid: 'zero-occ@example.test', warnings: ['unsupported_rrule'], blocking: true },
      { uid: 'with-exdate@example.test', warnings: ['unsupported_rrule'], blocking: true },
      { uid: 'cancelled@example.test', warnings: ['cancelled'], blocking: true },
      { uid: 'override@example.test', warnings: ['recurrence_override'], blocking: true }
    ]);
  });

  it('truncates oversized title, location, and description with a non-blocking notice and enforces file and event bounds', () => {
    const longIcs = wrap(vevent([
      'UID:long-fields@example.test',
      `SUMMARY:${'A'.repeat(150)}`,
      `LOCATION:${'L'.repeat(250)}`,
      `DESCRIPTION:${'D'.repeat(1200)}`,
      'DTSTART;VALUE=DATE:20260501'
    ]));
    const parsed = parseIcsCalendar(longIcs, 'America/Chicago');
    expect(parsed.error).toBeUndefined();
    expect(parsed.events[0].title).toHaveLength(120);
    expect(parsed.events[0].location).toHaveLength(200);
    expect(parsed.events[0].description).toHaveLength(1000);
    expect(parsed.events[0].warnings).toEqual(['truncated_fields']);
    expect(parsed.events[0].blockingWarnings).toBe(false);

    expect(parseIcsCalendar('', 'America/Chicago').error).toBe('empty');
    expect(parseIcsCalendar('not a calendar file', 'America/Chicago').error).toBe('no_events');
    expect(parseIcsCalendar('x'.repeat(MAX_ICS_BYTES + 1), 'America/Chicago').error).toBe('too_large');

    const tooMany = wrap(...Array.from({ length: MAX_ICS_EVENTS + 1 }, (_, index) => vevent([
      `UID:evt-${index}@example.test`,
      `SUMMARY:Event ${index}`,
      'DTSTART;VALUE=DATE:20260501'
    ])));
    expect(parseIcsCalendar(tooMany, 'America/Chicago').error).toBe('too_many');
  });
});

describe('buildImportReview duplicate detection', () => {
  it('matches duplicates by UID and normalized title/date/time in both directions without false positives', () => {
    expect(normalizeEventTitle('  Soccer   Practice ')).toBe('soccer practice');
    const existing: ExistingCalendarEvent[] = [
      { id: 'evt-uid', title: 'Renamed Locally', date: '2026-11-10', endDate: null, startTime: '17:00', endTime: '18:00', allDay: false, weekdays: [], sourceUid: 'uid-match@example.test' },
      { id: 'evt-prob', title: 'Band Concert', date: '2026-11-12', endDate: null, startTime: '19:00', endTime: '20:30', allDay: false, weekdays: [], sourceUid: null }
    ];

    const ics = wrap(
      // Matches by UID even though local title was edited
      vevent([
        'UID:uid-match@example.test',
        'SUMMARY:Original Practice Title',
        'DTSTART:20261110T170000',
        'DTEND:20261110T180000'
      ]),
      // Probable match: same normalized title, date, start time
      vevent([
        'UID:different-uid@example.test',
        'SUMMARY:  band   concert ',
        'DTSTART:20261112T190000',
        'DTEND:20261112T200000'
      ]),
      // Non-match: same title & date, different start time
      vevent([
        'UID:other-time@example.test',
        'SUMMARY:Band Concert',
        'DTSTART:20261112T150000',
        'DTEND:20261112T160000'
      ]),
      // Non-match: different title on same date & time
      vevent([
        'UID:other-title@example.test',
        'SUMMARY:Choir Concert',
        'DTSTART:20261112T190000',
        'DTEND:20261112T203000'
      ]),
      // Within-batch duplicate of Choir Concert
      vevent([
        'UID:batch-dup@example.test',
        'SUMMARY:Choir   concert',
        'DTSTART:20261112T190000',
        'DTEND:20261112T203000'
      ])
    );

    const parsed = parseIcsCalendar(ics, 'America/Chicago');
    const review = buildImportReview(parsed.events, existing, 'America/Chicago');

    expect(review.items[0]).toMatchObject({ action: 'skip', existing: { kind: 'uid', eventId: 'evt-uid' }, duplicateOfBatch: false });
    expect(review.items[1]).toMatchObject({ action: 'skip', existing: { kind: 'probable', eventId: 'evt-prob' }, duplicateOfBatch: false });
    expect(review.items[2]).toMatchObject({ action: 'import', existing: null, duplicateOfBatch: false });
    expect(review.items[3]).toMatchObject({ action: 'import', existing: null, duplicateOfBatch: false });
    expect(review.items[4]).toMatchObject({ action: 'skip', existing: null, duplicateOfBatch: true });
    expect(review).toMatchObject({ toImport: 2, toSkip: 3, duplicateCount: 3 });
  });

  it('excludes skipped rows from within-batch duplicate tracking when overrides skip the earlier row', () => {
    const ics = wrap(
      vevent([
        'UID:first-copy@example.test',
        'SUMMARY:Team photo',
        'DTSTART;VALUE=DATE:20261120'
      ]),
      vevent([
        'UID:second-copy@example.test',
        'SUMMARY:Team photo',
        'DTSTART;VALUE=DATE:20261120'
      ])
    );
    const parsed = parseIcsCalendar(ics, 'America/Chicago');
    const review = buildImportReview(parsed.events, [], 'America/Chicago', {
      'ics:0': { action: 'skip' },
      'ics:1': { action: 'import' }
    });
    expect(review.items[0]).toMatchObject({ action: 'skip', duplicateOfBatch: false });
    expect(review.items[1]).toMatchObject({ action: 'import', duplicateOfBatch: false });
  });
});
