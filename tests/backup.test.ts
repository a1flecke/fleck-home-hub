import { expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { backupDatabase } from '../src/lib/server/backup';

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
