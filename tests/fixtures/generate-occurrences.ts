import Database from 'better-sqlite3';
import { generateOccurrences } from '../../src/lib/server/recurring';

const [path] = process.argv.slice(2);
const db = new Database(path, { fileMustExist: true, timeout: 5000 });
db.pragma('foreign_keys = ON');
process.send?.('ready');
process.once('message', () => {
  try { generateOccurrences(db, 'parent', 'home', '2099-01-01', '2099-01-07'); process.send?.('generated'); }
  catch { process.send?.('failed'); }
  finally { db.close(); process.disconnect?.(); }
});
