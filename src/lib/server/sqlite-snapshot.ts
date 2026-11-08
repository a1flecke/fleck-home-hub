import { chmodSync, closeSync, fsyncSync, linkSync, lstatSync, mkdtempSync, openSync, realpathSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const sidecarSuffixes = ['-wal', '-shm', '-journal'];

export function assertNoSqliteSidecars(path: string) {
  if (sidecarSuffixes.some(suffix => lstatSync(path + suffix, { throwIfNoEntry: false }))) {
    throw new Error('A SQLite companion file already exists');
  }
}

/** SQLite only opens the staging path. Publishing the verified file never replaces the destination. */
export function stageSqliteSnapshot(destination: string) {
  const parent = realpathSync(dirname(destination));
  const parentStat = statSync(parent);
  if (!parentStat.isDirectory() || (parentStat.mode & 0o077) !== 0 || parentStat.uid !== process.getuid?.()) {
    throw new Error('The snapshot destination directory must be private and owned by the current user');
  }
  const finalPath = join(parent, basename(destination));
  if (sidecarSuffixes.some(suffix => finalPath.endsWith(suffix))) {
    throw new Error('The snapshot destination cannot use a SQLite companion file name');
  }
  const assertAvailable = () => {
    if (lstatSync(finalPath, { throwIfNoEntry: false })) throw new Error('The snapshot destination already exists');
    assertNoSqliteSidecars(finalPath);
  };
  assertAvailable();

  const staging = mkdtempSync(join(parent, '.hub-snapshot-'));
  const path = join(staging, 'snapshot.sqlite');
  return {
    path,
    publish() {
      assertNoSqliteSidecars(path);
      chmodSync(path, 0o600);
      const file = openSync(path, 'r');
      try { fsyncSync(file); }
      finally { closeSync(file); }
      assertAvailable();
      linkSync(path, finalPath);
    },
    cleanup() {
      rmSync(staging, { recursive: true, force: true });
    }
  };
}
