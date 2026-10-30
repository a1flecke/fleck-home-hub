import Database from 'better-sqlite3';
import { recordPayout } from '../../src/lib/server/payouts';

const [path, requestId] = process.argv.slice(2);
const db = new Database(path, { fileMustExist: true, timeout: 5000 });
db.pragma('foreign_keys = ON');
process.send?.('ready');
process.once('message', () => {
  try { recordPayout(db, 'parent', 'home', { childId: 'kid', amountCents: 400, date: '2026-10-30', note: '', requestId }); process.send?.('paid'); }
  catch { process.send?.('rejected'); }
  finally { db.close(); process.disconnect?.(); }
});
