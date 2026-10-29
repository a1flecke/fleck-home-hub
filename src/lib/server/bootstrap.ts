import { closeSync, openSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { createAuth, migrate } from './identity';

type Config = { dbPath: string; origin: string; secret: string };
type Input = { name: string; email: string; password: string; household: string };

export async function bootstrap(config: Config, input: Input) {
  if (!input.name.trim() || !input.household.trim() || !input.email.trim() || input.password.length < 12) throw new Error('A name, household, email, and password of at least 12 characters are required');
  // Exclusive creation makes concurrent or repeated bootstrap fail rather than overwrite a household.
  const fd = openSync(config.dbPath, 'wx', 0o600);
  closeSync(fd);
  const db = new Database(config.dbPath, { fileMustExist: true });
  try {
    db.pragma('foreign_keys = ON');
    await migrate(db);
    const auth = createAuth(db, { ...config, allowSignUp: true });
    const result = await auth.api.signUpEmail({ body: { name: input.name, email: input.email, password: input.password } });
    const householdId = randomUUID();
    db.transaction(() => {
      db.prepare('INSERT INTO household (id, name) VALUES (?, ?)').run(householdId, input.household);
      db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(result.user.id, householdId, 'parent');
    })();
    return householdId;
  } finally {
    db.close();
  }
}

export async function addKid(config: Config, householdId: string, input: Omit<Input, 'household'>) {
  if (!input.name.trim() || !input.email.trim() || input.password.length < 12) throw new Error('A name, email, and password of at least 12 characters are required');
  const db = new Database(config.dbPath, { fileMustExist: true });
  try {
    db.pragma('foreign_keys = ON');
    if (!db.prepare('SELECT 1 FROM household WHERE id = ?').get(householdId)) throw new Error('Household not found');
    const auth = createAuth(db, { ...config, allowSignUp: true });
    const result = await auth.api.signUpEmail({ body: input });
    db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(result.user.id, householdId, 'kid');
  } finally { db.close(); }
}
