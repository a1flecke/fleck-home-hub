import { bootstrap } from '../src/lib/server/bootstrap';
import { readIdentityConfig } from '../src/lib/server/config';

try {
  let raw = '';
  for await (const chunk of process.stdin) {
    raw += chunk.toString();
    if (raw.length > 16_384) throw new Error('Input too large');
  }
  const data: unknown = JSON.parse(raw);
  if (!data || typeof data !== 'object') throw new Error('Invalid input');
  const input = data as Record<string, unknown>;
  if (typeof input.name !== 'string' || typeof input.email !== 'string' || typeof input.password !== 'string' || typeof input.household !== 'string') throw new Error('Invalid input');
  const householdId = await bootstrap(readIdentityConfig(process.env), { name: input.name, email: input.email, password: input.password, household: input.household });
  console.log(`Initial parent and household created. Household ID: ${householdId}`);
} catch {
  console.error('Bootstrap failed. Check configuration and input; an existing database is never overwritten. If initialization failed after creating a new file, inspect it before retrying.');
  process.exitCode = 1;
}
