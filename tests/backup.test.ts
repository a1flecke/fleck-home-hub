import { expect, it } from 'vitest';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { backupDatabase } from '../src/lib/server/backup';
import { bootstrap, addKid } from '../src/lib/server/bootstrap';
import { createAuth, migrate } from '../src/lib/server/identity';
import { createChore, changeChore } from '../src/lib/server/chores';
import { balance, recordPayout, reversePayout } from '../src/lib/server/payouts';

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

it.each(['-wal', '-shm', '-journal'])('refuses an existing %s without changing it', async suffix => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-backup-sidecar-'));
  const source = join(dir, 'source.sqlite');
  const destination = join(dir, 'backup.sqlite');
  const sidecar = destination + suffix;
  const db = new Database(source);
  try {
    db.pragma('journal_mode = WAL');
    db.exec("CREATE TABLE sample (value TEXT); INSERT INTO sample VALUES ('synthetic');");
    writeFileSync(sidecar, 'preserve');
    await expect(backupDatabase(source, destination)).rejects.toThrow(/already exists/);
    expect(readFileSync(sidecar, 'utf8')).toBe('preserve');
    expect(existsSync(destination)).toBe(false);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('refuses a dangling sidecar symlink and leaves it in place', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-backup-link-'));
  const source = join(dir, 'source.sqlite');
  const destination = join(dir, 'backup.sqlite');
  const db = new Database(source);
  try {
    db.exec('CREATE TABLE sample (value TEXT)');
    symlinkSync(join(dir, 'missing'), destination + '-journal');
    await expect(backupDatabase(source, destination)).rejects.toThrow(/already exists/);
    expect(readdirSync(dir).sort()).toEqual(['backup.sqlite-journal', 'source.sqlite']);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('does not publish a partial file or overwrite a destination created during the backup', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-backup-race-'));
  const source = join(dir, 'source.sqlite');
  const destination = join(dir, 'backup.sqlite');
  const db = new Database(source);
  try {
    db.exec('CREATE TABLE sample (value TEXT)');
    const pending = backupDatabase(source, destination);
    const rejected = expect(pending).rejects.toThrow(/already exists/);
    const publishedEarly = existsSync(destination);
    if (!publishedEarly) writeFileSync(destination, 'competing writer', { flag: 'wx' });
    await rejected;
    expect(publishedEarly).toBe(false);
    expect(readFileSync(destination, 'utf8')).toBe('competing writer');
    expect(readdirSync(dir).sort()).toEqual(['backup.sqlite', 'source.sqlite']);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('refuses a sidecar created while the backup is in progress', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-backup-sidecar-race-'));
  const source = join(dir, 'source.sqlite');
  const destination = join(dir, 'backup.sqlite');
  const sidecar = destination + '-journal';
  const db = new Database(source);
  try {
    db.exec('CREATE TABLE sample (value TEXT)');
    const pending = backupDatabase(source, destination);
    const rejected = expect(pending).rejects.toThrow(/already exists/);
    writeFileSync(sidecar, 'competing writer', { flag: 'wx' });
    await rejected;
    expect(readFileSync(sidecar, 'utf8')).toBe('competing writer');
    expect(existsSync(destination)).toBe(false);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('publishes exactly one complete, private copy when two backups use the same destination', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-backup-concurrent-'));
  const source = join(dir, 'source.sqlite');
  const destination = join(dir, 'backup.sqlite');
  const db = new Database(source);
  try {
    db.exec("CREATE TABLE sample (value TEXT); INSERT INTO sample VALUES ('synthetic');");
    const results = await Promise.allSettled([backupDatabase(source, destination), backupDatabase(source, destination)]);
    expect(results.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(statSync(destination).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir).sort()).toEqual(['backup.sqlite', 'source.sqlite']);
    const copy = new Database(destination, { readonly: true, fileMustExist: true });
    try {
      expect(copy.prepare('SELECT value FROM sample').get()).toEqual({ value: 'synthetic' });
    } finally { copy.close(); }
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('cleans up when a corrupt source fails during copying', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-backup-corrupt-'));
  const source = join(dir, 'source.sqlite');
  const destination = join(dir, 'backup.sqlite');
  try {
    writeFileSync(source, 'corrupt synthetic source'.repeat(1000));
    await expect(backupDatabase(source, destination)).rejects.toThrow();
    expect(readdirSync(dir)).toEqual(['source.sqlite']);
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
    const corrected = recordPayout(db, parentId, household, { childId: kidId, amountCents: 50, date: '2026-10-30', note: '', requestId: 'synthetic-corrected' });
    reversePayout(db, parentId, household, corrected, 'Recorded in error');
    recordPayout(db, parentId, household, { childId: kidId, amountCents: 100, date: '2026-10-30', note: '', requestId: 'synthetic-payment' });
    await backupDatabase(source, backup);
    expect([...readFileSync(backup).subarray(18, 20)]).toEqual([1, 1]); // SQLite's standalone rollback-journal format.
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
    expect(balance(db, household, kidId)).toEqual({ earned: 250, paid: 100, owed: 150 });
    expect(db.prepare('SELECT count(*) AS count FROM payout_reversal').get()).toEqual({ count: 1 });
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
