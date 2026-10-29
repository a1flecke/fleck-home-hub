import { backupDatabase } from '../src/lib/server/backup';
import { readIdentityConfig } from '../src/lib/server/config';
try {
  if (process.argv.length !== 3) throw new Error('Expected one destination');
  await backupDatabase(readIdentityConfig(process.env).dbPath, process.argv[2]);
  console.log('Backup created and integrity checked.');
} catch {
  console.error('Backup failed; an existing destination is never overwritten. Inspect any newly created destination before retrying.');
  process.exitCode = 1;
}
