// Own the SQLite writer lock on this thread until Better Auth has finished.
(async () => {
  const { parentPort, workerData } = await import('node:worker_threads');
  const { default: Database } = await import('better-sqlite3');
  const { betterAuth } = await import('better-auth');
  const { createAuthEndpoint } = await import('better-auth/api');
  const { path, config, actorId, householdId, targetId } = workerData;
  const db = new Database(path, { fileMustExist: true });
  try {
    db.pragma('foreign_keys = ON');
    const auth = betterAuth({
      database: db, secret: config.secret, baseURL: config.origin,
      logger: { disabled: true },
      plugins: [{ id: 'final-membership-revocation', endpoints: {
        revokeDisabledMemberSessions: createAuthEndpoint.serverOnly({ method: 'POST' }, async (ctx) => {
          await ctx.context.internalAdapter.deleteUserSessions(targetId);
          return { ok: true };
        })
      } }]
    });
    db.exec('BEGIN IMMEDIATE');
    const actor = db.prepare("SELECT 1 FROM active_membership WHERE user_id = ? AND household_id = ? AND role = 'parent'").get(actorId, householdId);
    if (!actor) return parentPort?.postMessage('not-authorized');
    if (actorId === targetId) return parentPort?.postMessage('self');
    const target = db.prepare('SELECT disabled_at FROM membership WHERE user_id = ? AND household_id = ?').get(targetId, householdId);
    if (!target) return parentPort?.postMessage('unavailable');
    if (typeof target === 'object' && 'disabled_at' in target && target.disabled_at !== null) return parentPort?.postMessage('unchanged');

    const now = Date.now();
    db.prepare('UPDATE membership SET disabled_at = ?, disabled_by = ? WHERE user_id = ? AND household_id = ?').run(now, actorId, targetId, householdId);
    db.prepare('UPDATE household_invitation SET revoked_at = ? WHERE household_id = ? AND created_by = ? AND consumed_at IS NULL AND revoked_at IS NULL').run(now, householdId, targetId);
    db.prepare('UPDATE display_pairing SET revoked_at = ? WHERE household_id = ? AND created_by = ? AND consumed_at IS NULL AND revoked_at IS NULL').run(now, householdId, targetId);
    db.prepare('UPDATE display_device SET revoked_at = ?, revoked_by = ? WHERE household_id = ? AND created_by = ? AND revoked_at IS NULL').run(now, actorId, householdId, targetId);
    if (!db.prepare('SELECT 1 FROM active_membership WHERE user_id = ? LIMIT 1').get(targetId)) {
      await auth.api.revokeDisabledMemberSessions();
    }
    db.exec('COMMIT');
    parentPort?.postMessage('changed');
  } catch (error) {
    if (error instanceof Error && error.message === 'A household must keep an active parent') {
      parentPort?.postMessage('last-parent');
    } else {
      process.exitCode = 1;
    }
  } finally {
    try { if (db.inTransaction) db.exec('ROLLBACK'); }
    finally { db.close(); }
  }
})().catch(() => { process.exitCode = 1; });
