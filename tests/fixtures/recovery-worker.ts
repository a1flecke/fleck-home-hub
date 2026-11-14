import Database from 'better-sqlite3';
import { generateOccurrences } from '../../src/lib/server/recurring';
import { listRecoveryGaps, resolveRecoveryGap } from '../../src/lib/server/recovery';

const [path, id, date, mode] = process.argv.slice(2);
const db = new Database(path, { fileMustExist: true, timeout: 5000 });
db.pragma('foreign_keys = ON');
const reviewed = listRecoveryGaps(db, 'parent', 'home').find(gap => gap.seriesId === id && gap.date === date)?.reviewed ?? '';
process.send?.('ready');
process.once('message', () => {
  try {
    if (mode === 'generate') {
      generateOccurrences(db, 'parent', 'home', date, date);
      process.send?.('generated');
    } else {
      resolveRecoveryGap(db, 'parent', 'home', { seriesId: id, date, decision: 'create', assigneeId: 'kid', rewardCents: null, reviewed });
      process.send?.('created');
    }
  } catch { process.send?.('conflict'); }
  finally { db.close(); process.disconnect?.(); }
});
