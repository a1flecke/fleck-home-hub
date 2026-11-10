// Test-only process: redeems one pairing secret on its own SQLite connection once every
// competing process is ready, so redemptions genuinely overlap. Driven by runDatabaseWorkers.
import Database from 'better-sqlite3';
import { DisplayPairingError, redeemPairing } from '../../src/lib/server/display-pairing';

const [path, secret, now] = process.argv.slice(2);
const db = new Database(path, { fileMustExist: true, timeout: 5000 });
db.pragma('foreign_keys = ON');
process.send?.('ready');
process.once('message', () => {
  try { redeemPairing(db, secret, Number(now)); process.send?.('redeemed'); }
  catch (cause) { process.send?.(cause instanceof DisplayPairingError ? cause.code : `unexpected: ${String(cause)}`); }
  finally { db.close(); process.disconnect?.(); }
});
