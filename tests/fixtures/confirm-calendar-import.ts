import Database from 'better-sqlite3';
import { confirmCalendarImport } from '../../src/lib/server/calendar-import';

const [path, importKey] = process.argv.slice(2);
const db = new Database(path, { fileMustExist: true, timeout: 3000 });
db.pragma('foreign_keys = ON');
process.once('message', () => {
  try {
    if (!db.prepare("SELECT 1 FROM active_membership WHERE user_id = 'parent2' AND household_id = 'home' AND role = 'parent'").get()) {
      throw new Error('Expected the previous committed membership');
    }
    process.send?.('attempting', error => { if (error) throw error; });
    confirmCalendarImport(db, 'parent2', 'home', [{
      key: 'ics:0',
      sourceUid: 'revoked-import@example.test',
      originalSummary: 'Revoked import event',
      action: 'import',
      title: 'Revoked import event',
      date: '2099-05-10',
      endDate: '',
      allDay: true,
      startTime: '',
      endTime: '',
      weekdays: [],
      location: '',
      description: '',
      participants: []
    }], importKey);
    process.send?.('imported');
  } catch (error) {
    process.send?.(error instanceof Error ? error.message : 'Unexpected failure');
  } finally {
    db.close();
    process.disconnect?.();
  }
});
process.send?.('ready');
