import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../src/lib/server/identity';
import { createEvent } from '../src/lib/server/calendar';
import { createChore } from '../src/lib/server/chores';
import { displayData, setDisplayVisibility } from '../src/lib/server/display';
import { createSeries, generateOccurrences, skipOccurrence } from '../src/lib/server/recurring';

it('shares only parent-selected household fields and allows revocation', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON'); await migrate(db);
    for (const id of ['parent', 'kid', 'outsider']) db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, `${id}@example.test`);
    for (const id of ['home', 'other']) db.prepare('INSERT INTO household VALUES (?, ?)').run(id, id);
    db.prepare('INSERT INTO membership VALUES (?, ?, ?)').run('parent', 'home', 'parent');
    db.prepare('INSERT INTO membership VALUES (?, ?, ?)').run('kid', 'home', 'kid');
    db.prepare('INSERT INTO membership VALUES (?, ?, ?)').run('outsider', 'other', 'parent');
    const event = createEvent(db, 'parent', 'home', { title: 'Shared event', date: '2026-10-30', allDay: true, description: 'Private event details', location: 'Private location' });
    const chore = createChore(db, 'parent', 'home', { title: 'Shared chore', description: 'Private chore details', assigneeId: 'kid', dueDate: '2026-10-30', rewardCents: 200 });
    const snapshot = () => displayData(db, 'kid', 'home', '2026-10-30', '2026-11-06');
    expect(snapshot()).toMatchObject({ events: [], chores: [], choices: null });
    expect(() => setDisplayVisibility(db, 'kid', 'home', 'event', event, true)).toThrow();
    expect(() => setDisplayVisibility(db, 'outsider', 'other', 'event', event, true)).toThrow();
    expect(() => displayData(db, 'outsider', 'home', '2026-10-30', '2026-11-06')).toThrow();
    setDisplayVisibility(db, 'parent', 'home', 'event', event, true);
    setDisplayVisibility(db, 'parent', 'home', 'chore', chore, true);
    const later = createEvent(db, 'parent', 'home', { title: 'Later event', date: '2027-01-01', allDay: true });
    setDisplayVisibility(db, 'parent', 'home', 'event', later, true);
    expect(displayData(db, 'parent', 'home', '2026-10-30', '2026-11-06').choices?.events.map(item => item.id)).toContain(later);
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
