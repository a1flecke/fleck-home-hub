import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { migrate } from '../src/lib/server/identity';
import { cancelEvent, createEvent } from '../src/lib/server/calendar';
import {
  addChecklistItems, ChecklistConflict, copyChecklist, createChecklist, getChecklist, getChecklistCopySource, loadChecklistReadiness,
  listChecklistAssignees, saveChecklistTemplate, setChecklistEventLink, setItemCompletion, updateChecklist, updateChecklistItem
} from '../src/lib/server/checklists';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localDate } from '../src/lib/chores/recurrence';

const home = 'home', parent = 'parent', child = 'child', sibling = 'sibling';
const today = '2099-05-04', tripDay = '2099-05-10';
const input = { name: 'Trip packing', description: '', targetDate: tripDay, shared: true };

async function fixture(path = ':memory:') {
  const db = new Database(path);
  db.pragma('foreign_keys = ON');
  try {
    await migrate(db);
    db.exec("INSERT INTO household VALUES ('home', 'Synthetic home'), ('away', 'Synthetic away')");
    const account = db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)');
    const membership = db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)');
    for (const id of [parent, 'other-parent', child, sibling, 'outsider']) {
      account.run(id, id, id + '@example.test');
      membership.run(id, id === 'outsider' ? 'away' : home, id === child || id === sibling ? 'kid' : 'parent');
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

it('version-checks responsibility changes and permits only the assigned child, an unassigned item, or a parent', async () => {
  const db = await fixture();
  try {
    const list = createChecklist(db, parent, home, input);
    addChecklistItems(db, parent, home, list, 'Pack coats\nFill water bottles\nFind charger');
    const [coat, water, charger] = getChecklist(db, child, home, list).items;
    expect(() => updateChecklistItem(db, child, home, list, coat.id, coat.version, coat.name, child)).toThrow('Not authorized');
    expect(() => updateChecklistItem(db, parent, home, list, coat.id, coat.version, coat.name, 'outsider')).toThrow('Choose an active household member');
    expect(getChecklist(db, child, home, list).items[0].version).toBe(coat.version);
    updateChecklistItem(db, parent, home, list, coat.id, coat.version, coat.name, child);
    updateChecklistItem(db, parent, home, list, charger.id, charger.version, charger.name, sibling);
    const current = getChecklist(db, child, home, list).items[0];
    expect(current).toMatchObject({ assignedTo: child, assigneeName: child, assigneeActive: true, version: coat.version + 1 });
    expect(() => setItemCompletion(db, child, home, list, coat.id, coat.version, true)).toThrow(ChecklistConflict);
    expect(() => setItemCompletion(db, sibling, home, list, coat.id, current.version, true)).toThrow();
    setItemCompletion(db, child, home, list, coat.id, current.version, true);
    setItemCompletion(db, sibling, home, list, water.id, water.version, true);
    const done = getChecklist(db, parent, home, list).items[0];
    expect(done).toMatchObject({ completed: true, completedBy: child });
    expect(() => updateChecklistItem(db, 'other-parent', home, list, coat.id, current.version, 'Stale name', sibling)).toThrow(ChecklistConflict);
    setItemCompletion(db, 'other-parent', home, list, coat.id, done.version, false);
    expect(getChecklist(db, child, home, list).items[0]).toMatchObject({ assignedTo: child, completed: false, completedBy: null });

    db.prepare("UPDATE membership SET disabled_at = 1, disabled_by = 'parent' WHERE user_id = ? AND household_id = ?").run(sibling, home);
    expect(listChecklistAssignees(db, parent, home).map(member => member.id)).not.toContain(sibling);
    const reserved = getChecklist(db, parent, home, list).items[2];
    expect(reserved).toMatchObject({ assignedTo: sibling, assigneeName: sibling, assigneeActive: false });
    expect(() => setItemCompletion(db, child, home, list, charger.id, reserved.version, true)).toThrow();
    expect(() => setItemCompletion(db, sibling, home, list, charger.id, reserved.version, true)).toThrow('Not authorized');
    setItemCompletion(db, parent, home, list, charger.id, reserved.version, true);

    const template = saveChecklistTemplate(db, parent, home, list);
    for (const source of [{ kind: 'template', id: template }, { kind: 'list', id: list }] as const) {
      const preview = getChecklistCopySource(db, parent, home, source)!;
      const copy = copyChecklist(db, parent, home, source, preview.revision, { ...input, shared: false }, randomUUID());
      expect(getChecklist(db, parent, home, copy).items.map(item => [item.assignedTo, item.completed, item.completedBy])).toEqual([
        [null, false, null], [null, false, null], [null, false, null]
      ]);
    }
  } finally { db.close(); }
});

it('lists seven household-local calendar dates and bounds previews after filtering to each child’s outstanding responsibilities', async () => {
  const db = await fixture();
  try {
    const event = createEvent(db, parent, home, { title: 'Weekend cabin', date: tripDay, allDay: true });
    const list = createChecklist(db, parent, home, { ...input, targetDate: '' });
    addChecklistItems(db, parent, home, list, 'My coat\nSibling charger\nFamily snacks\nFinished map');
    const [coat, charger, , map] = getChecklist(db, parent, home, list).items;
    updateChecklistItem(db, parent, home, list, coat.id, coat.version, coat.name, child);
    updateChecklistItem(db, parent, home, list, charger.id, charger.version, charger.name, sibling);
    setItemCompletion(db, parent, home, list, map.id, map.version, true);
    setChecklistEventLink(db, parent, home, list, '', { eventId: event, date: tripDay });
    const privateList = createChecklist(db, parent, home, { ...input, shared: false, name: 'Private surprise' });
    addChecklistItems(db, parent, home, privateList, 'Private supplies');
    const archive = createChecklist(db, parent, home, { ...input, name: 'Archived prep' });
    updateChecklist(db, parent, home, archive, 1, { ...input, archived: true });
    createChecklist(db, parent, home, { ...input, name: 'Outside window', targetDate: '2099-05-11' });
    for (let i = 0; i < 6; i += 1) {
      const siblingList = createChecklist(db, parent, home, { ...input, name: 'Sibling only ' + i, targetDate: today });
      addChecklistItems(db, parent, home, siblingList, 'Sibling work');
      const [item] = getChecklist(db, parent, home, siblingList).items;
      updateChecklistItem(db, parent, home, siblingList, item.id, item.version, item.name, sibling);
    }

    const parentView = loadChecklistReadiness(db, parent, home, '2099-05-07').preparations;
    expect(parentView).toEqual({ more: false, lists: [
      { id: privateList, name: 'Private surprise', date: tripDay, eventTitle: null, progress: { completed: 0, total: 1 }, outstanding: 1, items: ['Private supplies'] },
      { id: list, name: 'Trip packing', date: tripDay, eventTitle: 'Weekend cabin', progress: { completed: 1, total: 4 }, outstanding: 3, items: ['My coat', 'Sibling charger', 'Family snacks'] },
      expect.objectContaining({ name: 'Outside window' })
    ] });
    const forChild = () => loadChecklistReadiness(db, child, home, today).preparations;
    expect(forChild()).toEqual({ more: false, lists: [
      { id: list, name: 'Trip packing', date: tripDay, eventTitle: 'Weekend cabin', progress: null, outstanding: 2, items: ['My coat', 'Family snacks'] }
    ] });
    expect(loadChecklistReadiness(db, parent, home, today).preparations).toMatchObject({ more: true, lists: expect.arrayContaining([expect.objectContaining({ name: 'Sibling only 0' })]) });
    expect(loadChecklistReadiness(db, parent, home, today).preparations.lists).toHaveLength(5);
    expect(() => loadChecklistReadiness(db, 'outsider', home, today)).toThrow('Not authorized');
    cancelEvent(db, parent, home, event);
    expect(forChild().lists).toEqual([]);
    expect(getChecklist(db, parent, home, list).items).toHaveLength(4);

    const afterUtcMidnight = new Date('2099-05-04T03:00:00Z');
    const local = localDate(afterUtcMidnight, 'America/Chicago');
    expect(local).toBe('2099-05-03');
    const firstDay = createChecklist(db, parent, home, { ...input, name: 'Tonight’s preparation', targetDate: local });
    addChecklistItems(db, parent, home, firstDay, 'Put tickets by the door');
    expect(loadChecklistReadiness(db, child, home, local).preparations.lists.map(list => list.id)).toEqual([firstDay]);
    expect(forChild().lists).toEqual([]);
  } finally { db.close(); }
});

it('rolls back assignment and item edits when the member is disabled before the writer lock is released', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'checklist-assignment-revocation-'));
  const path = join(directory, 'household.sqlite');
  let db: Database.Database | undefined;
  try {
    const writer = db = await fixture(path);
    writer.pragma('journal_mode = WAL');
    const list = createChecklist(writer, parent, home, input);
    addChecklistItems(writer, parent, home, list, 'Pack coats');
    const [item] = getChecklist(writer, parent, home, list).items;
    writer.exec('BEGIN IMMEDIATE');
    writer.prepare("UPDATE membership SET disabled_at = 1, disabled_by = 'parent' WHERE user_id = 'child'").run();
    const worker = spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/assign-checklist-item.ts', path, list, item.id, String(item.version)], {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'], signal: AbortSignal.timeout(4000), killSignal: 'SIGKILL'
    });
    const exited = new Promise<void>(resolve => worker.once('close', () => resolve()));
    let stderr = '';
    worker.stderr?.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    try {
      const outcome = await new Promise<string>((resolve, reject) => {
        let result: string | undefined;
        worker.on('error', reject);
        worker.on('message', message => {
          if (message === 'attempting') {
            try { writer.exec('COMMIT'); } catch (error) { reject(error); }
          } else if (typeof message === 'string') result = message;
        });
        worker.once('close', code => {
          if (code === 0 && result !== undefined) resolve(result);
          else reject(new Error(`Assignment worker exited before reporting its result (${code}): ${stderr.trim()}`));
        });
      });
      expect(outcome).toBe('Choose an active household member');
      expect(getChecklist(writer, parent, home, list).items).toEqual([item]);
    } finally {
      if (worker.exitCode === null && worker.signalCode === null) worker.kill('SIGKILL');
      await exited;
    }
  } finally {
    if (db?.inTransaction) db.exec('ROLLBACK');
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
