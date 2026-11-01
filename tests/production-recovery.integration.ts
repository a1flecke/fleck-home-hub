import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';
import { backupDatabase } from '../src/lib/server/backup';
import { bootstrap, addKid } from '../src/lib/server/bootstrap';
import { createChore, changeChore } from '../src/lib/server/chores';
import { migrate } from '../src/lib/server/identity';
import { recordPayout } from '../src/lib/server/payouts';

const execFileAsync = promisify(execFile);

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

async function waitForStart(child: ChildProcessWithoutNullStreams, origin: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => finish(new Error('Production server did not report readiness')), 15_000);
    const finish = (error?: Error) => {
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.off('error', onError);
      child.off('exit', onExit);
      if (error) reject(error);
      else resolve();
    };
    const onData = (data: Buffer) => {
      output += data.toString();
      if (output.includes(`Listening on ${origin}`)) finish();
    };
    const onError = (error: Error) => finish(error);
    const onExit = (code: number | null) => finish(new Error(`Production server exited before readiness (${code})`));
    child.stdout.on('data', onData);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}

test('a verified backup reopens in the localhost production server after a failed migration', { timeout: 60_000 }, async () => {
  const root = process.cwd();
  const directory = mkdtempSync(join(root, '.synthetic-recovery-'));
  const app = join(directory, 'app');
  const source = join(directory, 'source.sqlite');
  const backup = join(directory, 'backup.sqlite');
  const restored = join(directory, 'restored.sqlite');
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const secret = 'synthetic-production-recovery-secret-32-plus';
  const parent = { name: 'Recovery Parent', email: 'recovery-parent@example.test', password: 'synthetic-parent-password' };
  const kid = { name: 'Recovery Kid', email: 'recovery-kid@example.test', password: 'synthetic-kid-password' };
  let db: Database.Database | undefined;
  let child: ChildProcessWithoutNullStreams | undefined;
  try {
    mkdirSync(app);
    for (const path of ['src', 'static', 'drizzle']) cpSync(join(root, path), join(app, path), { recursive: true });
    for (const path of ['package.json', 'tsconfig.json', 'vite.config.ts']) copyFileSync(join(root, path), join(app, path));
    mkdirSync(join(app, 'scripts'));
    copyFileSync(join(root, 'scripts/start.sh'), join(app, 'scripts/start.sh'));
    symlinkSync(join(root, 'node_modules'), join(app, 'node_modules'), 'dir');
    const household = await bootstrap({ dbPath: source, secret, origin }, { ...parent, household: 'Recovery Home' });
    await addKid({ dbPath: source, secret, origin }, household, kid);
    db = new Database(source, { fileMustExist: true });
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    const parentId = (db.prepare('SELECT id FROM user WHERE email = ?').get(parent.email) as { id: string }).id;
    const kidId = (db.prepare('SELECT id FROM user WHERE email = ?').get(kid.email) as { id: string }).id;
    const chore = createChore(db, parentId, household, { title: 'Recovered chore', assigneeId: kidId, dueDate: '2026-10-30', rewardCents: 250 });
    changeChore(db, kidId, household, chore, 'submit');
    changeChore(db, parentId, household, chore, 'verify');
    recordPayout(db, parentId, household, { childId: kidId, amountCents: 100, date: '2026-10-30', note: '', requestId: 'synthetic-recovery-payment' });
    await backupDatabase(source, backup);
    db.exec('ALTER TABLE user ADD COLUMN unreviewed_schema_change TEXT');
    await assert.rejects(migrate(db));
    db.close(); db = undefined;
    copyFileSync(backup, restored);
    db = new Database(restored, { fileMustExist: true });
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
    await migrate(db);
    db.close(); db = undefined;

    await execFileAsync('mise', ['exec', '--', 'pnpm', 'run', 'build'], { cwd: app, env: { ...process.env, AUTH_ORIGIN: origin } });
    const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_PATH: restored, AUTH_SECRET: secret, AUTH_ORIGIN: origin, PORT: String(port) };
    delete env.HOST;
    delete env.SOCKET_PATH;
    child = spawn('sh', ['scripts/start.sh'], { cwd: app, env, stdio: 'pipe' });
    child.stderr.resume();
    await waitForStart(child, origin);
    const anonymous = await fetch(`${origin}/dashboard`, { redirect: 'manual' });
    assert.equal(anonymous.status, 303);
    for (const account of [parent, kid]) {
      const signedIn = await fetch(`${origin}/api/auth/sign-in/email`, {
        method: 'POST', headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ email: account.email, password: account.password })
      });
      assert.equal(signedIn.status, 200);
      const cookies = signedIn.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; ');
      assert.ok(cookies);
      const dashboard = await fetch(`${origin}/dashboard`, { headers: { cookie: cookies }, redirect: 'manual' });
      assert.equal(dashboard.status, 200);
      assert.match(dashboard.headers.get('cache-control') ?? '', /no-store/);
      const html = await dashboard.text();
      assert.match(html, /Recovered chore/);
      assert.match(html, /Recovery Kid/);
      assert.match(html, /Verified earnings owed: \$1\.50/);
      assert.match(html, /Paid so far: \$1\.00/);
      assert.match(html, /Total verified earnings: \$2\.50/);
    }
  } finally {
    db?.close();
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
