import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { occurrenceDates } from '../chores/recurrence';
import { addCalendarDays } from '../calendar/dates';
import { listEvents, listUpcomingEvents } from './calendar';

type Input = { name: string; description: string; targetDate: string; shared?: boolean };
type List = { id: string; name: string; description: string | null; targetDate: string | null; shared: boolean; archived: boolean; version: number };
type Item = {
  id: string; name: string; completed: boolean; completedBy: string | null; completedByName: string | null;
  completedAt: string | null; version: number; assignedTo: string | null; assigneeName: string | null; assigneeActive: boolean;
};

type ListRow = Omit<List, 'shared' | 'archived'> & { shared: number; archived: number };
const listFields = 'id, name, description, target_date AS targetDate, shared, archived, version';

function toList(row: ListRow): List {
  return { ...row, shared: !!row.shared, archived: !!row.archived };
}

export class ChecklistConflict extends Error {}

function member(db: Database.Database, actor: string, household: string, parent = false) {
  const row = db.prepare('SELECT role FROM active_membership WHERE user_id = ? AND household_id = ?').get(actor, household) as { role: string } | undefined;
  if (!row || (parent && row.role !== 'parent')) throw new Error('Not authorized');
  return row.role;
}

function values(input: Input) {
  const name = input.name.trim(), description = input.description.trim(), targetDate = input.targetDate.trim();
  if (!name || name.length > 120 || description.length > 1000 || (input.shared !== undefined && typeof input.shared !== 'boolean')) throw new Error('Invalid checklist');
  if (targetDate) occurrenceDates(targetDate, targetDate, [0]);
  return { name, description: description || null, targetDate: targetDate || null };
}

function checkRequestId(id: string) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) throw new Error('Invalid request');
}

function readList(db: Database.Database, household: string, id: string, role: string): List {
  const row = db.prepare('SELECT ' + listFields + ' FROM family_checklist WHERE id = ? AND household_id = ? AND (? = ? OR (shared = 1 AND archived = 0))').get(id, household, role, 'parent') as ListRow | undefined;
  if (!row) throw new Error('Checklist not found');
  return toList(row);
}

function findCreateReceipt(db: Database.Database, actor: string, household: string, requestId: string) {
  return db.prepare('SELECT id, copy_fingerprint AS fingerprint FROM family_checklist WHERE household_id = ? AND created_by = ? AND create_request_id = ?')
    .get(household, actor, requestId) as { id: string; fingerprint: string | null } | undefined;
}

function insertChecklist(db: Database.Database, actor: string, household: string, v: ReturnType<typeof values>, requestId: string, shared: boolean, fingerprint: string | null) {
  const id = randomUUID(), now = new Date().toISOString();
  db.prepare('INSERT INTO family_checklist (id, household_id, name, description, target_date, shared, created_by, create_request_id, copy_fingerprint, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, household, v.name, v.description, v.targetDate, Number(shared), actor, requestId, fingerprint, now, now);
  return id;
}

function insertChecklistItems(db: Database.Database, id: string, lines: string[], after: number) {
  const insert = db.prepare('INSERT INTO family_checklist_item (id, checklist_id, name, position) VALUES (?, ?, ?, ?)');
  lines.forEach((line, index) => insert.run(randomUUID(), id, line, after + index + 1));
}

const maxChecklistItems = 500;

export function createChecklist(db: Database.Database, actor: string, household: string, input: Input, requestId = randomUUID().toString()): string {
  checkRequestId(requestId);
  return db.transaction(() => {
    member(db, actor, household, true);
    const existing = findCreateReceipt(db, actor, household, requestId);
    if (existing) {
      if (existing.fingerprint !== null) throw new ChecklistConflict('Request already used');
      return existing.id;
    }
    return insertChecklist(db, actor, household, values(input), requestId, input.shared ?? false, null);
  }).immediate();
}

export function listChecklists(db: Database.Database, actor: string, household: string): List[] {
  return db.transaction(() => {
    const role = member(db, actor, household);
    const rows = db.prepare('SELECT ' + listFields + ' FROM family_checklist WHERE household_id = ? AND (? = ? OR (shared = 1 AND archived = 0)) ORDER BY archived, created_at DESC, id').all(household, role, 'parent') as ListRow[];
    return rows.map(toList);
  })();
}

export function getChecklist(db: Database.Database, actor: string, household: string, id: string) {
  return db.transaction(() => {
    const role = member(db, actor, household);
    const list = readList(db, household, id, role);
    const items = db.prepare(`
      SELECT i.id, i.name, i.completed, i.completed_by AS completedBy, u.name AS completedByName,
        i.completed_at AS completedAt, i.version, a.member_id AS assignedTo, owner.name AS assigneeName,
        m.user_id IS NOT NULL AS assigneeActive
      FROM family_checklist_item i
      LEFT JOIN user u ON u.id = i.completed_by
      LEFT JOIN family_checklist_item_assignment a ON a.item_id = i.id
      LEFT JOIN user owner ON owner.id = a.member_id
      LEFT JOIN active_membership m ON m.user_id = a.member_id AND m.household_id = a.household_id
      WHERE i.checklist_id = ?
      ORDER BY i.position, i.id
    `).all(id) as (Omit<Item, 'completed' | 'assigneeActive'> & { completed: number; assigneeActive: number })[];
    return {
      ...list,
      items: items.map(item => {
        const completed = !!item.completed;
        return {
          ...item,
          completed,
          assigneeActive: !!item.assigneeActive,
          completedBy: completed ? item.completedBy : null,
          completedByName: completed ? item.completedByName : null,
          completedAt: completed ? item.completedAt : null
        };
      })
    };
  })();
}

export function listChecklistAssignees(db: Database.Database, actor: string, household: string) {
  return db.transaction(() => {
    member(db, actor, household, true);
    return db.prepare(`
      SELECT u.id, u.name FROM active_membership m JOIN user u ON u.id = m.user_id
      WHERE m.household_id = ? ORDER BY u.name COLLATE NOCASE, u.id
    `).all(household) as { id: string; name: string }[];
  })();
}

export function addChecklistItems(db: Database.Database, actor: string, household: string, id: string, text: string, requestId = randomUUID().toString()): void {
  checkRequestId(requestId);
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length || lines.length > 100 || text.length > 12000 || lines.some(line => line.length > 120)) throw new Error('Invalid items');
  db.transaction(() => {
    const role = member(db, actor, household, true), list = readList(db, household, id, role);
    if (list.archived) throw new Error('Checklist archived');
    const receipt = db.prepare('INSERT INTO family_checklist_add_request (checklist_id, actor_id, request_id) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').run(id, actor, requestId);
    if (!receipt.changes) return;
    const row = db.prepare('SELECT count(*) AS count, COALESCE(MAX(position), 0) AS position FROM family_checklist_item WHERE checklist_id = ?').get(id) as { count: number; position: number };
    if (row.count + lines.length > maxChecklistItems) throw new Error('Too many items');
    insertChecklistItems(db, id, lines, row.position);
  }).immediate();
}

export function setItemCompletion(db: Database.Database, actor: string, household: string, listId: string, itemId: string, version: number, completed: boolean): void {
  if (!Number.isSafeInteger(version) || version < 1 || typeof completed !== 'boolean') throw new Error('Invalid update');
  db.transaction(() => {
    const role = member(db, actor, household), list = readList(db, household, listId, role);
    if (list.archived) throw new Error('Checklist archived');
    const completedBy = completed ? actor : null;
    const completedAt = completed ? new Date().toISOString() : null;
    const result = db.prepare(`
      UPDATE family_checklist_item SET completed = ?, completed_by = ?, completed_at = ?, version = version + 1
      WHERE id = ? AND checklist_id = ? AND version = ?
        AND (? = 'parent' OR NOT EXISTS (
          SELECT 1 FROM family_checklist_item_assignment a WHERE a.item_id = family_checklist_item.id AND a.member_id <> ?
        ))
    `).run(Number(completed), completedBy, completedAt, itemId, listId, version, role, actor);
    if (!result.changes) throw new ChecklistConflict('Item changed');
  }).immediate();
}

export function updateChecklist(db: Database.Database, actor: string, household: string, id: string, version: number, input: Input & { archived: boolean }): void {
  const v = values(input);
  if (!Number.isSafeInteger(version) || version < 1 || typeof input.archived !== 'boolean') throw new Error('Invalid update');
  db.transaction(() => {
    member(db, actor, household, true);
    const result = db.prepare('UPDATE family_checklist SET name = ?, description = ?, target_date = ?, shared = ?, archived = ?, version = version + 1, updated_at = ? WHERE id = ? AND household_id = ? AND version = ?').run(v.name, v.description, v.targetDate, Number(input.shared ?? false), Number(input.archived), new Date().toISOString(), id, household, version);
    if (!result.changes) throw new ChecklistConflict('Checklist changed');
  }).immediate();
}

export function updateChecklistItem(
  db: Database.Database, actor: string, household: string, listId: string, id: string, version: number, name: string,
  assignedTo?: string | null
): void {
  name = name.trim();
  if (!name || name.length > 120 || !Number.isSafeInteger(version) || version < 1) throw new Error('Invalid item');
  db.transaction(() => {
    const role = member(db, actor, household, true), list = readList(db, household, listId, role);
    if (list.archived) throw new Error('Checklist archived');
    const result = db.prepare('UPDATE family_checklist_item SET name = ?, version = version + 1 WHERE id = ? AND checklist_id = ? AND version = ?').run(name, id, listId, version);
    if (!result.changes) throw new ChecklistConflict('Item changed');
    if (assignedTo === undefined) return;
    const previous = db.prepare('SELECT member_id FROM family_checklist_item_assignment WHERE item_id = ?').pluck().get(id) ?? null;
    if (assignedTo === previous) return;
    if (assignedTo === null) {
      db.prepare('DELETE FROM family_checklist_item_assignment WHERE item_id = ?').run(id);
      return;
    }
    if (!db.prepare('SELECT 1 FROM active_membership WHERE user_id = ? AND household_id = ?').get(assignedTo, household)) {
      throw new Error('Choose an active household member');
    }
    db.prepare(`
      INSERT INTO family_checklist_item_assignment (item_id, checklist_id, household_id, member_id) VALUES (?, ?, ?, ?)
      ON CONFLICT(item_id) DO UPDATE SET member_id = excluded.member_id
    `).run(id, listId, household, assignedTo);
  }).immediate();
}

export function removeChecklistItem(db: Database.Database, actor: string, household: string, listId: string, id: string, version: number): void {
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('Invalid update');
  db.transaction(() => {
    const role = member(db, actor, household, true), list = readList(db, household, listId, role);
    if (list.archived) throw new Error('Checklist archived');
    const result = db.prepare('DELETE FROM family_checklist_item WHERE id = ? AND checklist_id = ? AND version = ? AND completed = 0').run(id, listId, version);
    if (!result.changes) throw new Error('Item changed or completed');
  }).immediate();
}

type CopySource = { kind: 'template' | 'list'; id: string };
type Template = { id: string; name: string; description: string | null; items: string[]; version: number };
type TemplateRow = Omit<Template, 'items'> & { items: string };

function getTemplateRow(db: Database.Database, household: string, id: string): Template | null {
  const row = db.prepare('SELECT id, name, description, items, version FROM family_checklist_template WHERE household_id = ? AND id = ?')
    .get(household, id) as TemplateRow | undefined;
  return row ? { ...row, items: JSON.parse(row.items) as string[] } : null;
}

function readReusableList(db: Database.Database, household: string, id: string) {
  const list = db.prepare('SELECT name, description FROM family_checklist WHERE household_id = ? AND id = ?').get(household, id) as Pick<Template, 'name' | 'description'> | undefined;
  if (!list) return null;
  const items = db.prepare('SELECT name FROM family_checklist_item WHERE checklist_id = ? ORDER BY position, id').pluck().all(id) as string[];
  return { ...list, items };
}

export function listChecklistTemplates(db: Database.Database, actor: string, household: string) {
  return db.transaction(() => {
    member(db, actor, household, true);
    return db.prepare('SELECT id, name, description, json_array_length(items) AS itemCount FROM family_checklist_template WHERE household_id = ? ORDER BY name COLLATE NOCASE, id')
      .all(household) as (Pick<Template, 'id' | 'name' | 'description'> & { itemCount: number })[];
  })();
}

export function getChecklistTemplate(db: Database.Database, actor: string, household: string, id: string) {
  return db.transaction(() => {
    member(db, actor, household, true);
    return getTemplateRow(db, household, id);
  })();
}

export function saveChecklistTemplate(db: Database.Database, actor: string, household: string, id: string): string {
  return db.transaction(() => {
    member(db, actor, household, true);
    const source = readReusableList(db, household, id);
    if (!source) throw new Error('Checklist not found');
    const templateId = randomUUID();
    db.prepare('INSERT INTO family_checklist_template (id, household_id, name, description, items) VALUES (?, ?, ?, ?, ?)')
      .run(templateId, household, source.name, source.description, JSON.stringify(source.items));
    return templateId;
  }).immediate();
}

export function updateChecklistTemplate(db: Database.Database, actor: string, household: string, id: string, version: number, input: { name: string; description: string; items: string }): void {
  const { name, description } = values({ ...input, targetDate: '' });
  if (!Number.isSafeInteger(version) || version < 1 || input.items.length > maxChecklistItems * 122) throw new Error('Invalid template');
  const items = input.items.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (items.length > maxChecklistItems || items.some(line => line.length > 120)) throw new Error('Invalid items');
  db.transaction(() => {
    member(db, actor, household, true);
    const result = db.prepare('UPDATE family_checklist_template SET name = ?, description = ?, items = ?, version = version + 1 WHERE household_id = ? AND id = ? AND version = ?')
      .run(name, description, JSON.stringify(items), household, id, version);
    if (!result.changes) throw new ChecklistConflict('Template changed');
  }).immediate();
}

export function removeChecklistTemplate(db: Database.Database, actor: string, household: string, id: string, version: number): void {
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('Invalid template');
  db.transaction(() => {
    member(db, actor, household, true);
    const result = db.prepare('DELETE FROM family_checklist_template WHERE household_id = ? AND id = ? AND version = ?').run(household, id, version);
    if (!result.changes) throw new ChecklistConflict('Template changed');
  }).immediate();
}

function fingerprint(values: unknown[]) {
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}

function readCopySource(db: Database.Database, household: string, source: CopySource) {
  const row = source.kind === 'list' ? readReusableList(db, household, source.id) : getTemplateRow(db, household, source.id);
  if (!row) return null;
  const { name, description, items } = row;
  const version = 'version' in row ? row.version : null;
  return { name, description, items, revision: fingerprint([name, description, items, version]) };
}

export function getChecklistCopySource(db: Database.Database, actor: string, household: string, source: CopySource) {
  return db.transaction(() => {
    member(db, actor, household, true);
    return readCopySource(db, household, source);
  })();
}

export function copyChecklist(db: Database.Database, actor: string, household: string, source: CopySource, revision: string, input: Input, requestId: string): string {
  checkRequestId(requestId);
  if (!/^[a-f0-9]{64}$/.test(revision)) throw new Error('Invalid source revision');
  const v = values(input), shared = input.shared ?? false;
  const payload = fingerprint([source.kind, source.id, revision, v, shared]);
  return db.transaction(() => {
    member(db, actor, household, true);
    const existing = findCreateReceipt(db, actor, household, requestId);
    if (existing) {
      if (existing.fingerprint !== payload) throw new ChecklistConflict('Request already used');
      return existing.id;
    }
    const preview = readCopySource(db, household, source);
    if (!preview || preview.revision !== revision) throw new ChecklistConflict('Source changed');
    const id = insertChecklist(db, actor, household, v, requestId, shared, payload);
    insertChecklistItems(db, id, preview.items, 0);
    return id;
  }).immediate();
}

export type ChecklistOccurrence = { eventId: string; date: string };
type ChecklistEventLink = ChecklistOccurrence & { token: string; title: string };
export type PreparationProgress = { id: string; name: string; completed: number; total: number };

function linkedOccurrence(db: Database.Database, household: string, id: string): ChecklistEventLink | null {
  return db.prepare(`
    SELECT a.event_id AS eventId, a.occurrence_date AS date, a.token, e.title
    FROM family_checklist_event a
    JOIN calendar_event e ON e.id = a.event_id AND e.household_id = a.household_id
    WHERE a.household_id = ? AND a.checklist_id = ?
  `).get(household, id) as ChecklistEventLink | undefined ?? null;
}

function isScheduled(db: Database.Database, actor: string, household: string, { eventId, date }: ChecklistOccurrence) {
  return listEvents(db, actor, household, date, date).some(event => event.id === eventId);
}

export function getChecklistEventLink(db: Database.Database, actor: string, household: string, id: string) {
  return db.transaction(() => {
    const role = member(db, actor, household, true);
    readList(db, household, id, role);
    const link = linkedOccurrence(db, household, id);
    return link && { ...link, stale: !isScheduled(db, actor, household, link) };
  })();
}

export function listUnlinkedChecklists(db: Database.Database, actor: string, household: string) {
  return db.transaction(() => {
    member(db, actor, household, true);
    return db.prepare(`
      SELECT c.id, c.name, c.shared
      FROM family_checklist c
      LEFT JOIN family_checklist_event a ON a.checklist_id = c.id
      WHERE c.household_id = ? AND c.archived = 0 AND a.checklist_id IS NULL
      ORDER BY c.name COLLATE NOCASE, c.id
    `).all(household) as { id: string; name: string; shared: number }[];
  })();
}

function storeOccurrence(db: Database.Database, household: string, id: string, occurrence: ChecklistOccurrence) {
  db.prepare(`
    INSERT INTO family_checklist_event (checklist_id, household_id, event_id, occurrence_date, token)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(checklist_id) DO UPDATE SET
      event_id = excluded.event_id, occurrence_date = excluded.occurrence_date, token = excluded.token
  `).run(id, household, occurrence.eventId, occurrence.date, randomUUID());
}

export function setChecklistEventLink(db: Database.Database, actor: string, household: string, id: string, token: string, occurrence: ChecklistOccurrence | null): void {
  db.transaction(() => {
    const role = member(db, actor, household, true);
    const list = readList(db, household, id, role);
    const previous = linkedOccurrence(db, household, id);
    if (occurrence && (list.archived || !isScheduled(db, actor, household, occurrence))) throw new ChecklistConflict('Event occurrence unavailable');
    if (previous && occurrence?.eventId === previous.eventId && occurrence.date === previous.date) return;
    if (!previous && !occurrence) return;
    if ((previous?.token ?? '') !== token) throw new ChecklistConflict('Link changed');
    if (occurrence) storeOccurrence(db, household, id, occurrence);
    else db.prepare('DELETE FROM family_checklist_event WHERE household_id = ? AND checklist_id = ?').run(household, id);
  }).immediate();
}

export function createPreparationChecklist(db: Database.Database, actor: string, household: string, occurrence: ChecklistOccurrence, input: Input, requestId: string): string {
  const v = values(input), shared = input.shared ?? false;
  checkRequestId(requestId);
  const payload = fingerprint(['event', occurrence.eventId, occurrence.date, v, shared]);
  return db.transaction(() => {
    member(db, actor, household, true);
    const existing = findCreateReceipt(db, actor, household, requestId);
    if (existing) {
      if (existing.fingerprint !== payload) throw new ChecklistConflict('Request already used');
      return existing.id;
    }
    if (!isScheduled(db, actor, household, occurrence)) throw new ChecklistConflict('Event occurrence unavailable');
    const id = insertChecklist(db, actor, household, v, requestId, shared, payload);
    storeOccurrence(db, household, id, occurrence);
    return id;
  }).immediate();
}

/** Calendar-only projection. Display routes continue to use the existing calendar service. */
export function listCalendarPreparation(db: Database.Database, actor: string, household: string, from: string, through: string) {
  return db.transaction(() => {
    const role = member(db, actor, household);
    const events = listEvents(db, actor, household, from, through);
    const rows = db.prepare(`
      SELECT a.event_id AS eventId, a.occurrence_date AS date, c.id, c.name,
        COALESCE(SUM(i.completed), 0) AS completed, COUNT(i.id) AS total
      FROM family_checklist_event a
      JOIN family_checklist c ON c.id = a.checklist_id AND c.household_id = a.household_id
      LEFT JOIN family_checklist_item i ON i.checklist_id = c.id
      WHERE a.household_id = ? AND a.occurrence_date BETWEEN ? AND ?
        AND c.archived = 0 AND (? = 'parent' OR c.shared = 1)
      GROUP BY a.event_id, a.occurrence_date, c.id
      ORDER BY c.name COLLATE NOCASE, c.id
    `).all(household, from, through, role) as (ChecklistOccurrence & PreparationProgress)[];
    const byOccurrence = new Map<string, PreparationProgress[]>();
    for (const { eventId, date, ...progress } of rows) {
      const key = `${eventId}/${date}`;
      const current = byOccurrence.get(key);
      if (current) current.push(progress);
      else byOccurrence.set(key, [progress]);
    }
    return events.map(event => ({ ...event, checklists: byOccurrence.get(`${event.id}/${event.date}`) ?? [] }));
  })();
}

type PreparationPreview = {
  id: string; name: string; date: string; eventTitle: string | null;
  progress: { completed: number; total: number } | null; outstanding: number; items: string[];
};

const myDayListLimit = 5;
const myDayItemLimit = 3;

export function loadChecklistReadiness(db: Database.Database, actor: string, household: string, today: string) {
  return db.transaction(() => {
    const parent = Number(member(db, actor, household) === 'parent');
    const through = addCalendarDays(today, 6);
    const upcomingEvents = listUpcomingEvents(db, actor, household, today, through);
    const occurrences = JSON.stringify(upcomingEvents);
    const params = { household, actor, parent, today, through, occurrences, limit: myDayListLimit + 1 };
    const candidates = db.prepare(`
      WITH scheduled AS (
        SELECT json_extract(value, '$.id') AS event_id, json_extract(value, '$.date') AS date,
          json_extract(value, '$.title') AS title
        FROM json_each(@occurrences)
      ), dates AS (
        SELECT a.checklist_id AS id, a.occurrence_date AS date, e.title AS eventTitle
        FROM family_checklist_event a
        JOIN scheduled e ON e.event_id = a.event_id AND e.date = a.occurrence_date
        WHERE a.household_id = @household AND a.occurrence_date BETWEEN @today AND @through
        UNION ALL
        SELECT c.id, c.target_date, NULL
        FROM family_checklist c
        WHERE c.household_id = @household AND c.archived = 0 AND c.target_date BETWEEN @today AND @through
          AND NOT EXISTS (SELECT 1 FROM family_checklist_event a WHERE a.checklist_id = c.id)
      )
      SELECT c.id, c.name, dates.date, dates.eventTitle
      FROM dates JOIN family_checklist c ON c.id = dates.id AND c.household_id = @household
      WHERE c.archived = 0 AND (@parent = 1 OR (c.shared = 1 AND EXISTS (
        SELECT 1 FROM family_checklist_item i LEFT JOIN family_checklist_item_assignment a ON a.item_id = i.id
        WHERE i.checklist_id = c.id AND i.completed = 0 AND (a.member_id IS NULL OR a.member_id = @actor)
      )))
      ORDER BY dates.date, c.name COLLATE NOCASE, c.id LIMIT @limit
    `).all(params) as Pick<PreparationPreview, 'id' | 'name' | 'date' | 'eventTitle'>[];
    const counts = db.prepare(`
      SELECT COUNT(*) AS total, COALESCE(SUM(i.completed), 0) AS completed
      FROM family_checklist_item i LEFT JOIN family_checklist_item_assignment a ON a.item_id = i.id
      WHERE i.checklist_id = @id AND (@parent = 1 OR (i.completed = 0 AND (a.member_id IS NULL OR a.member_id = @actor)))
    `);
    const outstandingItems = db.prepare(`
      SELECT i.name FROM family_checklist_item i LEFT JOIN family_checklist_item_assignment a ON a.item_id = i.id
      WHERE i.checklist_id = @id AND i.completed = 0 AND (@parent = 1 OR a.member_id IS NULL OR a.member_id = @actor)
      ORDER BY i.position, i.id LIMIT @limit
    `).pluck();
    const lists: PreparationPreview[] = candidates.slice(0, myDayListLimit).map(row => {
      const args = { id: row.id, parent, actor };
      const progress = counts.get(args) as { completed: number; total: number };
      return {
        ...row,
        progress: parent ? progress : null,
        outstanding: progress.total - progress.completed,
        items: outstandingItems.all({ ...args, limit: myDayItemLimit }) as string[]
      };
    });
    return { upcomingEvents, preparations: { lists, more: candidates.length > myDayListLimit } };
  })();
}
