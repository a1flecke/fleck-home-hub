// Test-only worker: redeems one pairing secret on its own SQLite connection once every
// competing worker is ready, so redemptions genuinely overlap across threads.
import { parentPort, workerData } from 'node:worker_threads';
import Database from 'better-sqlite3';
import { DisplayPairingError, redeemPairing } from '../../src/lib/server/display-pairing';

const { path, secret, now, barrier } = workerData as { path: string; secret: string; now: number; barrier: Int32Array };
const db = new Database(path, { fileMustExist: true, timeout: 5000 });
db.pragma('foreign_keys = ON');
Atomics.add(barrier, 0, 1);
Atomics.notify(barrier, 0);
if (Atomics.wait(barrier, 1, 0, 10_000) === 'timed-out') throw new Error('Test barrier timed out');
try {
  const device = redeemPairing(db, secret, now);
  parentPort!.postMessage({ ok: true, deviceId: device.deviceId });
} catch (cause) {
  parentPort!.postMessage({ ok: false, code: cause instanceof DisplayPairingError ? cause.code : String(cause) });
} finally {
  db.close();
}
