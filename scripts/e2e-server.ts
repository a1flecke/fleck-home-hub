import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';
import { bootstrap } from '../src/lib/server/bootstrap';
import { createAuth } from '../src/lib/server/identity';

// Synthetic fixtures only, isolated from developer databases and credentials.
const directory = mkdtempSync(join(tmpdir(), 'fleck-e2e-'));
const config = { dbPath: join(directory, 'fixture.sqlite'), origin: 'http://127.0.0.1:4173', secret: 'synthetic-test-secret-only-not-for-production-1234' };
await bootstrap(config, { name: 'Sample Parent', email: 'parent@example.test', password: 'synthetic-parent-password', household: 'Example' });
const db = new Database(config.dbPath, { fileMustExist: true });
const auth = createAuth(db, { ...config, allowSignUp: true });
const kid = await auth.api.signUpEmail({ body: { name: 'Sample Kid', email: 'kid@example.test', password: 'synthetic-kid-password' } });
const other = await auth.api.signUpEmail({ body: { name: 'Other Kid', email: 'other@example.test', password: 'synthetic-other-password' } });
const payoutKid = await auth.api.signUpEmail({ body: { name: 'Payout Kid', email: 'payout-kid@example.test', password: 'synthetic-payout-kid-password' } });
const household = db.prepare('SELECT id FROM household').get() as { id: string };
db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(kid.user.id, household.id, 'kid');
db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(other.user.id, household.id, 'kid');
db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(payoutKid.user.id, household.id, 'kid');
db.close();
const child = spawn('pnpm', ['exec', 'vite', 'dev', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], {
  stdio: 'inherit', env: { ...process.env, DATABASE_PATH: config.dbPath, AUTH_SECRET: config.secret, AUTH_ORIGIN: config.origin }
});
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => { rmSync(directory, { recursive: true, force: true }); process.exit(code ?? 1); });
child.on('error', () => { rmSync(directory, { recursive: true, force: true }); process.exit(1); });
