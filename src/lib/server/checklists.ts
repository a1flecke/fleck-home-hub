import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { occurrenceDates } from '../chores/recurrence';

type Input = { name: string; description: string; targetDate: string; shared?: boolean };
type List = { id: string; name: string; description: string | null; targetDate: string | null; shared: boolean; archived: boolean; version: number };
type Item = { id: string; name: string; completed: boolean; completedBy: string | null; completedByName: string | null; completedAt: string | null; version: number };

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
    const items = db.prepare('SELECT i.id, i.name, i.completed, i.completed_by AS completedBy, u.name AS completedByName, i.completed_at AS completedAt, i.version FROM family_checklist_item i LEFT JOIN user u ON u.id = i.completed_by WHERE i.checklist_id = ? ORDER BY i.position, i.id').all(id) as (Omit<Item, 'completed'> & { completed: number })[];
    return {
      ...list,
      items: items.map(item => {
        const completed = !!item.completed;
        return {
          ...item,
          completed,
          completedBy: completed ? item.completedBy : null,
          completedByName: completed ? item.completedByName : null,
          completedAt: completed ? item.completedAt : null
        };
      })
    };
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
    const result = db.prepare('UPDATE family_checklist_item SET completed = ?, completed_by = ?, completed_at = ?, version = version + 1 WHERE id = ? AND checklist_id = ? AND version = ?').run(Number(completed), completedBy, completedAt, itemId, listId, version);
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

export function updateChecklistItem(db: Database.Database, actor: string, household: string, listId: string, id: string, version: number, name: string): void {
  name = name.trim();
  if (!name || name.length > 120 || !Number.isSafeInteger(version) || version < 1) throw new Error('Invalid item');
  db.transaction(() => {
    const role = member(db, actor, household, true), list = readList(db, household, listId, role);
    if (list.archived) throw new Error('Checklist archived');
    const result = db.prepare('UPDATE family_checklist_item SET name = ?, version = version + 1 WHERE id = ? AND checklist_id = ? AND version = ?').run(name, id, listId, version);
    if (!result.changes) throw new ChecklistConflict('Item changed');
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
