import Database from 'better-sqlite3';
import { recordExpensePayment } from '../../src/lib/server/expense-payments';

const [path, expenseId, requestId, actor] = process.argv.slice(2);
const db = new Database(path, { fileMustExist: true, timeout: 5000 });
db.pragma('foreign_keys = ON');
process.send?.('ready');
process.once('message', () => {
  process.send?.('attempting');
  try {
    recordExpensePayment(db, actor, 'home', { expenseId, scheduledDate: '2099-01-31', paidDate: '2099-01-30', amountCents: 7000, note: '', requestId });
    process.send?.('paid');
  } catch { process.send?.('rejected'); }
  finally { db.close(); process.disconnect?.(); }
});
