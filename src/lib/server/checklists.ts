import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
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

export function createChecklist(db: Database.Database, actor: string, household: string, input: Input, requestId = randomUUID().toString()): string {
  checkRequestId(requestId);
  return db.transaction(() => {
    member(db, actor, household, true);
    const existing = db.prepare('SELECT id FROM family_checklist WHERE household_id = ? AND created_by = ? AND create_request_id = ?').get(household, actor, requestId) as { id: string } | undefined;
    if (existing) return existing.id;
    const v = values(input);
    const id = randomUUID(), now = new Date().toISOString();
    db.prepare('INSERT INTO family_checklist (id, household_id, name, description, target_date, shared, created_by, create_request_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, household, v.name, v.description, v.targetDate, Number(input.shared ?? false), actor, requestId, now, now);
    return id;
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
    return { ...list, items: items.map(item => ({ ...item, completed: !!item.completed })) };
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
    if (row.count + lines.length > 500) throw new Error('Too many items');
    const insert = db.prepare('INSERT INTO family_checklist_item (id, checklist_id, name, position) VALUES (?, ?, ?, ?)');
    lines.forEach((line, index) => insert.run(randomUUID(), id, line, row.position + index + 1));
  }).immediate();
}

export function setItemCompletion(db: Database.Database, actor: string, household: string, listId: string, itemId: string, version: number, completed: boolean): void {
  if (!Number.isSafeInteger(version) || version < 1 || typeof completed !== 'boolean') throw new Error('Invalid update');
  db.transaction(() => {
    const role = member(db, actor, household), list = readList(db, household, listId, role);
    if (list.archived) throw new Error('Checklist archived');
    const result = db.prepare('UPDATE family_checklist_item SET completed = ?, completed_by = ?, completed_at = ?, version = version + 1 WHERE id = ? AND checklist_id = ? AND version = ?').run(Number(completed), actor, new Date().toISOString(), itemId, listId, version);
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
