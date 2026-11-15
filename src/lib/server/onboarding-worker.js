// Loaded as source by the provisioning worker so the production bundle can start it.
(async () => {
  const { parentPort, workerData } = await import('node:worker_threads');
  const { randomBytes, randomUUID } = await import('node:crypto');
  const { default: Database } = await import('better-sqlite3');
  const { betterAuth } = await import('better-auth');
  const { getAdapter } = await import('better-auth/db/adapter');
  const { path, config, operation } = workerData;
  const { input } = operation;
  const setup = operation.kind === 'setup';
  const db = new Database(path, { fileMustExist: true });
  db.pragma('foreign_keys = ON');
  try {
    const householdId = setup ? randomUUID() : operation.householdId;
    /** @type {string | undefined} */
    let userId;
    const membership = db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)');
    /** @type {import('better-auth').BetterAuthOptions} */
    const options = {
      database: db,
      secret: config.secret,
      baseURL: config.origin,
      logger: { disabled: true },
      emailAndPassword: { enabled: true, autoSignIn: setup },
      advanced: { useSecureCookies: config.origin.startsWith('https:'), ipAddress: { ipAddressHeaders: [] } },
      databaseHooks: { account: { create: { before: async (account) => {
        if (setup) {
          db.prepare('INSERT INTO household (id, name) VALUES (?, ?)').run(householdId, input.household.trim());
          db.prepare('INSERT INTO household_settings (household_id, timezone) VALUES (?, ?)').run(householdId, input.timezone);
          membership.run(account.userId, householdId, 'parent');
          db.prepare("INSERT INTO household_onboarding (household_id, step) VALUES (?, 'parents')").run(householdId);
        } else {
          membership.run(account.userId, householdId, 'kid');
          db.prepare('INSERT INTO managed_child (user_id, household_id, username, request_id, created_by) VALUES (?, ?, ?, ?, ?)').run(account.userId, householdId, input.username, operation.requestId, operation.actor);
        }
        userId = account.userId;
      } } } }
    };
    const adapter = await getAdapter(options);
    adapter.transaction = async (callback) => {
      db.exec('BEGIN IMMEDIATE');
      try {
        if (setup) {
          if (db.prepare('SELECT 1 FROM household UNION ALL SELECT 1 FROM user LIMIT 1').get()) throw new Error('Initial setup is closed');
          const now = Date.now();
          const consumed = db.prepare('UPDATE initial_setup SET consumed_at = ? WHERE id = 1 AND code_hash = ? AND consumed_at IS NULL AND expires_at > ?').run(now, operation.hash, now);
          if (consumed.changes !== 1) throw new Error('Initial setup is unavailable');
        } else {
          const parent = db.prepare("SELECT 1 FROM active_membership WHERE user_id = ? AND household_id = ? AND role = 'parent'").get(operation.actor, householdId);
          if (!parent) throw new Error('Not authorized');
          if (input.username && db.prepare('SELECT 1 FROM managed_child WHERE username = ?').get(input.username)) throw new Error('Username unavailable');
        }
        const result = await callback(adapter);
        if (!userId) throw new Error('Account was not created');
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    };
    const auth = betterAuth({ ...options, database: () => adapter });
    const response = await auth.api.signUpEmail({
      body: {
        name: input.name.trim(),
        email: setup ? input.email.trim() : randomUUID() + '@children.fleck.invalid',
        password: input.password || randomBytes(32).toString('base64url')
      },
      asResponse: true
    });
    const cookies = response.headers.getSetCookie();
    if (!response.ok || (setup && !cookies.length)) throw new Error('Account provisioning failed');
    parentPort?.postMessage({ userId, cookies });
  } finally {
    db.close();
  }
})().catch(() => { process.exitCode = 1; });
