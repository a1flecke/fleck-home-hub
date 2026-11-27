import Database from 'better-sqlite3';
import { setChecklistEventLink } from '../../src/lib/server/checklists';

const [path, list, eventId, date] = process.argv.slice(2);
const db = new Database(path, { fileMustExist: true, timeout: 3000 });
db.pragma('foreign_keys = ON');
try {
  if (!db.prepare("SELECT 1 FROM active_membership WHERE user_id = 'parent' AND household_id = 'home'").get()) {
    throw new Error('Expected a parent in the previous committed state');
  }
  process.send?.('attempting', error => { if (error) throw error; });
  setChecklistEventLink(db, 'parent', 'home', list, '', { eventId, date });
  process.send?.('attached');
} catch (error) {
  process.send?.(error instanceof Error ? error.message : 'Unexpected failure');
} finally {
  db.close();
  process.disconnect?.();
}
