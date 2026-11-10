import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const root = process.cwd();
const executable = resolve(root, 'node_modules/.bin/depcruise');
const config = resolve(root, '.dependency-cruiser.cjs');
// The full scan has taken over 8 seconds alongside the normal test suite.
const cruiseTimeout = 15_000;
let fixture = '';

afterEach(() => {
  if (fixture) rmSync(fixture, { recursive: true, force: true });
  fixture = '';
});

function runCommand(file: string, args: string[], cwd: string, timeout: number) {
  return new Promise<{ status: number; stdout: string; stderr: string }>((resolve, reject) => {
    execFile(file, args, { cwd, encoding: 'utf8', timeout, killSignal: 'SIGKILL' }, (error, stdout, stderr) => {
      const status = error ? error.code : 0;
      if (typeof status === 'number') {
        resolve({ status, stdout, stderr });
      } else if (error?.killed && status == null) {
        reject(new Error(`${file} exceeded its ${timeout} ms deadline`, { cause: error }));
      } else {
        reject(error);
      }
    });
  });
}

async function check(files: Record<string, string>, alias = true) {
  fixture = mkdtempSync(join(tmpdir(), 'fleck-architecture-'));
  writeFileSync(join(fixture, 'tsconfig.json'), JSON.stringify({ compilerOptions: { baseUrl: '.', paths: alias ? { '$lib/*': ['src/lib/*'] } : {} } }));
  for (const [path, content] of Object.entries(files)) {
    const destination = join(fixture, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  }
  const result = await runCommand(executable, ['--config', config, '--output-type', 'err', 'src'], fixture, cruiseTimeout);
  expect(result.stderr).not.toContain('has an unsafe regular expression');
  expect(result.stderr).not.toContain('ERROR: rule');
  return result;
}

describe('architecture dependency rules', { timeout: 20_000 }, () => {
  it('reports a subprocess deadline before the runner times out', async () => {
    await expect(runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 1000)'], root, 100))
      .rejects.toThrow('exceeded its 100 ms deadline');
  });

  it('enforces the dependency rules against the application', async () => {
    const result = await runCommand(executable, ['--config', config, 'src'], root, cruiseTimeout);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('allows a domain dependency between pure modules', async () => {
    const result = await check({
      'src/lib/chores/domain.ts': "import { value } from './other'; export const result = value;",
      'src/lib/chores/other.ts': 'export const value = 1;',
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('rejects domain dependencies on server infrastructure', async () => {
    const result = await check({
      'src/lib/chores/domain.ts': "import { value } from '../server/store'; export const result = value;",
      'src/lib/server/store.ts': 'export const value = 1;',
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('error domain-independent:');
  });

  it('rejects grocery domain dependencies on server infrastructure', async () => {
    const result = await check({
      'src/lib/grocery/domain.ts': "import { value } from '../server/store'; export const result = value;",
      'src/lib/server/store.ts': 'export const value = 1;',
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('error domain-independent:');
  });

  it('rejects a domain module importing platform APIs', async () => {
    const result = await check({
      'src/lib/chores/domain.ts': "import { readFileSync } from 'node:fs'; export const read = readFileSync;",
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('error domain-independent:');
  });

  it('rejects a domain dependency through a shared infrastructure module', async () => {
    const result = await check({
      'src/lib/chores/domain.ts': "export { value } from '../shared';",
      'src/lib/shared.ts': "export { value } from './server/store';",
      'src/lib/server/store.ts': 'export const value = 1;',
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('error domain-independent:');
  });

  it('rejects server dependencies on presentation', async () => {
    const result = await check({
      'src/lib/server/store.ts': "export { value } from '../../routes/view';",
      'src/routes/view.ts': 'export const value = 1;',
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('error server-no-presentation:');
  });

  it('rejects cycles between application modules', async () => {
    const result = await check({
      'src/lib/chores/domain.ts': "import { value } from './other'; export const result = value;",
      'src/lib/chores/other.ts': "import { result } from './domain'; export const value = result;",
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('error no-circular:');
  });

  it('detects client runtime imports of server modules in Svelte components', async () => {
    const result = await check({
      'src/routes/Widget.svelte': "<script>import { secret } from '../lib/server/store';</script><p>{secret}</p>",
      'src/lib/server/store.ts': "export const secret = 'private';",
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('error client-no-server:');
  });

  it('detects unused server imports before Svelte preprocessing removes them', async () => {
    const result = await check({
      'src/routes/Widget.svelte': "<script>import { secret } from '../lib/server/store';</script><p>Hello</p>",
      'src/lib/server/store.ts': "export const secret = 'private';",
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('error client-no-server:');
  });

  it('rejects server imports through the SvelteKit $lib alias', async () => {
    const result = await check({
      'src/routes/Widget.svelte': "<script>import { secret } from '$lib/server/store';</script><p>{secret}</p>",
      'src/lib/server/store.ts': "export const secret = 'private';",
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('error client-no-server:');
  });

  it('rejects an unresolved project alias instead of silently missing its dependency', async () => {
    const result = await check({
      'src/routes/Widget.svelte': "<script>import { secret } from '$lib/server/store';</script><p>{secret}</p>",
      'src/lib/server/store.ts': "export const secret = 'private';",
    }, false);
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('error unresolved-project-alias:');
  });

  it('rejects unresolved relative application imports', async () => {
    const result = await check({
      'src/lib/chores/domain.ts': "export { value } from './missing';",
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('error unresolved-local:');
  });

  it('rejects server imports from a universal route', async () => {
    const result = await check({
      'src/routes/+page.ts': "export { secret } from '../lib/server/store';",
      'src/lib/server/store.ts': "export const secret = 'private';",
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('error client-no-server:');
  });

  it('rejects server imports through shared client-capable modules', async () => {
    const result = await check({
      'src/lib/shared.ts': "export { secret } from './server/store';",
      'src/lib/server/store.ts': "export const secret = 'private';",
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('error client-no-server:');
  });
});
