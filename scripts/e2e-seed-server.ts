import { createServer, type IncomingMessage, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { hashPassword } from 'better-auth/crypto';

/**
 * Browser-test-only seeding service. It is started by scripts/e2e-server.ts against the synthetic
 * fixture database and is never part of the application: nothing under src/ may import it
 * (tests/architecture/e2e-isolation.test.ts). Each call creates a brand-new household with its own
 * members and chores, so a test that uses it can run any number of times in one server without
 * colliding with itself or with another spec.
 */
export const SEED_PORT = 4175;

type MemberInput = { name: string; role: 'parent' | 'kid'; disabled?: boolean };
type ChoreInput = { key: string; assignee: string; title: string; description?: string; dueDate: string; rewardCents?: number | null; status?: 'todo' | 'pending_verification' | 'needs_rework' | 'verified' };
type HouseholdInput = { name?: string; members: MemberInput[]; chores?: ChoreInput[] };
export type SeededMember = { id: string; name: string; role: 'parent' | 'kid'; email: string; password: string; disabled: boolean };
export type SeededHousehold = { id: string; name: string; members: Record<string, SeededMember>; chores: Record<string, string> };

const MAX_BODY_BYTES = 64 * 1024;
const statuses = new Set(['todo', 'pending_verification', 'needs_rework', 'verified']);

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    total += (chunk as Buffer).length;
    if (total > MAX_BODY_BYTES) throw new Error('Request body too large');
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function validate(value: unknown): HouseholdInput {
  const input = value as HouseholdInput;
  if (!input || !Array.isArray(input.members) || !input.members.length || input.members.length > 20) throw new Error('members must list 1-20 members');
  const names = new Set<string>();
  for (const member of input.members) {
    if (!member || typeof member.name !== 'string' || !member.name.trim() || member.name.length > 60 || (member.role !== 'parent' && member.role !== 'kid') || names.has(member.name)) throw new Error('each member needs a unique name and a parent or kid role');
    names.add(member.name);
  }
  if (!input.members.some(member => member.role === 'parent' && !member.disabled)) throw new Error('a household needs an active parent');
  for (const chore of input.chores ?? []) {
    if (!chore || typeof chore.key !== 'string' || !names.has(chore.assignee) || typeof chore.title !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(chore.dueDate) || (chore.status && !statuses.has(chore.status))) throw new Error('each chore needs a key, a member assignee, a title and a date');
  }
  return input;
}

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'member';

export function startSeedServer(config: { dbPath: string }): Server {
  const db = new Database(config.dbPath, { fileMustExist: true });
  db.pragma('foreign_keys = ON');
  // The application server writes to the same file from another process. BEGIN IMMEDIATE takes the
  // write lock up front and waits for it; a deferred transaction that reads and then writes (as
  // Better Auth's sign-up does) gets SQLITE_BUSY at once when it cannot upgrade its lock.
  db.pragma('busy_timeout = 10000');

  async function seed(input: HouseholdInput): Promise<SeededHousehold> {
    const householdId = randomUUID();
    const tag = householdId.slice(0, 8);
    const name = input.name?.trim() || `Fresh household ${tag}`;
    const members: Record<string, SeededMember> = {};
    // Hash first (async), then write every row in one immediate transaction. The rows match what
    // Better Auth 1.7 writes for email sign-up on SQLite: a user, and a credential account whose
    // accountId is the user id, with ISO dates and 0/1 booleans. The app verifies the default hash.
    const accounts: { member: SeededMember; hash: string }[] = [];
    for (const member of input.members) {
      const email = `fresh-${slug(member.name)}-${randomUUID()}@example.test`;
      const password = `synthetic-fresh-${randomUUID()}`;
      const seeded = { id: randomUUID(), name: member.name, role: member.role, email, password, disabled: !!member.disabled };
      members[member.name] = seeded;
      accounts.push({ member: seeded, hash: await hashPassword(password) });
    }
    const chores: Record<string, string> = {};
    db.transaction(() => {
      const now = new Date().toISOString();
      for (const { member, hash } of accounts) {
        db.prepare('INSERT INTO "user" (id, name, email, emailVerified, image, createdAt, updatedAt) VALUES (?, ?, ?, 0, NULL, ?, ?)').run(member.id, member.name, member.email, now, now);
        db.prepare('INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES (?, ?, \'credential\', ?, ?, ?, ?)').run(randomUUID(), member.id, member.id, hash, now, now);
      }
      db.prepare('INSERT INTO household (id, name) VALUES (?, ?)').run(householdId, name);
      const activeParent = Object.values(members).find(member => member.role === 'parent' && !member.disabled)!;
      for (const member of Object.values(members)) {
        if (member.disabled) db.prepare('INSERT INTO membership (user_id, household_id, role, disabled_at, disabled_by) VALUES (?, ?, ?, ?, ?)').run(member.id, householdId, member.role, Date.now(), activeParent.id);
        else db.prepare('INSERT INTO membership (user_id, household_id, role) VALUES (?, ?, ?)').run(member.id, householdId, member.role);
      }
      for (const chore of input.chores ?? []) {
        const id = `fresh-chore-${randomUUID()}`;
        const status = chore.status ?? 'todo';
        const reward = chore.rewardCents ?? null;
        db.prepare('INSERT INTO chore (id, household_id, assignee_id, title, description, due_date, reward_cents, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(id, householdId, members[chore.assignee].id, chore.title, chore.description ?? null, chore.dueDate, reward, status, now, now);
        if (status === 'verified' && reward) db.prepare('INSERT INTO earning (id, chore_id, household_id, child_id, amount_cents, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), id, householdId, members[chore.assignee].id, reward, now);
        chores[chore.key] = id;
      }
    }).immediate();
    return { id: householdId, name, members, chores };
  }

  const server = createServer((request, response) => {
    const reply = (status: number, body: unknown) => { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(body)); };
    if (request.method !== 'POST' || request.url !== '/households') return reply(404, { error: 'Not found' });
    readJson(request).then(validate).then(seed).then(household => reply(201, household), (cause: unknown) => reply(400, { error: cause instanceof Error ? cause.message : 'Invalid request' }));
  });
  server.listen(SEED_PORT, '127.0.0.1');
  server.on('close', () => db.close());
  return server;
}
