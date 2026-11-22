import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../src/lib/server/identity';
import { createEvent } from '../src/lib/server/calendar';
import { createChore } from '../src/lib/server/chores';
import { DISPLAY_SHARED_PAGE_SIZE, displayChoices, displayData, setDisplayVisibility } from '../src/lib/server/display';
import { createSeries, generateOccurrences, skipOccurrence } from '../src/lib/server/recurring';

it('shares only parent-selected household fields and allows revocation', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON'); await migrate(db);
    for (const id of ['parent', 'kid', 'outsider']) db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, `${id}@example.test`);
    for (const id of ['home', 'other']) db.prepare('INSERT INTO household VALUES (?, ?)').run(id, id);
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('parent', 'home', 'parent');
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('kid', 'home', 'kid');
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('outsider', 'other', 'parent');
    const event = createEvent(db, 'parent', 'home', { title: 'Shared event', date: '2026-10-30', allDay: true, description: 'Private event details', location: 'Private location' });
    const chore = createChore(db, 'parent', 'home', { title: 'Shared chore', description: 'Private chore details', assigneeId: 'kid', dueDate: '2026-10-30', rewardCents: 200 });
    const snapshot = () => displayData(db, 'kid', 'home', '2026-10-30', '2026-11-06');
    expect(snapshot()).toMatchObject({ events: [], chores: [], canManage: false });
    expect(() => setDisplayVisibility(db, 'kid', 'home', 'event', event, true)).toThrow();
    expect(() => setDisplayVisibility(db, 'outsider', 'other', 'event', event, true)).toThrow();
    expect(() => displayData(db, 'outsider', 'home', '2026-10-30', '2026-11-06')).toThrow();
    setDisplayVisibility(db, 'parent', 'home', 'event', event, true);
    setDisplayVisibility(db, 'parent', 'home', 'chore', chore, true);
    const later = createEvent(db, 'parent', 'home', { title: 'Later event', date: '2027-01-01', allDay: true });
    setDisplayVisibility(db, 'parent', 'home', 'event', later, true);
    expect(displayChoices(db, 'parent', 'home', '2026-10-30', '2026-11-06', 1).shared.items.map(item => item.id)).toContain(later);
    expect(snapshot().events).toMatchObject([{ title: 'Shared event' }]);
    expect(snapshot().chores).toMatchObject([{ title: 'Shared chore', status: 'todo' }]);
    expect(JSON.stringify(snapshot())).not.toMatch(/Private|reward|assignee/i);
    expect(snapshot().chores[0]).toEqual({ id: chore, title: 'Shared chore', status: 'todo' });
    setDisplayVisibility(db, 'parent', 'home', 'event', event, false);
    expect(snapshot().events).toEqual([]);
    expect(displayData(db, 'outsider', 'other', '2026-10-30', '2026-11-06')).toMatchObject({ events: [], chores: [] });
    const series = createSeries(db, 'parent', 'home', { title: 'Skipped chore', assigneeId: 'kid', startDate: '2026-10-30', weekdays: [5] });
    generateOccurrences(db, 'parent', 'home', '2026-10-30', '2026-10-30');
    const occurrence = db.prepare('SELECT chore_id FROM recurring_occurrence WHERE series_id = ?').get(series) as { chore_id: string };
    setDisplayVisibility(db, 'parent', 'home', 'chore', occurrence.chore_id, true);
    skipOccurrence(db, 'parent', 'home', series, '2026-10-30');
    expect(snapshot().chores.map(item => item.title)).not.toContain('Skipped chore');
  } finally { db.close(); }
});

async function household() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON'); await migrate(db);
  for (const id of ['parent', 'kid', 'outsider']) db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, `${id}@example.test`);
  for (const id of ['home', 'other']) db.prepare('INSERT INTO household VALUES (?, ?)').run(id, id);
  db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('parent', 'home', 'parent');
  db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('kid', 'home', 'kid');
  db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('outsider', 'other', 'parent');
  return db;
}

const today = '2026-10-30';
const end = '2026-11-06';
const titles = (items: { title: string }[]) => items.map(item => item.title);

it('offers only window records to share, while every current selection stays removable', async () => {
  const db = await household();
  try {
    const event = (title: string, date: string, extra: Record<string, unknown> = {}) => createEvent(db, 'parent', 'home', { title, date, allDay: true, ...extra });
    const chore = (title: string, dueDate: string) => createChore(db, 'parent', 'home', { title, assigneeId: 'kid', dueDate });
    const oldEvent = event('Old unshared event', '2024-03-01');
    const oldSharedEvent = event('Old shared event', '2024-04-01');
    const futureSharedEvent = event('Far future shared event', '2027-02-01');
    const cancelledShared = event('Cancelled shared event', today);
    event('Cancelled unshared event', today);
    event('Window event', '2026-11-03');
    event('Past single-day event', '2026-10-29');
    event('Ongoing weekly series', '2025-01-03', { weekdays: [5] });
    event('Ended weekly series', '2025-01-03', { weekdays: [5], endDate: '2025-06-01' });
    chore('Old unshared chore', '2024-05-01');
    const oldSharedChore = chore('Old shared chore', '2024-05-02');
    chore('Today chore', today);
    chore('Window chore', '2026-11-05');
    chore('After window chore', '2026-11-07');
    for (const id of [oldSharedEvent, futureSharedEvent, cancelledShared]) setDisplayVisibility(db, 'parent', 'home', 'event', id, true);
    setDisplayVisibility(db, 'parent', 'home', 'chore', oldSharedChore, true);
    db.prepare('UPDATE calendar_event SET cancelled = 1 WHERE title LIKE ?').run('Cancelled %');

    const choices = displayChoices(db, 'parent', 'home', today, end, 1);
    expect(titles(choices.window.events)).toEqual(['Ongoing weekly series', 'Window event']);
    expect(titles(choices.window.chores)).toEqual(['Today chore', 'Window chore']);
    expect(choices.shared.items.map(item => [item.kind, item.title])).toEqual([
      ['event', 'Far future shared event'],
      ['event', 'Cancelled shared event'],
      ['chore', 'Old shared chore'],
      ['event', 'Old shared event']
    ]);
    expect(choices.shared).toMatchObject({ page: 1, pageCount: 1, total: 4 });
    expect(JSON.stringify(choices)).not.toContain('Old unshared');
    expect(choices.window.events.every(item => !item.shared)).toBe(true);

    // Old selections are removable from the shared list, and leave it once removed.
    setDisplayVisibility(db, 'parent', 'home', 'event', oldSharedEvent, false);
    setDisplayVisibility(db, 'parent', 'home', 'chore', oldSharedChore, false);
    setDisplayVisibility(db, 'parent', 'home', 'event', cancelledShared, false);
    expect(titles(displayChoices(db, 'parent', 'home', today, end, 1).shared.items)).toEqual(['Far future shared event']);
    // Old unshared records cannot be found here, but a forged share of one is still household-checked.
    expect(() => setDisplayVisibility(db, 'outsider', 'other', 'event', oldEvent, true)).toThrow();
    expect(() => setDisplayVisibility(db, 'kid', 'home', 'event', oldEvent, false)).toThrow();

    // A window record shared stays in the window list with its state, not duplicated below.
    const windowEvent = choices.window.events.find(item => item.title === 'Window event')!;
    setDisplayVisibility(db, 'parent', 'home', 'event', windowEvent.id, true);
    const after = displayChoices(db, 'parent', 'home', today, end, 1);
    expect(after.window.events.find(item => item.id === windowEvent.id)?.shared).toBe(1);
    expect(after.shared.items.map(item => item.id)).not.toContain(windowEvent.id);
  } finally { db.close(); }
});

it('paginates current selections and clamps a page past the end', async () => {
  const db = await household();
  try {
    for (let day = 1; day <= DISPLAY_SHARED_PAGE_SIZE + 3; day++) {
      const id = createChore(db, 'parent', 'home', { title: `Old chore ${String(day).padStart(2, '0')}`, assigneeId: 'kid', dueDate: `2025-01-${String(day).padStart(2, '0')}` });
      setDisplayVisibility(db, 'parent', 'home', 'chore', id, true);
    }
    const first = displayChoices(db, 'parent', 'home', today, end, 1);
    expect(first.shared).toMatchObject({ page: 1, pageCount: 2, total: DISPLAY_SHARED_PAGE_SIZE + 3 });
    expect(first.shared.items).toHaveLength(DISPLAY_SHARED_PAGE_SIZE);
    expect(first.shared.items[0].title).toBe(`Old chore ${DISPLAY_SHARED_PAGE_SIZE + 3}`);
    const second = displayChoices(db, 'parent', 'home', today, end, 2);
    expect(titles(second.shared.items)).toEqual(['Old chore 03', 'Old chore 02', 'Old chore 01']);
    expect(displayChoices(db, 'parent', 'home', today, end, 99).shared).toMatchObject({ page: 2, items: second.shared.items });
    expect(displayChoices(db, 'parent', 'home', today, end, 0).shared.page).toBe(1);
  } finally { db.close(); }
});

it('limits sharing choices to the parent household', async () => {
  const db = await household();
  try {
    const mine = createEvent(db, 'parent', 'home', { title: 'Home old event', date: '2024-01-01', allDay: true });
    setDisplayVisibility(db, 'parent', 'home', 'event', mine, true);
    createEvent(db, 'outsider', 'other', { title: 'Other window event', date: today, allDay: true });
    expect(() => displayChoices(db, 'kid', 'home', today, end, 1)).toThrow('Not authorized');
    expect(() => displayChoices(db, 'outsider', 'home', today, end, 1)).toThrow('Not authorized');
    db.prepare("INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('coparent', 'coparent', 'coparent@example.test', 0, 0, 0)").run();
    db.prepare("INSERT INTO membership (user_id, household_id, role) VALUES ('coparent', 'home', 'parent')").run();
    db.prepare("UPDATE membership SET disabled_at = 1, disabled_by = 'coparent' WHERE user_id = 'parent'").run();
    expect(() => displayChoices(db, 'parent', 'home', today, end, 1)).toThrow('Not authorized');
    const other = displayChoices(db, 'outsider', 'other', today, end, 1);
    expect(titles(other.window.events)).toEqual(['Other window event']);
    expect(other.shared.items).toEqual([]);
    expect(displayData(db, 'kid', 'home', today, end).canManage).toBe(false);
  } finally { db.close(); }
});

it('indexes the sharing reads by household', async () => {
  const db = await household();
  try {
    await migrate(db);
    const names = ['calendar_event_household_start', 'chore_household_due', 'display_chore_household', 'display_event_household'];
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name IN (${names.map(() => '?').join(', ')}) ORDER BY name`).all(...names)).toEqual(names.map(name => ({ name })));
  } finally { db.close(); }
});
