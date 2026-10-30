import type Database from 'better-sqlite3';
import { listEvents } from './calendar';

type Kind = 'event' | 'chore';

function membership(db: Database.Database, actor: string, household: string) {
  const member = db.prepare('SELECT role FROM membership WHERE user_id = ? AND household_id = ?').get(actor, household) as { role: string } | undefined;
  if (!member) throw new Error('Not authorized');
  return member.role;
}

export function setDisplayVisibility(db: Database.Database, actor: string, household: string, kind: Kind, id: string, visible: boolean) {
  db.transaction(() => {
    if (membership(db, actor, household) !== 'parent') throw new Error('Not authorized');
    if (kind !== 'event' && kind !== 'chore') throw new Error('Invalid item');
    const table = kind === 'event' ? 'calendar_event' : 'chore';
    const display = kind === 'event' ? 'display_event' : 'display_chore';
    const column = kind === 'event' ? 'event_id' : 'chore_id';
    if (!db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND household_id = ?`).get(id, household)) throw new Error('Item not found');
    if (visible) db.prepare(`INSERT OR IGNORE INTO ${display} (${column}, household_id) VALUES (?, ?)`).run(id, household);
    else db.prepare(`DELETE FROM ${display} WHERE ${column} = ? AND household_id = ?`).run(id, household);
  }).immediate();
}

export function displayData(db: Database.Database, actor: string, household: string, today: string, end: string) {
  const role = membership(db, actor, household);
  const sharedEvents = new Set((db.prepare('SELECT event_id FROM display_event WHERE household_id = ?').all(household) as { event_id: string }[]).map(row => row.event_id));
  const events = listEvents(db, actor, household, today, end);
  const publicEvents = events.filter(event => sharedEvents.has(event.id)).map(({ id, title, date, startTime, endTime, allDay }) => ({ id, title, date, startTime, endTime, allDay }));
  const visibleChores = `FROM chore c LEFT JOIN recurring_occurrence o ON o.chore_id = c.id LEFT JOIN recurring_series r ON r.id = o.series_id WHERE c.household_id = ? AND c.due_date = ? AND NOT EXISTS (SELECT 1 FROM recurring_skip s WHERE s.series_id = o.series_id AND s.scheduled_date = o.scheduled_date) AND NOT (r.state IS NOT NULL AND r.state != 'active' AND c.status = 'todo' AND o.scheduled_date >= ?)`;
  const chores = db.prepare(`SELECT c.id, c.title, c.status ${visibleChores} AND EXISTS (SELECT 1 FROM display_chore d WHERE d.chore_id = c.id AND d.household_id = c.household_id) ORDER BY c.title`).all(household, today, today) as { id: string; title: string; status: string }[];
  const choices = role === 'parent' ? {
    events: db.prepare('SELECT e.id, e.title, EXISTS(SELECT 1 FROM display_event d WHERE d.event_id = e.id AND d.household_id = e.household_id) AS shared FROM calendar_event e WHERE e.household_id = ? AND (e.cancelled = 0 OR EXISTS(SELECT 1 FROM display_event d WHERE d.event_id = e.id AND d.household_id = e.household_id)) ORDER BY e.start_date, e.title').all(household) as { id: string; title: string; shared: number }[],
    chores: db.prepare('SELECT c.id, c.title, EXISTS(SELECT 1 FROM display_chore d WHERE d.chore_id = c.id AND d.household_id = c.household_id) AS shared FROM chore c WHERE c.household_id = ? AND (c.due_date = ? OR EXISTS(SELECT 1 FROM display_chore d WHERE d.chore_id = c.id AND d.household_id = c.household_id)) ORDER BY c.due_date, c.title').all(household, today) as { id: string; title: string; shared: number }[]
  } : null;
  return { events: publicEvents, chores, choices };
}
