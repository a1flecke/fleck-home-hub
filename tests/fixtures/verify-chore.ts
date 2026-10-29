import Database from 'better-sqlite3';
import { changeChore } from '../../src/lib/server/chores';

const [path, actor, chore] = process.argv.slice(2);
const db = new Database(path, { fileMustExist: true, timeout: 5000 });
db.pragma('foreign_keys = ON');
process.send?.('ready');
process.once('message', () => {
  try { changeChore(db, actor, 'home', chore, 'verify'); process.send?.('verified'); }
  catch { process.send?.('rejected'); }
  finally { db.close(); process.disconnect?.(); }
});
