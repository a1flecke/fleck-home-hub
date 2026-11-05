// Bundled as source for a Node worker; tokens, credentials and errors never leave
// the worker through stdout/stderr. Only a successful user ID is returned.
(async () => {
  const { parentPort, workerData } = await import('node:worker_threads');
  const { default: Database } = await import('better-sqlite3');
  const { betterAuth } = await import('better-auth');
  const { getAdapter } = await import('better-auth/db/adapter');
  const { createHash } = await import('node:crypto');
  const { path, config, token, input } = workerData;
  const db = new Database(path, { fileMustExist: true });
  db.pragma('foreign_keys = ON');
  try {
    let provisionedUserId;
    const hash = createHash('sha256').update(token).digest('hex');
    /** @type {import('better-auth').BetterAuthOptions} */
    const options = {
      database: db, secret: config.secret, baseURL: config.origin,
      logger: { disabled: true },
      emailAndPassword: { enabled: true, autoSignIn: false },
      advanced: { useSecureCookies: config.origin.startsWith('https:'), ipAddress: { ipAddressHeaders: [] } },
      databaseHooks: { account: { create: { before: async (account) => {
        const invitation = db.prepare('SELECT id, household_id, role, created_by FROM household_invitation WHERE token_hash = ? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?').get(hash, Date.now());
        if (!invitation || typeof invitation !== 'object' || !('id' in invitation) || !('household_id' in invitation) || !('role' in invitation) || !('created_by' in invitation)) throw new Error('Invalid invitation');
        const issuer = db.prepare("SELECT 1 FROM membership WHERE user_id = ? AND household_id = ? AND role = 'parent'").get(invitation.created_by, invitation.household_id);
        if (!issuer) throw new Error('Invalid invitation');
        const result = db.prepare('UPDATE household_invitation SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?').run(Date.now(), invitation.id, Date.now());
        if (result.changes !== 1) throw new Error('Invalid invitation');
        db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(account.userId, invitation.household_id, invitation.role);
        provisionedUserId = account.userId;
      } } } }
    };
    const adapter = await getAdapter(options);
    // Reserve the writer before Better Auth reads/hashes. A deferred read-to-write
    // upgrade can fail immediately when another connection is already writing.
    adapter.transaction = async (callback) => {
      db.exec('BEGIN IMMEDIATE');
      try {
        // Recheck after reserving the writer, before signup hashes a password.
        // The HTTP preflight may have raced with revocation or issuer removal.
        const usable = db.prepare("SELECT 1 FROM household_invitation i JOIN membership m ON m.user_id = i.created_by AND m.household_id = i.household_id AND m.role = 'parent' WHERE i.token_hash = ? AND i.consumed_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > ?").get(hash, Date.now());
        if (!usable) throw new Error('Invalid invitation');
        const result = await callback(adapter); db.exec('COMMIT'); return result;
      }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    };
    const auth = betterAuth({ ...options, database: () => adapter });
    const result = await auth.api.signUpEmail({ body: input });
    // With autoSignIn disabled, duplicate emails return a synthetic user. Only
    // the transactional membership hook proves an account was provisioned.
    if (!provisionedUserId || result.user.id !== provisionedUserId) throw new Error('Account was not provisioned');
    parentPort?.postMessage(provisionedUserId);
  } finally { db.close(); }
})().catch(() => { process.exitCode = 1; });
