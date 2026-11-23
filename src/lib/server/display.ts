import type Database from 'better-sqlite3';
import { householdEventOccurrences } from './calendar';
import { householdSharedMeals } from './meals';
import type { VerifiedDisplay } from './display-pairing';

type Kind = 'event' | 'chore';

function membership(db: Database.Database, actor: string, household: string) {
  const member = db.prepare('SELECT role FROM active_membership WHERE user_id = ? AND household_id = ?').get(actor, household) as { role: string } | undefined;
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

/**
 * The one read-only display projection. It takes a household id that the caller has already
 * authenticated (a member session or a verified display credential) and returns only what a
 * parent explicitly shared: no notes, descriptions, locations, assignees, rewards or balances.
 */
function sharedProjection(db: Database.Database, household: string, today: string, end: string) {
  const sharedEvents = new Set((db.prepare('SELECT event_id FROM display_event WHERE household_id = ?').all(household) as { event_id: string }[]).map(row => row.event_id));
  const events = householdEventOccurrences(db, household, today, end)
    .filter(event => sharedEvents.has(event.id)).map(({ id, title, date, startTime, endTime, allDay }) => ({ id, title, date, startTime, endTime, allDay }));
  const visibleChores = `FROM chore c LEFT JOIN recurring_occurrence o ON o.chore_id = c.id LEFT JOIN recurring_series r ON r.id = o.series_id WHERE c.household_id = ? AND c.due_date = ? AND c.cancelled_at IS NULL AND NOT EXISTS (SELECT 1 FROM recurring_skip s WHERE s.series_id = o.series_id AND s.scheduled_date = o.scheduled_date) AND NOT (r.state IS NOT NULL AND r.state != 'active' AND c.status = 'todo' AND o.scheduled_date >= ?)`;
  const chores = db.prepare(`SELECT c.id, c.title, c.status ${visibleChores} AND EXISTS (SELECT 1 FROM display_chore d WHERE d.chore_id = c.id AND d.household_id = c.household_id) ORDER BY c.title`).all(household, today, today) as { id: string; title: string; status: string }[];
  const meals = householdSharedMeals(db, household, today).filter(meal => meal.shared).map(({ id, title, time, servings, ingredients, source, recipeUrl, recipeDetails }) => ({ id, title, time, servings, ingredients, source, recipeUrl, recipeDetails }));
  return { events, chores, meals };
}

/** Projection for a paired display. The household comes only from a verified display credential. */
export function displayDataForDevice(db: Database.Database, display: VerifiedDisplay, today: string, end: string) {
  return sharedProjection(db, display.householdId, today, end);
}

export function displayData(db: Database.Database, actor: string, household: string, today: string, end: string) {
  const role = membership(db, actor, household);
  const { events, chores, meals } = sharedProjection(db, household, today, end);
  return { events, chores, meals, canManage: role === 'parent' };
}

export const DISPLAY_SHARED_PAGE_SIZE = 20;

/**
 * An event series belongs to the sharing window when it is active and can occur between `today`
 * and `end`; a one-off event must start in the window. Takes `end`, `today`, `today`.
 */
const windowEvent = `e.cancelled = 0 AND e.start_date <= ? AND (e.end_date IS NULL OR e.end_date >= ?) AND (e.weekdays IS NOT NULL OR e.start_date >= ?)`;

/**
 * Chores due in the sharing window that the display could show on their day: skipped and
 * paused unstarted recurring occurrences are excluded as in the projection. Takes household,
 * `today`, `end`, `today`.
 */
const windowChores = `SELECT c.id, c.title, c.due_date AS date FROM chore c LEFT JOIN recurring_occurrence o ON o.chore_id = c.id LEFT JOIN recurring_series r ON r.id = o.series_id WHERE c.household_id = ? AND c.due_date BETWEEN ? AND ? AND c.cancelled_at IS NULL AND NOT EXISTS (SELECT 1 FROM recurring_skip s WHERE s.series_id = o.series_id AND s.scheduled_date = o.scheduled_date) AND NOT (r.state IS NOT NULL AND r.state != 'active' AND c.status = 'todo' AND o.scheduled_date >= ?)`;

/**
 * Bounded sharing choices for a parent (ADR 0007). `window` lists what can be shared for the
 * display window, with each record's current state. `shared` pages through every other current
 * selection, so one that has left the window (past, far future, cancelled or skipped) can still be
 * removed. Neither list depends on unshared history outside the window.
 */
export function displayChoices(db: Database.Database, actor: string, household: string, today: string, end: string, page: number) {
  if (membership(db, actor, household) !== 'parent') throw new Error('Not authorized');
  const events = db.prepare(`SELECT e.id, e.title, e.start_date AS date, e.weekdays IS NOT NULL AS repeats, EXISTS(SELECT 1 FROM display_event d WHERE d.event_id = e.id AND d.household_id = e.household_id) AS shared FROM calendar_event e WHERE e.household_id = ? AND ${windowEvent} ORDER BY e.start_date, e.title, e.id`)
    .all(household, end, today, today) as { id: string; title: string; date: string; repeats: number; shared: number }[];
  const chores = db.prepare(`SELECT w.id, w.title, w.date, EXISTS(SELECT 1 FROM display_chore d WHERE d.chore_id = w.id AND d.household_id = ?) AS shared FROM (${windowChores}) w ORDER BY w.date, w.title, w.id`)
    .all(household, household, today, end, today) as { id: string; title: string; date: string; shared: number }[];
  const outside = `SELECT 'event' AS kind, e.id, e.title, e.start_date AS date, e.weekdays IS NOT NULL AS repeats, e.cancelled FROM display_event d JOIN calendar_event e ON e.id = d.event_id AND e.household_id = d.household_id WHERE d.household_id = ? AND NOT (${windowEvent})
    UNION ALL SELECT 'chore' AS kind, c.id, c.title, c.due_date AS date, 0 AS repeats, c.cancelled_at IS NOT NULL AS cancelled FROM display_chore d JOIN chore c ON c.id = d.chore_id AND c.household_id = d.household_id WHERE d.household_id = ? AND c.id NOT IN (SELECT id FROM (${windowChores}))`;
  const params = [household, end, today, today, household, household, today, end, today];
  const total = (db.prepare(`SELECT COUNT(*) AS total FROM (${outside})`).get(...params) as { total: number }).total;
  const pageCount = Math.max(1, Math.ceil(total / DISPLAY_SHARED_PAGE_SIZE));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const items = db.prepare(`SELECT * FROM (${outside}) ORDER BY date DESC, kind, title, id LIMIT ? OFFSET ?`)
    .all(...params, DISPLAY_SHARED_PAGE_SIZE, (current - 1) * DISPLAY_SHARED_PAGE_SIZE) as { kind: Kind; id: string; title: string; date: string; repeats: number; cancelled: number }[];
  return { window: { events, chores }, shared: { items, page: current, pageCount, total } };
}
