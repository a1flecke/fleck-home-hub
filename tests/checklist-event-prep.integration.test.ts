import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { migrate } from '../src/lib/server/identity';
import { cancelEvent, cancelOccurrence, createEvent, updateEvent } from '../src/lib/server/calendar';
import {
  addChecklistItems, ChecklistConflict, createChecklist, createPreparationChecklist, getChecklist, getChecklistEventLink,
  listCalendarPreparation, setChecklistEventLink, setItemCompletion, updateChecklist
} from '../src/lib/server/checklists';

const home = 'home', parent = 'parent', kid = 'kid';
const first = '2099-05-04';
const second = '2099-05-11';
const listInput = { name: 'Weekend packing', description: '', targetDate: '' };
const eventInput = { title: 'Family weekend', date: first, allDay: true };

async function seed(db: Database.Database) {
  db.pragma('foreign_keys = ON');
  await migrate(db);
  db.exec(`
    INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES
      ('parent', 'Parent', 'parent@example.test', 0, 0, 0),
      ('other-parent', 'Other parent', 'other-parent@example.test', 0, 0, 0),
      ('kid', 'Kid', 'kid@example.test', 0, 0, 0),
      ('outsider', 'Outsider', 'outsider@example.test', 0, 0, 0);
    INSERT INTO household VALUES ('home', 'Synthetic home'), ('away', 'Synthetic elsewhere');
    INSERT INTO membership (user_id, household_id, role) VALUES
      ('parent', 'home', 'parent'), ('other-parent', 'home', 'parent'), ('kid', 'home', 'kid'), ('outsider', 'away', 'parent');
  `);
}

it('projects progress only for viewable lists on the linked occurrence, with sharing changes visible on the next read', async () => {
  const db = new Database(':memory:');
  try {
    await seed(db);
    const id = createEvent(db, parent, home, { ...eventInput, weekdays: [1] });
    const event = { eventId: id, date: first };
    const privateId = createChecklist(db, parent, home, { ...listInput, name: 'Secret gift supplies' });
    const sharedId = createChecklist(db, parent, home, { ...listInput, shared: true });
    addChecklistItems(db, parent, home, sharedId, 'Coats\nChargers');
    const [coat] = getChecklist(db, parent, home, sharedId).items;
    setItemCompletion(db, kid, home, sharedId, coat.id, coat.version, true);
    setChecklistEventLink(db, parent, home, privateId, '', event);
    setChecklistEventLink(db, parent, home, sharedId, '', event);

    const asParent = listCalendarPreparation(db, 'other-parent', home, first, second);
    expect(asParent.map(row => row.date)).toEqual([first, second]);
    expect(asParent[0].checklists).toEqual([
      { id: privateId, name: 'Secret gift supplies', completed: 0, total: 0 },
      { id: sharedId, name: 'Weekend packing', completed: 1, total: 2 }
    ]);
    expect(asParent[1].checklists).toEqual([]);
    const asKid = () => listCalendarPreparation(db, kid, home, first, second);
    expect(asKid()[0].checklists).toEqual([{ id: sharedId, name: 'Weekend packing', completed: 1, total: 2 }]);
    expect(JSON.stringify(asKid())).not.toContain(privateId);
    expect(JSON.stringify(asKid())).not.toContain('Secret gift supplies');
    const list = getChecklist(db, parent, home, sharedId);
    updateChecklist(db, parent, home, sharedId, list.version, { ...listInput, shared: false, archived: false });
    expect(asKid()[0].checklists).toEqual([]);
    expect(listCalendarPreparation(db, parent, home, first, first)[0].checklists).toHaveLength(2);
    const current = getChecklist(db, parent, home, sharedId);
    updateChecklist(db, parent, home, sharedId, current.version, { ...listInput, shared: true, archived: true });
    expect(asKid()[0].checklists).toEqual([]);
    expect(listCalendarPreparation(db, parent, home, first, first)[0].checklists.map(row => row.id)).toEqual([privateId]);
    expect(getChecklistEventLink(db, parent, home, sharedId)).toMatchObject(event);
  } finally { db.close(); }
});

it('preserves preparation when an occurrence is cancelled or moved and rejects stale attach and detach requests', async () => {
  const db = new Database(':memory:');
  try {
    await seed(db);
    const series = createEvent(db, parent, home, { ...eventInput, weekdays: [1] });
    const oneOff = createEvent(db, parent, home, { ...eventInput, title: 'Alternate trip' });
    const list = createChecklist(db, parent, home, listInput);
    addChecklistItems(db, parent, home, list, 'Snacks');
    const start = { eventId: series, date: first };
    setChecklistEventLink(db, parent, home, list, '', start);
    const old = getChecklistEventLink(db, parent, home, list)!;
    expect(old).toMatchObject({ ...start, stale: false, title: eventInput.title });
    cancelOccurrence(db, parent, home, series, first);
    expect(getChecklistEventLink(db, parent, home, list)?.stale).toBe(true);
    expect(listCalendarPreparation(db, parent, home, first, second).find(row => row.id === series)?.checklists).toEqual([]);

    const target = { eventId: oneOff, date: first };
    setChecklistEventLink(db, 'other-parent', home, list, old.token, target);
    expect(() => setChecklistEventLink(db, parent, home, list, old.token, null)).toThrow(ChecklistConflict);
    expect(getChecklistEventLink(db, parent, home, list)).toMatchObject({ ...target, stale: false });
    updateEvent(db, parent, home, oneOff, { ...eventInput, date: second });
    expect(getChecklistEventLink(db, parent, home, list)?.stale).toBe(true);
    expect(listCalendarPreparation(db, parent, home, first, second).find(row => row.id === oneOff)?.checklists).toEqual([]);
    const beforeRelink = getChecklistEventLink(db, parent, home, list)!;
    setChecklistEventLink(db, parent, home, list, beforeRelink.token, { eventId: oneOff, date: second });
    cancelEvent(db, parent, home, oneOff);
    const cancelled = getChecklistEventLink(db, parent, home, list)!;
    expect(cancelled.stale).toBe(true);
    setChecklistEventLink(db, parent, home, list, cancelled.token, null);
    expect(getChecklistEventLink(db, parent, home, list)).toBeNull();
    expect(getChecklist(db, parent, home, list).items.map(item => item.name)).toEqual(['Snacks']);
  } finally { db.close(); }
});

it('validates both sides in the active household and creates a linked list atomically and only once', async () => {
  const db = new Database(':memory:');
  try {
    await seed(db);
    const id = createEvent(db, parent, home, eventInput);
    const foreignId = createEvent(db, 'outsider', 'away', eventInput);
    const list = createChecklist(db, parent, home, listInput);
    const target = { eventId: id, date: first };
    const key = randomUUID();
    expect(() => createPreparationChecklist(db, parent, home, { eventId: id, date: second }, listInput, key)).toThrow(ChecklistConflict);
    expect(() => setChecklistEventLink(db, parent, home, list, '', { eventId: foreignId, date: first })).toThrow(ChecklistConflict);
    expect(() => setChecklistEventLink(db, 'outsider', 'away', list, '', { eventId: foreignId, date: first })).toThrow();
    expect(() => setChecklistEventLink(db, kid, home, list, '', target)).toThrow();
    expect(() => getChecklistEventLink(db, kid, home, list)).toThrow();
    db.exec("CREATE TRIGGER failed_attachment BEFORE INSERT ON family_checklist_event BEGIN SELECT RAISE(ABORT, 'Synthetic link write failure'); END");
    expect(() => createPreparationChecklist(db, parent, home, target, listInput, key)).toThrow('Synthetic link write failure');
    expect(db.prepare('SELECT count(*) FROM family_checklist').pluck().get()).toBe(1);
    db.exec('DROP TRIGGER failed_attachment');
    const copy = createPreparationChecklist(db, parent, home, target, { ...listInput, name: 'Food to bring' }, key);
    expect(createPreparationChecklist(db, parent, home, target, { ...listInput, name: 'Food to bring' }, key)).toBe(copy);
    expect(() => createPreparationChecklist(db, parent, home, target, listInput, key)).toThrow(ChecklistConflict);
    expect(getChecklist(db, parent, home, copy).shared).toBe(false);
    expect(getChecklistEventLink(db, parent, home, copy)).toMatchObject(target);
    expect(db.prepare('SELECT count(*) FROM family_checklist').pluck().get()).toBe(2);
    db.prepare("UPDATE membership SET disabled_at = 1, disabled_by = 'other-parent' WHERE user_id = 'parent'").run();
    expect(() => createPreparationChecklist(db, parent, home, target, { ...listInput, name: 'Food to bring' }, key)).toThrow('Not authorized');
    expect(() => listCalendarPreparation(db, parent, home, first, second)).toThrow('Not authorized');
  } finally { db.close(); }
});

it('rejects an attachment when parent membership is revoked while the writer lock is held', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'preparation-revocation-'));
  const path = join(directory, 'household.sqlite');
  const db = new Database(path);
  try {
    db.pragma('journal_mode = WAL');
    await seed(db);
    const event = createEvent(db, parent, home, eventInput);
    const list = createChecklist(db, parent, home, listInput);
    db.exec('BEGIN IMMEDIATE');
    db.prepare("UPDATE membership SET disabled_at = 1, disabled_by = 'other-parent' WHERE user_id = 'parent'").run();
    const worker = spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/link-checklist-event.ts', path, list, event, first], {
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
            try { db.exec('COMMIT'); } catch (error) { reject(error); }
          } else if (typeof message === 'string') {
            result = message;
          }
        });
        worker.once('close', code => {
          if (code === 0 && result !== undefined) resolve(result);
          else reject(new Error('Attachment worker exited before reporting its result (' + code + '): ' + stderr.trim()));
        });
      });
      expect(outcome).toBe('Not authorized');
      expect(getChecklistEventLink(db, 'other-parent', home, list)).toBeNull();
    } finally {
      if (worker.exitCode === null && worker.signalCode === null) worker.kill('SIGKILL');
      await exited;
    }
  } finally {
    if (db.inTransaction) db.exec('ROLLBACK');
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
