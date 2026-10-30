import Database from 'better-sqlite3';
import { createAuth, migrate } from '../../src/lib/server/identity';

const db = new Database(':memory:');
const origin = 'http://localhost:3000';
try {
  await migrate(db);
  const auth = createAuth(db, { origin, secret: 'synthetic-rate-limit-secret-at-least-32-chars' });
  const statuses = [];
  for (let i = 1; i <= 4; i++) {
    const response = await auth.handler(new Request(`${origin}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json', 'x-forwarded-for': `192.0.2.${i}` },
      body: JSON.stringify({ email: 'synthetic@example.test', password: 'synthetic-password' })
    }));
    statuses.push(response.status);
  }
  process.stdout.write(JSON.stringify(statuses));
} finally { db.close(); }
