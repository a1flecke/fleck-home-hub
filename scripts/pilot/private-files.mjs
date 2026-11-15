import { linkSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Publish the complete contents without overwriting an existing file.
/** @param {string} destination @param {string} contents */
export function publishPrivateFile(destination, contents) {
  const staging = mkdtempSync(join(dirname(destination), '.setup-'));
  try {
    const draft = join(staging, 'draft');
    writeFileSync(draft, contents, { mode: 0o600 });
    linkSync(draft, destination);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
