import { expect, it } from 'vitest';
import { runDatabaseWorkers } from './helpers/database-workers';

it('rejects when a worker exits successfully before reporting readiness', async () => {
  await expect(runDatabaseWorkers('-e', [['process.exit(0)']]))
    .rejects.toThrow('exited before readiness (code 0)');
});
