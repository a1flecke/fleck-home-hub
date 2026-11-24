import Database from 'better-sqlite3';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate as migrateDrizzle } from 'drizzle-orm/better-sqlite3/migrator';
import { expect, test } from 'vitest';
import { createAuth, migrate } from '../src/lib/server/identity';
import { issueSetupCode } from '../src/lib/server/setup-code';
import { advanceOnboarding, onboardingStep, provisionFirstParent } from '../src/lib/server/onboarding';

const config = { secret: 'synthetic-onboarding-tests-only-secret', origin: 'http://localhost:3000' };
const input = { name: 'Avery Parent', email: 'avery@example.test', password: 'synthetic-family-password', household: 'An Example Family', timezone: 'America/Denver' };

test('initial setup is atomic, survives a failed write and creates a real session for exactly one winner', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fleck-onboarding-'));
  const db = new Database(join(directory, 'hub.sqlite'));
  try {
    db.pragma('foreign_keys = ON');
    await migrate(db);
    const expired = issueSetupCode(db);
    db.prepare('UPDATE initial_setup SET expires_at = 0').run();
    await expect(provisionFirstParent(db, config, expired, input)).rejects.toThrow();
    const replaced = issueSetupCode(db);
    const code = issueSetupCode(db);
    await expect(provisionFirstParent(db, config, replaced, input)).rejects.toThrow();
    await expect(provisionFirstParent(db, config, 'a'.repeat(43), input)).rejects.toThrow();
    const count = (table: 'household' | 'user' | 'membership' | 'session') =>
      (db.prepare('SELECT count(*) AS n FROM ' + table).get() as { n: number }).n;
    expect(count('household')).toBe(0);

    db.exec("CREATE TRIGGER fail_first_parent BEFORE INSERT ON session BEGIN SELECT RAISE(ABORT, 'synthetic late failure'); END");
    await expect(provisionFirstParent(db, config, code, input)).rejects.toThrow();
    expect([count('household'), count('user'), count('membership'), count('session')]).toEqual([0, 0, 0, 0]);
    db.exec('DROP TRIGGER fail_first_parent');

    const results = await Promise.allSettled([
      provisionFirstParent(db, config, code, input),
      provisionFirstParent(db, config, code, { ...input, email: 'second@example.test' })
    ]);
    const winner = results.find(result => result.status === 'fulfilled');
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect([count('household'), count('user'), count('membership'), count('session')]).toEqual([1, 1, 1, 1]);
    expect(db.prepare('SELECT timezone FROM household_settings').get()).toEqual({ timezone: input.timezone });
    expect(db.prepare('SELECT role FROM active_membership').get()).toEqual({ role: 'parent' });

    const reopened = new Database(db.name, { fileMustExist: true });
    try {
      expect(() => issueSetupCode(reopened)).toThrow();
      await expect(provisionFirstParent(reopened, config, code, input)).rejects.toThrow();
      const cookie = winner?.value.map(header => header.split(';')[0]).join('; ') ?? '';
      const session = await createAuth(reopened, config).api.getSession({ headers: new Headers({ cookie }) });
      expect(session?.user.name).toBe(input.name);
      if (!session) throw new Error('Expected the first parent session');
      const household = db.prepare('SELECT id FROM household').get() as { id: string };
      expect(onboardingStep(reopened, household.id)).toBe('parents');
      expect(() => advanceOnboarding(reopened, 'outsider', household.id, 'parents', 'finish')).toThrow('Not authorized');
      expect(advanceOnboarding(reopened, session.user.id, household.id, 'children', 'finish')).toBe(false);
      expect(onboardingStep(reopened, household.id)).toBe('parents');
      expect(advanceOnboarding(reopened, session.user.id, household.id, 'parents', 'finish')).toBe(true);
      expect(onboardingStep(reopened, household.id)).toBe('complete');
    } finally { reopened.close(); }
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
  // This test hashes several passwords and exercises failed plus concurrent provisions.
  // It runs in under a second in isolation but can exceed the 5-second default on a loaded full-suite runner.
}, 15000);

test('upgrading a configured household preserves legacy child access and leaves onboarding closed', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fleck-onboarding-upgrade-'));
  const db = new Database(join(directory, 'hub.sqlite'));
  try {
    db.pragma('foreign_keys = ON');
    db.exec(readFileSync('drizzle/auth/0001_better_auth.sql', 'utf8'));
    const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as { entries: { tag: string }[] };
    const prefix = (entries: { tag: string }[]) => entries.slice(0, entries.findIndex(entry => entry.tag === '0015_chore_recovery') + 1);
    const entries = prefix(journal.entries);
    expect(entries.at(-1)?.tag).toBe('0015_chore_recovery');
    expect(prefix([...journal.entries, { tag: 'future_migration' }])).toEqual(entries);
    mkdirSync(join(directory, 'meta'));
    for (const { tag } of entries) copyFileSync('drizzle/' + tag + '.sql', join(directory, tag + '.sql'));
    writeFileSync(join(directory, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
    migrateDrizzle(drizzle(db), { migrationsFolder: directory });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name IN ('initial_setup', 'household_onboarding', 'managed_child')").all()).toEqual([]);

    const auth = createAuth(db, { ...config, allowSignUp: true });
    const legacy = { name: 'Existing Child', email: 'legacy-child@example.test', password: input.password };
    const { user } = await auth.api.signUpEmail({ body: legacy });
    db.exec("INSERT INTO household (id, name) VALUES ('existing', 'Existing Family')");
    db.exec("INSERT INTO household_settings (household_id, timezone) VALUES ('existing', 'America/Denver')");
    db.prepare("INSERT INTO membership (user_id, household_id, role) VALUES (?, 'existing', 'kid')").run(user.id);
    await migrate(db);

    const existingAuth = createAuth(db, config);
    const { user: signedIn } = await existingAuth.api.signInEmail({ body: { email: legacy.email, password: legacy.password } });
    expect(signedIn.id).toBe(user.id);
    expect(db.prepare("SELECT role FROM active_membership WHERE user_id = ? AND household_id = 'existing'").get(user.id)).toEqual({ role: 'kid' });
    expect(db.prepare("SELECT timezone FROM household_settings WHERE household_id = 'existing'").get()).toEqual({ timezone: 'America/Denver' });
    expect(onboardingStep(db, 'existing')).toBeUndefined();
    expect(() => issueSetupCode(db)).toThrow('Initial setup is closed');
    expect(db.pragma('foreign_key_check')).toEqual([]);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
