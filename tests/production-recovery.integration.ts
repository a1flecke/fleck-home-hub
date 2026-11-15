import { test } from 'node:test';
import { createHash, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';
import { backupDatabase } from '../src/lib/server/backup';
import { bootstrap, addKid } from '../src/lib/server/bootstrap';
import { createChore, changeChore } from '../src/lib/server/chores';
import { migrate } from '../src/lib/server/identity';
import { recordPayout } from '../src/lib/server/payouts';
import { createExpense } from '../src/lib/server/expenses';
import { recordExpensePayment, reverseExpensePayment } from '../src/lib/server/expense-payments';

const execFileAsync = promisify(execFile);

// BSD and util-linux script both allocate a real controlling terminal. Keep
// command stdout/stderr separate so the setup code can only arrive on the PTY.
async function issueCodeFromConfig(config: string, directory: string, whenNeeded = false) {
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  const stdout = join(directory, 'setup-stdout');
  const stderr = join(directory, 'setup-stderr');
  const args = ['mise', 'run', 'setup-code', '--', '--config-file', config];
  if (whenNeeded) args.push('--if-needed');
  const command = 'exec ' + args.map(quote).join(' ') + ' >' + quote(stdout) + ' 2>' + quote(stderr);
  const env = { ...process.env };
  delete env.AUTH_SECRET;
  delete env.DATABASE_PATH;
  delete env.AUTH_ORIGIN;
  const invocation = process.platform === 'darwin'
    ? ['-q', '/dev/null', 'sh', '-c', command]
    : ['-q', '-c', command, '/dev/null'];
  const runner = spawn('script', invocation, { env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 5_000 });
  let terminal = '';
  runner.stdout.setEncoding('utf8').on('data', (chunk: string) => { terminal += chunk; });
  runner.stderr.resume();
  const [, signal] = await once(runner, 'close');
  assert.equal(signal, null, 'The terminal runner must finish normally');
  const code = /^([\w-]{43})\r?$/m.exec(terminal)?.[1];
  if (code) {
    assert.ok(!readFileSync(stdout, 'utf8').includes(code));
    assert.ok(!readFileSync(stderr, 'utf8').includes(code));
  }
  return code;
}

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

test('the packaged server supports verified restores and fresh host-authorized onboarding', { timeout: 60_000 }, async () => {
  const port = await freePort();
  const root = process.cwd();
  const directory = mkdtempSync(join(root, '.synthetic-recovery-'));
  const app = join(directory, 'app');
  const source = join(directory, 'source.sqlite');
  const backup = join(directory, 'backup.sqlite');
  const restored = join(directory, 'restored.sqlite');
  const origin = `http://127.0.0.1:${port}`;
  const secret = 'synthetic-production-recovery-secret-32-plus';
  const invitationToken = randomBytes(32).toString('base64url');
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
    cpSync(join(root, 'scripts/pilot/launch.sh'), join(app, 'scripts/pilot/launch.sh'));
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
    db.prepare('INSERT INTO household_invitation (id, token_hash, household_id, role, created_by, expires_at) VALUES (?, ?, ?, ?, ?, ?)').run('synthetic-recovery-invite', createHash('sha256').update(invitationToken).digest('hex'), household, 'kid', parentId, Date.now() + 600_000);
    const expenseId = createExpense(db, parentId, household, { title: 'Recovered expense', amountCents: 7000, dueDate: '2099-01-31', cadence: 'once', payee: '', category: '', notes: '' });
    const expensePayment = recordExpensePayment(db, parentId, household, { expenseId, scheduledDate: '2099-01-31', paidDate: '2026-10-30', amountCents: 6900, note: '', requestId: 'recovery-expense' });
    reverseExpensePayment(db, parentId, household, expensePayment, 'Correct amount');
    await backupDatabase(source, backup);
    db.exec('ALTER TABLE user ADD COLUMN unreviewed_schema_change TEXT');
    await assert.rejects(migrate(db));
    db.close(); db = undefined;
    copyFileSync(backup, restored);
    db = new Database(restored, { fileMustExist: true });
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
    await migrate(db);
    assert.deepEqual(db.prepare('SELECT planned_title, amount_cents FROM expense_payment').get(), { planned_title: 'Recovered expense', amount_cents: 6900 });
    assert.deepEqual(db.prepare('SELECT reason FROM expense_payment_reversal').get(), { reason: 'Correct amount' });
    assert.deepEqual(db.pragma('foreign_key_check'), []);
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
    const invited = await fetch(`${origin}/accept-invitation`, {
      method: 'POST', headers: { origin, accept: 'text/html', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: invitationToken, name: 'Recovered Invitee', email: 'recovered-invitee@example.test', password: 'synthetic-invitee-password' }), redirect: 'manual'
    });
    assert.equal(invited.status, 303);
    assert.equal(invited.headers.get('location'), '/accept-invitation?success=1');
    const inviteeSignIn = await fetch(`${origin}/api/auth/sign-in/email`, {
      method: 'POST', headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'recovered-invitee@example.test', password: 'synthetic-invitee-password' })
    });
    assert.equal(inviteeSignIn.status, 200);
    const inviteeCookies = inviteeSignIn.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; ');
    const admin = await fetch(`${origin}/settings/household`, { headers: { cookie: inviteeCookies }, redirect: 'manual' });
    assert.equal(admin.status, 403);
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

    // Build for a synthetic Serve origin and send its requests over loopback.
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
    const fresh = join(directory, 'fresh.sqlite');
    const httpsOrigin = 'https://synthetic.example.ts.net:8443';
    await execFileAsync('mise', ['exec', '--', 'pnpm', 'run', 'build'], { cwd: app, env: { ...process.env, AUTH_ORIGIN: httpsOrigin } });
    const configFile = join(directory, 'fresh pilot.conf');
    writeFileSync(configFile, `AUTH_SECRET=${secret}\nDATABASE_PATH=${fresh}\nAUTH_ORIGIN=${httpsOrigin}\nPORT=${port}\n`, { mode: 0o600 });
    chmodSync(configFile, 0o644);
    assert.equal(await issueCodeFromConfig(configFile, directory), undefined);
    assert.equal(existsSync(fresh), false, 'A broadly readable config must not initialize the database');
    chmodSync(configFile, 0o600);
    const configLink = join(directory, 'linked.conf');
    symlinkSync(configFile, configLink);
    assert.equal(await issueCodeFromConfig(configLink, directory), undefined);
    assert.equal(existsSync(fresh), false, 'A linked config must not initialize the database');
    const setupEnv = { ...process.env };
    delete setupEnv.AUTH_SECRET;
    delete setupEnv.DATABASE_PATH;
    delete setupEnv.AUTH_ORIGIN;
    await execFileAsync('mise', ['run', 'setup-code', '--', '--config-file', configFile, '--prepare'], { env: setupEnv });
    assert.equal(existsSync(fresh), true);
    const prepared = new Database(fresh, { readonly: true, fileMustExist: true });
    try {
      assert.equal(prepared.prepare('SELECT 1 FROM initial_setup').get(), undefined, 'Preparation must leave setup locked until the service is ready');
    } finally { prepared.close(); }
    const { stdout: misePath } = await execFileAsync('which', ['mise']);
    child = spawn('sh', ['scripts/pilot/launch.sh'], {
      cwd: app, env: { ...process.env, HUB_ENV_FILE: configFile, HUB_MISE: misePath.trim() }, stdio: 'pipe'
    });
    child.stderr.resume();
    await waitForStart(child, origin);
    const health = await fetch(origin + '/api/auth/ok');
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true });
    const code = await issueCodeFromConfig(configFile, directory, true);
    assert.ok(code, 'Issuing setup from the private service config must work without exported settings');
    const freshHome = await fetch(origin);
    assert.equal(freshHome.status, 200);
    assert.match(await freshHome.text(), /Set up our family/);
    const setup = await fetch(`${origin}/setup?/parent`, {
      method: 'POST', headers: { origin: httpsOrigin, accept: 'text/html', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        household: 'Production Setup Family', timezone: 'America/Denver',
        name: 'First Parent', email: 'first-parent@example.test', password: parent.password,
        confirmation: parent.password, code
      }), redirect: 'manual'
    });
    assert.equal(setup.status, 303);
    assert.equal(setup.headers.get('location'), '/onboarding');
    const setupCookieHeaders = setup.headers.getSetCookie();
    assert.ok(setupCookieHeaders.some(cookie => /; Secure(?:;|$)/i.test(cookie) && /; HttpOnly(?:;|$)/i.test(cookie)));
    const setupCookies = setupCookieHeaders.map(cookie => cookie.split(';')[0]).join('; ');
    assert.ok(setupCookies);
    assert.equal(await issueCodeFromConfig(configFile, directory, true), undefined, 'Rerunning setup cannot reopen a provisioned household');
    const onboarding = await fetch(`${origin}/onboarding`, { headers: { cookie: setupCookies }, redirect: 'manual' });
    assert.equal(onboarding.status, 200);
    const onboardingHtml = await onboarding.text();
    assert.match(onboardingHtml, /Production Setup Family/);
    assert.ok(!onboardingHtml.includes(code));

    const childPassword = 'synthetic-production-child-password';
    const created = await fetch(`${origin}/onboarding?/add`, {
      method: 'POST',
      headers: { origin: httpsOrigin, cookie: setupCookies, accept: 'text/html', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        requestId: 'ad4feb70-1bfd-4e34-9608-74283d74738d', name: 'Production Child', username: 'production-child',
        password: childPassword, confirmation: childPassword
      })
    });
    assert.equal(created.status, 200);
    const createdHtml = await created.text();
    assert.ok(!createdHtml.includes(childPassword));
    assert.ok(!createdHtml.includes('children.fleck.invalid'));
    db = new Database(fresh, { readonly: true, fileMustExist: true });
    const managed = db.prepare('SELECT u.email FROM managed_child c JOIN user u ON u.id = c.user_id WHERE c.username = ?')
      .get('production-child') as { email: string } | undefined;
    assert.ok(managed);
    const emailSignIn = await fetch(`${origin}/api/auth/sign-in/email`, {
      method: 'POST', headers: { origin: httpsOrigin, 'content-type': 'application/json' },
      body: JSON.stringify({ email: managed.email, password: childPassword })
    });
    assert.equal(emailSignIn.status, 401);
    assert.deepEqual(emailSignIn.headers.getSetCookie(), []);
    const formEmailSignIn = await fetch(`${origin}/api/auth/sign-in/email`, {
      method: 'POST', headers: { origin: httpsOrigin, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams([['email', 'ordinary@example.test'], ['email', managed.email], ['password', childPassword]])
    });
    assert.equal(formEmailSignIn.status, 401);
    assert.deepEqual(formEmailSignIn.headers.getSetCookie(), []);
    const childSignIn = await fetch(`${origin}/sign-in/child`, {
      method: 'POST', headers: { origin: httpsOrigin, accept: 'text/html', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: 'production-child', password: childPassword }), redirect: 'manual'
    });
    assert.equal(childSignIn.status, 303);
    const childCookies = childSignIn.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; ');
    assert.ok(childCookies);
    const childDashboard = await fetch(`${origin}/dashboard`, { headers: { cookie: childCookies }, redirect: 'manual' });
    assert.equal(childDashboard.status, 200);
    assert.match(await childDashboard.text(), /Production Child/);

    const directPasswordChange = await fetch(`${origin}/api/auth/change-password`, {
      method: 'POST', headers: { origin: httpsOrigin, cookie: childCookies, 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword: childPassword, newPassword: 'synthetic-direct-child-password' })
    });
    assert.equal(directPasswordChange.status, 403);
    const rawSessions = await fetch(`${origin}/api/auth/list-sessions`, { headers: { cookie: childCookies } });
    assert.equal(rawSessions.status, 403);
    const safeSessions = await fetch(`${origin}/settings/sessions`, { headers: { cookie: childCookies } });
    assert.equal(safeSessions.status, 200);
    assert.ok(!(await safeSessions.text()).includes(childCookies));
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
