import { it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { bootstrap } from '../src/lib/server/bootstrap';

it('creates a private new database with one parent and refuses replacement', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'home-hub-test-'));
  const path = join(dir, 'home.sqlite');
  const config = { dbPath: path, origin: 'http://localhost:3000', secret: 'synthetic-bootstrap-secret-over-32-characters' };
  try {
    await bootstrap(config, { name: 'Parent', email: 'parent@example.test', password: 'synthetic-password-123', household: 'Test' });
    const db = new Database(path, { readonly: true });
    expect(db.prepare('SELECT role FROM membership').get()).toEqual({ role: 'parent' });
    expect(db.prepare('SELECT COUNT(*) AS count FROM session').get()).toEqual({ count: 0 });
    db.close();
    await expect(bootstrap(config, { name: 'Other', email: 'other@example.test', password: 'synthetic-password-456', household: 'Other' })).rejects.toThrow();
    expect(new Database(path, { readonly: true }).prepare('SELECT COUNT(*) AS count FROM user').get()).toEqual({ count: 1 });
    const existing = join(dir, 'existing.sqlite');
    writeFileSync(existing, 'preserve');
    await expect(bootstrap({ ...config, dbPath: existing }, { name: 'X', email: 'x@example.test', password: 'synthetic-password-456', household: 'X' })).rejects.toThrow();
    expect(readFileSync(existing, 'utf8')).toBe('preserve');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it('adds a child to an existing household and refuses nonexistent households', async () => {
  const { addKid } = await import('../src/lib/server/bootstrap');
  const dir = mkdtempSync(join(tmpdir(), 'home-hub-kid-'));
  const path = join(dir, 'home.sqlite');
  const config = { dbPath: path, origin: 'http://localhost:3000', secret: 'synthetic-bootstrap-secret-over-32-characters' };
  try {
    await bootstrap(config, { name: 'Parent', email: 'parent@example.test', password: 'synthetic-password-123', household: 'Test' });
    const db = new Database(path, { readonly: true });
    const household = db.prepare('SELECT id FROM household').get() as { id: string }; db.close();
    const child = { name: 'Child', email: 'child@example.test', password: 'synthetic-password-456' };
    await expect(addKid(config, 'missing', child)).rejects.toThrow();
    await addKid(config, household.id, child);
    const result = new Database(path, { readonly: true });
    expect(result.prepare("SELECT role FROM membership WHERE role='kid'").get()).toEqual({ role: 'kid' });
    expect(result.prepare('SELECT COUNT(*) AS count FROM user').get()).toEqual({ count: 2 });
    expect(result.prepare('SELECT COUNT(*) AS count FROM session').get()).toEqual({ count: 0 });
    await expect(addKid(config, household.id, { ...child, email: 'CHILD@example.test' })).rejects.toThrow();
    expect(result.prepare('SELECT COUNT(*) AS count FROM user').get()).toEqual({ count: 2 });
    expect(result.prepare('SELECT COUNT(*) AS count FROM membership').get()).toEqual({ count: 2 });
    result.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


it.each(['membership', 'account'])('rolls back CLI provisioning after a %s insert failure and permits retry', async (table) => {
  const { addKid } = await import('../src/lib/server/bootstrap');
  const dir = mkdtempSync(join(tmpdir(), 'home-hub-atomic-'));
  const config = { dbPath: join(dir, 'synthetic.sqlite'), origin: 'http://localhost:3000', secret: 'synthetic-bootstrap-secret-over-32-characters' };
  try {
    const household = await bootstrap(config, { name: 'Parent', email: 'parent@example.test', password: 'synthetic-password-123', household: 'Example' });
    const db = new Database(config.dbPath);
    try {
      db.exec(`CREATE TRIGGER reject_provision BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'injected failure'); END`);
      const child = { name: 'Child', email: 'child@example.test', password: 'synthetic-password-456' };
      await expect(addKid(config, household, child)).rejects.toThrow();
      for (const record of ['user', 'account', 'membership']) expect(db.prepare(`SELECT count(*) AS n FROM ${record}`).get()).toEqual({ n: 1 });
      expect(db.prepare('SELECT count(*) AS n FROM session').get()).toEqual({ n: 0 });
      db.exec('DROP TRIGGER reject_provision');
      await addKid(config, household, child);
      expect(db.prepare('SELECT count(*) AS n FROM membership').get()).toEqual({ n: 2 });
    } finally { db.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


it('rolls back initial household writes with a failed provisioning transaction', async () => {
  const { migrate, provisionIdentity } = await import('../src/lib/server/identity');
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  const config = { origin: 'http://localhost:3000', secret: 'synthetic-bootstrap-secret-over-32-characters' };
  const input = { name: 'Parent', email: 'initial@example.test', password: 'synthetic-password-123' };
  try {
    await migrate(db);
    await expect(provisionIdentity(db, config, input, (userId) => {
      db.prepare('INSERT INTO household (id, name) VALUES (?, ?)').run('initial-house', 'Example');
      db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(userId, 'initial-house', 'parent');
      throw new Error('injected domain failure');
    })).rejects.toThrow();
    for (const table of ['user', 'account', 'household', 'membership', 'session']) expect(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
    await provisionIdentity(db, config, input, (userId) => {
      db.prepare('INSERT INTO household (id, name) VALUES (?, ?)').run('initial-house', 'Example');
      db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(userId, 'initial-house', 'parent');
    });
    expect(db.prepare('SELECT role FROM membership').get()).toEqual({ role: 'parent' });
  } finally { db.close(); }
});
