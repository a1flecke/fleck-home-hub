import { addKid } from '../src/lib/server/bootstrap';
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
  if (typeof input.name !== 'string' || typeof input.email !== 'string' || typeof input.password !== 'string' || typeof input.householdId !== 'string') throw new Error('Invalid input');
  await addKid(readIdentityConfig(process.env), input.householdId, { name: input.name, email: input.email, password: input.password });
  console.log('Child account created.');
} catch {
  console.error('Account creation failed; check the input and existing database.');
  process.exitCode = 1;
}
