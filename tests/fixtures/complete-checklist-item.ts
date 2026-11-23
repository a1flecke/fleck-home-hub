import Database from 'better-sqlite3';
import { setItemCompletion } from '../../src/lib/server/checklists';

const [path, checklistId, itemId] = process.argv.slice(2);
const db = new Database(path, { fileMustExist: true, timeout: 3000 });
db.pragma('foreign_keys = ON');
process.once('message', () => {
  try {
    if (!db.prepare("SELECT 1 FROM active_membership WHERE user_id = 'kid' AND household_id = 'home'").get()) throw new Error('Expected the previous committed membership');
    process.send?.('attempting', error => { if (error) throw error; });
    setItemCompletion(db, 'kid', 'home', checklistId, itemId, 1, true);
    process.send?.('completed');
  } catch (error) {
    process.send?.(error instanceof Error ? error.message : 'Unexpected failure');
  } finally {
    db.close();
    process.disconnect?.();
  }
});
process.send?.('ready');
