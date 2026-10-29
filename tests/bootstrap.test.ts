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
    result.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
