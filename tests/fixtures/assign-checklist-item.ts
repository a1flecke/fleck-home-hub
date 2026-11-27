import Database from 'better-sqlite3';
import { updateChecklistItem } from '../../src/lib/server/checklists';

const [path, list, item, version] = process.argv.slice(2);
const db = new Database(path, { fileMustExist: true, timeout: 3000 });
db.pragma('foreign_keys = ON');
try {
  if (!db.prepare("SELECT 1 FROM active_membership WHERE user_id = 'child' AND household_id = 'home'").get()) {
    throw new Error('Expected the child to be active in the previous committed state');
  }
  process.send?.('attempting', error => { if (error) throw error; });
  updateChecklistItem(db, 'parent', 'home', list, item, Number(version), 'New name', 'child');
  process.send?.('assigned');
} catch (error) {
  process.send?.(error instanceof Error ? error.message : 'Unexpected failure');
} finally {
  db.close();
  process.disconnect?.();
}
