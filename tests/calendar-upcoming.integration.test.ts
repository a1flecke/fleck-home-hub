import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../src/lib/server/identity';
import { cancelEvent, cancelOccurrence, createEvent, listUpcomingEvents } from '../src/lib/server/calendar';
import { localDate } from '../src/lib/chores/recurrence';
import { addCalendarDays } from '../src/lib/calendar/dates';

async function household() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  await migrate(db);
  for (const id of ['parent', 'kid', 'outsider']) db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, `${id}@example.test`);
  for (const id of ['home', 'elsewhere']) db.prepare('INSERT INTO household VALUES (?, ?)').run(id, id);
  db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('parent', 'home', 'parent');
  db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('kid', 'home', 'kid');
  db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('outsider', 'elsewhere', 'parent');
  return db;
}

it('projects only authorized upcoming occurrences with no private fields', async () => {
  const db = await household();
  try {
    const allDay = createEvent(db, 'parent', 'home', { title: 'All day', date: '2027-01-01', allDay: true, description: 'Private description', location: 'Private location', participants: ['kid'] });
    const timed = createEvent(db, 'parent', 'home', { title: 'Timed', date: '2027-01-01', startTime: '09:00', endTime: '10:00', allDay: false });
    createEvent(db, 'parent', 'home', { title: 'Before range', date: '2026-12-31', allDay: true });
    createEvent(db, 'parent', 'home', { title: 'After range', date: '2027-01-08', allDay: true });
    const other = createEvent(db, 'outsider', 'elsewhere', { title: 'Other household', date: '2027-01-01', allDay: true });

    const events = listUpcomingEvents(db, 'parent', 'home', '2027-01-01', '2027-01-07');
    expect(events).toEqual([
      { id: allDay, date: '2027-01-01', title: 'All day', startTime: null, endTime: null, allDay: true },
      { id: timed, date: '2027-01-01', title: 'Timed', startTime: '09:00', endTime: '10:00', allDay: false },
    ]);
    expect(listUpcomingEvents(db, 'kid', 'home', '2027-01-01', '2027-01-07')).toEqual(events);
    expect(listUpcomingEvents(db, 'outsider', 'elsewhere', '2027-01-01', '2027-01-07')).toEqual([
      { id: other, date: '2027-01-01', title: 'Other household', startTime: null, endTime: null, allDay: true },
    ]);
    expect(() => listUpcomingEvents(db, 'outsider', 'home', '2027-01-01', '2027-01-07')).toThrow();
  } finally { db.close(); }
});

it('derives a seven-date range from a household-local today across a year boundary', async () => {
  const db = await household();
  try {
    const today = localDate(new Date('2026-12-31T12:30:00.000Z'), 'Pacific/Kiritimati');
    const through = addCalendarDays(today, 6);
    expect(today).toBe('2027-01-01');
    expect(through).toBe('2027-01-07');
    createEvent(db, 'parent', 'home', { title: 'Yesterday', date: '2026-12-31', allDay: true });
    createEvent(db, 'parent', 'home', { title: 'Today', date: today, allDay: true });
    createEvent(db, 'parent', 'home', { title: 'Last included date', date: through, allDay: true });
    createEvent(db, 'parent', 'home', { title: 'Tomorrow after range', date: addCalendarDays(through, 1), allDay: true });
    expect(listUpcomingEvents(db, 'kid', 'home', today, through).map(event => event.title)).toEqual(['Today', 'Last included date']);
  } finally { db.close(); }
});

it('follows recurring occurrence and series cancellation', async () => {
  const db = await household();
  try {
    const id = createEvent(db, 'parent', 'home', { title: 'Weekly', date: '2027-01-03', allDay: true, weekdays: [0], endDate: '2027-01-17' });
    expect(listUpcomingEvents(db, 'kid', 'home', '2027-01-01', '2027-01-17').map(event => event.date)).toEqual(['2027-01-03', '2027-01-10', '2027-01-17']);
    cancelOccurrence(db, 'parent', 'home', id, '2027-01-10');
    expect(listUpcomingEvents(db, 'kid', 'home', '2027-01-01', '2027-01-17').map(event => event.date)).toEqual(['2027-01-03', '2027-01-17']);
    cancelEvent(db, 'parent', 'home', id);
    expect(listUpcomingEvents(db, 'kid', 'home', '2027-01-01', '2027-01-17')).toEqual([]);
  } finally { db.close(); }
});
