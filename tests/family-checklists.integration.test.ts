import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from '../src/lib/server/identity';
import { createChecklist, listChecklists, getChecklist, addChecklistItems, setItemCompletion, updateChecklist, updateChecklistItem, removeChecklistItem } from '../src/lib/server/checklists';

it('keeps private lists hidden and allows a child to complete an explicitly shared item without losing stale changes', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    await migrate(db);
    for (const id of ['parent', 'kid', 'outsider']) db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, `${id}@example.test`);
    for (const id of ['home', 'other']) db.prepare('INSERT INTO household VALUES (?, ?)').run(id, id);
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('parent', 'home', 'parent');
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('kid', 'home', 'kid');
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('outsider', 'other', 'parent');
    const privateId = createChecklist(db, 'parent', 'home', { name: 'Private gifts', description: '', targetDate: '', shared: false });
    const sharedId = createChecklist(db, 'parent', 'home', { name: 'Weekend packing', description: '', targetDate: '', shared: true });
    addChecklistItems(db, 'parent', 'home', sharedId, 'Coats\nChargers');
    expect(listChecklists(db, 'kid', 'home').map(list => list.id)).toEqual([sharedId]);
    expect(() => getChecklist(db, 'kid', 'home', privateId)).toThrow();
    expect(() => getChecklist(db, 'outsider', 'other', sharedId)).toThrow();
    expect(() => addChecklistItems(db, 'kid', 'home', sharedId, 'Forbidden')).toThrow();
    const item = getChecklist(db, 'kid', 'home', sharedId).items[0];
    setItemCompletion(db, 'kid', 'home', sharedId, item.id, item.version, true);
    expect(getChecklist(db, 'parent', 'home', sharedId).items[0]).toMatchObject({ completed: true, completedBy: 'kid', completedByName: 'kid', version: item.version + 1 });
    expect(() => setItemCompletion(db, 'parent', 'home', sharedId, item.id, item.version, false)).toThrow();
    expect(getChecklist(db, 'parent', 'home', sharedId).items[0].completed).toBe(true);
  } finally { db.close(); }
});

it('allows parents to manage a list while protecting completed items and rejecting stale edits', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON'); await migrate(db);
    for (const id of ['parent', 'kid']) db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0, 0)').run(id, id, `${id}@example.test`);
    db.prepare('INSERT INTO household VALUES (?, ?)').run('home', 'Synthetic');
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('parent', 'home', 'parent');
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run('kid', 'home', 'kid');
    const id = createChecklist(db, 'parent', 'home', { name: 'Trip', description: '', targetDate: '', shared: false });
    addChecklistItems(db, 'parent', 'home', id, 'Coats\nChargers');
    const list = getChecklist(db, 'parent', 'home', id);
    updateChecklist(db, 'parent', 'home', id, list.version, { name: 'Weekend trip', description: 'Pack early', targetDate: '2099-11-20', shared: true, archived: false });
    expect(() => updateChecklist(db, 'parent', 'home', id, list.version, { name: 'Stale', description: '', targetDate: '', shared: false, archived: false })).toThrow();
    expect(() => updateChecklistItem(db, 'kid', 'home', id, list.items[0].id, list.items[0].version, 'Forbidden')).toThrow();
    updateChecklistItem(db, 'parent', 'home', id, list.items[0].id, list.items[0].version, 'Warm coats');
    const changed = getChecklist(db, 'parent', 'home', id);
    setItemCompletion(db, 'kid', 'home', id, changed.items[0].id, changed.items[0].version, true);
    const completed = getChecklist(db, 'parent', 'home', id);
    expect(() => removeChecklistItem(db, 'parent', 'home', id, completed.items[0].id, completed.items[0].version)).toThrow();
    removeChecklistItem(db, 'parent', 'home', id, completed.items[1].id, completed.items[1].version);
    updateChecklist(db, 'parent', 'home', id, completed.version, { name: 'Weekend trip', description: 'Pack early', targetDate: '2099-11-20', shared: true, archived: true });
    expect(listChecklists(db, 'kid', 'home')).toEqual([]);
    expect(() => getChecklist(db, 'kid', 'home', id)).toThrow();
    expect(getChecklist(db, 'parent', 'home', id).items).toHaveLength(1);
  } finally { db.close(); }
});

it('handles repeated create and add submissions exactly once, even after later changes', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    await migrate(db);
    db.exec("INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('parent', 'Parent', 'synthetic@example.test', 0, 0, 0), ('other', 'Other parent', 'other@example.test', 0, 0, 0); INSERT INTO household VALUES ('home', 'Synthetic'); INSERT INTO membership (user_id, household_id, role) VALUES ('parent', 'home', 'parent'), ('other', 'home', 'parent');");
    const key = randomUUID();
    const input = { name: 'Packing', description: '', targetDate: '' };
    const id = createChecklist(db, 'parent', 'home', input, key);
    expect(createChecklist(db, 'parent', 'home', input, key)).toBe(id);
    expect(getChecklist(db, 'parent', 'home', id).shared).toBe(false);
    addChecklistItems(db, 'parent', 'home', id, 'Backpack', key);
    addChecklistItems(db, 'parent', 'home', id, 'Backpack', key);
    expect(getChecklist(db, 'parent', 'home', id).items.map(item => item.name)).toEqual(['Backpack']);
    db.prepare("UPDATE membership SET disabled_at = 1, disabled_by = 'other' WHERE user_id = 'parent'").run();
    expect(() => createChecklist(db, 'parent', 'home', input, key)).toThrow(/Not authorized/);
    expect(() => addChecklistItems(db, 'parent', 'home', id, 'Backpack', key)).toThrow(/Not authorized/);
    expect(listChecklists(db, 'other', 'home')).toHaveLength(1);
  } finally { db.close(); }
});

it('does not complete a shared item when revocation commits while the writer lock is held', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'checklist-revocation-'));
  const path = join(directory, 'household.sqlite');
  const db = new Database(path);
  try {
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    await migrate(db);
    db.exec(`
      INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
      VALUES ('parent', 'Parent', 'parent@example.test', 0, 0, 0), ('kid', 'Child', 'kid@example.test', 0, 0, 0);
      INSERT INTO household VALUES ('home', 'Synthetic');
      INSERT INTO membership (user_id, household_id, role) VALUES ('parent', 'home', 'parent'), ('kid', 'home', 'kid');
    `);
    const list = createChecklist(db, 'parent', 'home', { name: 'Trip', description: '', targetDate: '', shared: true });
    addChecklistItems(db, 'parent', 'home', list, 'Coat');
    const [item] = getChecklist(db, 'parent', 'home', list).items;
    db.exec('BEGIN IMMEDIATE');
    db.prepare("UPDATE membership SET disabled_at = 1, disabled_by = 'parent' WHERE user_id = 'kid' AND household_id = 'home'").run();
    const worker = spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/complete-checklist-item.ts', path, list, item.id], {
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
          if (message === 'ready') {
            worker.send('go', error => { if (error) reject(error); });
          } else if (message === 'attempting') {
            try { db.exec('COMMIT'); } catch (error) { reject(error); }
          } else if (typeof message === 'string') {
            result = message;
          }
        });
        worker.once('close', code => {
          if (code === 0 && result !== undefined) resolve(result);
          else reject(new Error('Checklist worker exited before reporting its result (' + code + '): ' + stderr.trim()));
        });
      });
      expect(outcome).toBe('Not authorized');
      expect(getChecklist(db, 'parent', 'home', list).items).toEqual([item]);
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
