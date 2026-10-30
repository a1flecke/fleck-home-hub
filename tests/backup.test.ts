import { expect, it } from 'vitest';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { backupDatabase } from '../src/lib/server/backup';
import { bootstrap, addKid } from '../src/lib/server/bootstrap';
import { createAuth, migrate } from '../src/lib/server/identity';
import { createChore, changeChore } from '../src/lib/server/chores';

it('makes a consistent recoverable backup without overwriting an existing file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-backup-'));
  const source = join(dir, 'source.sqlite'); const dest = join(dir, 'backup.sqlite');
  try {
    const db = new Database(source); db.exec('CREATE TABLE sample (value TEXT); INSERT INTO sample VALUES (\'synthetic\');');
    await backupDatabase(source, dest);
    const restored = new Database(dest, { readonly: true });
    expect(restored.prepare('SELECT value FROM sample').get()).toEqual({ value: 'synthetic' });
    expect(restored.pragma('integrity_check', { simple: true })).toBe('ok');
    restored.close(); db.close();
    writeFileSync(join(dir, 'existing'), 'preserve');
    await expect(backupDatabase(source, join(dir, 'existing'))).rejects.toThrow();
    expect(readFileSync(join(dir, 'existing'), 'utf8')).toBe('preserve');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it('restores authentication, membership and verified earnings after a failed migration', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-recovery-'));
  const source = join(dir, 'source.sqlite');
  const backup = join(dir, 'backup.sqlite');
  const restoredPath = join(dir, 'restored.sqlite');
  const config = { dbPath: source, origin: 'http://localhost:3000', secret: 'synthetic-recovery-secret-at-least-32-characters' };
  const parent = { name: 'Synthetic Parent', email: 'parent@example.test', password: 'synthetic-parent-password' };
  const kid = { name: 'Synthetic Kid', email: 'kid@example.test', password: 'synthetic-kid-password' };
  let db: Database.Database | undefined;
  try {
    const household = await bootstrap(config, { ...parent, household: 'Synthetic Home' });
    await addKid(config, household, kid);
    db = new Database(source, { fileMustExist: true });
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    const parentId = (db.prepare('SELECT id FROM user WHERE email = ?').get(parent.email) as { id: string }).id;
    const kidId = (db.prepare('SELECT id FROM user WHERE email = ?').get(kid.email) as { id: string }).id;
    const chore = createChore(db, parentId, household, { title: 'Synthetic chore', assigneeId: kidId, dueDate: '2026-10-30', rewardCents: 250 });
    changeChore(db, kidId, household, chore, 'submit');
    changeChore(db, parentId, household, chore, 'verify');
    await backupDatabase(source, backup);
    db.exec('ALTER TABLE user ADD COLUMN unreviewed_schema_change TEXT');
    await expect(migrate(db)).rejects.toThrow();
    db.close(); db = undefined;
    copyFileSync(backup, restoredPath);
    db = new Database(restoredPath, { fileMustExist: true });
    db.pragma('foreign_keys = ON');
    await migrate(db);
    const auth = createAuth(db, config);
    for (const user of [parent, kid]) {
      const response = await auth.handler(new Request(`${config.origin}/api/auth/sign-in/email`, {
        method: 'POST', headers: { origin: config.origin, 'content-type': 'application/json' },
        body: JSON.stringify({ email: user.email, password: user.password })
      }));
      expect(response.status).toBe(200);
    }
    expect(db.prepare('SELECT user_id, role FROM membership WHERE household_id = ? ORDER BY role').all(household)).toEqual([
      { user_id: kidId, role: 'kid' }, { user_id: parentId, role: 'parent' }
    ]);
    expect(db.prepare('SELECT child_id, amount_cents FROM earning WHERE chore_id = ?').get(chore)).toEqual({ child_id: kidId, amount_cents: 250 });
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
