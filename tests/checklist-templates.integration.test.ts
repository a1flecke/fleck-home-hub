import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { migrate } from '../src/lib/server/identity';
import {
  addChecklistItems, ChecklistConflict, copyChecklist, createChecklist, getChecklist, getChecklistCopySource,
  getChecklistTemplate, listChecklistTemplates, removeChecklistTemplate, saveChecklistTemplate,
  setItemCompletion, updateChecklistItem, updateChecklistTemplate
} from '../src/lib/server/checklists';

const home = 'synthetic-home';
const parent = 'parent';
const templateSource = (id: string) => ({ kind: 'template' as const, id });
const listSource = (id: string) => ({ kind: 'list' as const, id });
const listInput = { name: 'Family weekend', description: 'Pack before Friday', targetDate: '' };

async function seed(db: Database.Database) {
  db.pragma('foreign_keys = ON');
  await migrate(db);
  db.exec(`
    INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES
      ('parent', 'Parent', 'parent@example.test', 0, 0, 0),
      ('second', 'Second', 'second@example.test', 0, 0, 0),
      ('child', 'Child', 'child@example.test', 0, 0, 0),
      ('outside', 'Other', 'outside@example.test', 0, 0, 0);
    INSERT INTO household VALUES ('synthetic-home', 'Synthetic'), ('outside-home', 'Other');
    INSERT INTO membership (user_id, household_id, role) VALUES
      ('parent', 'synthetic-home', 'parent'), ('second', 'synthetic-home', 'parent'),
      ('child', 'synthetic-home', 'kid'), ('outside', 'outside-home', 'parent');
  `);
  const list = createChecklist(db, parent, home, { ...listInput, targetDate: '2099-05-01', shared: true });
  addChecklistItems(db, parent, home, list, 'Coats\nBrushes\nChargers\nCard game');
  const [item] = getChecklist(db, parent, home, list).items;
  setItemCompletion(db, 'child', home, list, item.id, item.version, true);
  return list;
}

it('saves ordered text and makes independent, private, unchecked copies with retry-safe creation', async () => {
  const db = new Database(':memory:');
  try {
    const list = await seed(db);
    const template = saveChecklistTemplate(db, parent, home, list);
    const source = templateSource(template);
    const preview = getChecklistCopySource(db, parent, home, source)!;
    expect(preview).toMatchObject({ name: listInput.name, description: listInput.description, items: ['Coats', 'Brushes', 'Chargers', 'Card game'] });
    expect(preview).not.toHaveProperty('targetDate');
    const key = randomUUID();
    const copy = copyChecklist(db, parent, home, source, preview.revision, { ...listInput, name: 'Next trip' }, key);
    expect(copyChecklist(db, parent, home, source, preview.revision, { ...listInput, name: 'Next trip' }, key)).toBe(copy);
    expect(() => copyChecklist(db, parent, home, source, preview.revision, { ...listInput, name: 'Different request' }, key)).toThrow(ChecklistConflict);
    const fresh = getChecklist(db, 'second', home, copy);
    expect(fresh).toMatchObject({ name: 'Next trip', shared: false, targetDate: null, archived: false });
    expect(fresh.items.map(item => [item.name, item.completed, item.completedBy, item.completedAt])).toEqual(preview.items.map(name => [name, false, null, null]));
    expect(fresh.items[0].id).not.toBe(getChecklist(db, parent, home, list).items[0].id);
    updateChecklistItem(db, parent, home, copy, fresh.items[0].id, fresh.items[0].version, 'Rain jackets');
    expect(getChecklistTemplate(db, parent, home, template)?.items).toEqual(preview.items);
    expect(getChecklist(db, parent, home, list).items[0]).toMatchObject({ name: 'Coats', completed: true });
    const original = listSource(list);
    const fromList = getChecklistCopySource(db, parent, home, original)!;
    const direct = copyChecklist(db, parent, home, original, fromList.revision, { ...listInput, shared: true }, randomUUID());
    expect(getChecklist(db, 'child', home, direct).items.every(item => !item.completed)).toBe(true);
  } finally { db.close(); }
});

it('rejects stale edits and stale previews across connections and handles removal after a successful retry', async () => {
  const path = mkdtempSync(join(tmpdir(), 'family-template-test-'));
  const db = new Database(join(path, 'synthetic.sqlite'));
  const other = new Database(join(path, 'synthetic.sqlite'));
  try {
    const list = await seed(db);
    other.pragma('foreign_keys = ON');
    const id = saveChecklistTemplate(db, parent, home, list);
    const source = templateSource(id);
    const old = getChecklistTemplate(db, parent, home, id)!;
    const preview = getChecklistCopySource(db, parent, home, source)!;
    updateChecklistTemplate(other, 'second', home, id, old.version, { name: 'Three-day trip', description: '', items: 'Chargers\nCoats' });
    expect(() => updateChecklistTemplate(db, parent, home, id, old.version, { name: 'Lost edit', description: '', items: 'Coats' })).toThrow(ChecklistConflict);
    expect(() => removeChecklistTemplate(db, parent, home, id, old.version)).toThrow(ChecklistConflict);
    expect(() => copyChecklist(db, parent, home, source, preview.revision, listInput, randomUUID())).toThrow(ChecklistConflict);
    const latest = getChecklistTemplate(db, parent, home, id)!;
    expect(latest.items).toEqual(['Chargers', 'Coats']);
    const newPreview = getChecklistCopySource(db, parent, home, source)!;
    const key = randomUUID();
    const copy = copyChecklist(db, parent, home, source, newPreview.revision, listInput, key);
    removeChecklistTemplate(other, 'second', home, id, latest.version);
    expect(() => copyChecklist(db, parent, home, source, newPreview.revision, listInput, randomUUID())).toThrow(ChecklistConflict);
    expect(copyChecklist(db, parent, home, source, newPreview.revision, listInput, key)).toBe(copy);
    const original = listSource(list);
    const before = getChecklistCopySource(db, parent, home, original)!;
    const [item] = getChecklist(other, 'second', home, list).items;
    updateChecklistItem(other, 'second', home, list, item.id, item.version, 'Updated coats');
    expect(() => copyChecklist(db, parent, home, original, before.revision, listInput, randomUUID())).toThrow(ChecklistConflict);
    expect(getChecklist(db, parent, home, copy).items.map(item => item.name)).toEqual(latest.items);
  } finally {
    other.close();
    db.close();
    rmSync(path, { recursive: true, force: true });
  }
});

it('checks active parent access on reads, writes, and repeated copy requests', async () => {
  const db = new Database(':memory:');
  try {
    const list = await seed(db);
    const id = saveChecklistTemplate(db, parent, home, list);
    const source = templateSource(id);
    const preview = getChecklistCopySource(db, parent, home, source)!;
    const key = randomUUID();
    copyChecklist(db, parent, home, source, preview.revision, listInput, key);
    db.prepare("UPDATE membership SET disabled_at = 1, disabled_by = 'second' WHERE user_id = 'parent'").run();
    for (const [actor, household] of [['child', home], ['outside', home], [parent, home]]) {
      expect(() => listChecklistTemplates(db, actor, household)).toThrow();
      expect(() => getChecklistTemplate(db, actor, household, id)).toThrow();
      expect(() => getChecklistCopySource(db, actor, household, source)).toThrow();
      expect(() => getChecklistCopySource(db, actor, household, listSource(list))).toThrow();
      expect(() => saveChecklistTemplate(db, actor, household, list)).toThrow();
      expect(() => copyChecklist(db, actor, household, source, preview.revision, listInput, key)).toThrow();
      expect(() => updateChecklistTemplate(db, actor, household, id, 1, { name: 'No', description: '', items: '' })).toThrow();
      expect(() => removeChecklistTemplate(db, actor, household, id, 1)).toThrow();
    }
    expect(getChecklistTemplate(db, 'outside', 'outside-home', id)).toBeNull();
    expect(getChecklistCopySource(db, 'outside', 'outside-home', source)).toBeNull();
    expect(listChecklistTemplates(db, 'outside', 'outside-home')).toEqual([]);
  } finally { db.close(); }
});
