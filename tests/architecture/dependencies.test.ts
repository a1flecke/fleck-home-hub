import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const root = process.cwd();
const executable = resolve(root, 'node_modules/.bin/depcruise');
const config = resolve(root, '.dependency-cruiser.cjs');
let fixture = '';

afterEach(() => {
  if (fixture) rmSync(fixture, { recursive: true, force: true });
  fixture = '';
});

function check(files: Record<string, string>, alias = true) {
  fixture = mkdtempSync(join(tmpdir(), 'fleck-architecture-'));
  writeFileSync(join(fixture, 'tsconfig.json'), JSON.stringify({ compilerOptions: { baseUrl: '.', paths: alias ? { '$lib/*': ['src/lib/*'] } : {} } }));
  for (const [path, content] of Object.entries(files)) {
    const destination = join(fixture, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  }
  const result = spawnSync(executable, ['--config', config, '--output-type', 'err', 'src'], {
    cwd: fixture,
    encoding: 'utf8',
  });
  expect(result.error).toBeUndefined();
  expect(result.stderr).not.toContain('has an unsafe regular expression');
  expect(result.stderr).not.toContain('ERROR: rule');
  return result;
}

describe('architecture dependency rules', () => {
  it('enforces the dependency rules against the application', () => {
    const result = spawnSync(executable, ['--config', config, 'src'], { cwd: root, encoding: 'utf8' });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('allows a domain dependency between pure modules', () => {
    const result = check({
      'src/lib/chores/domain.ts': "import { value } from './other'; export const result = value;",
      'src/lib/chores/other.ts': 'export const value = 1;',
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('rejects domain dependencies on server infrastructure', () => {
    const result = check({
      'src/lib/chores/domain.ts': "import { value } from '../server/store'; export const result = value;",
      'src/lib/server/store.ts': 'export const value = 1;',
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('error domain-independent:');
  });

  it('rejects a domain module importing platform APIs', () => {
    const result = check({
      'src/lib/chores/domain.ts': "import { readFileSync } from 'node:fs'; export const read = readFileSync;",
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('error domain-independent:');
  });

  it('rejects a domain dependency through a shared infrastructure module', () => {
    const result = check({
      'src/lib/chores/domain.ts': "export { value } from '../shared';",
      'src/lib/shared.ts': "export { value } from './server/store';",
      'src/lib/server/store.ts': 'export const value = 1;',
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('error domain-independent:');
  });

  it('rejects server dependencies on presentation', () => {
    const result = check({
      'src/lib/server/store.ts': "export { value } from '../../routes/view';",
      'src/routes/view.ts': 'export const value = 1;',
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('error server-no-presentation:');
  });

  it('rejects cycles between application modules', () => {
    const result = check({
      'src/lib/chores/domain.ts': "import { value } from './other'; export const result = value;",
      'src/lib/chores/other.ts': "import { result } from './domain'; export const value = result;",
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('error no-circular:');
  });

  it('detects client runtime imports of server modules in Svelte components', () => {
    const result = check({
      'src/routes/Widget.svelte': "<script>import { secret } from '../lib/server/store';</script><p>{secret}</p>",
      'src/lib/server/store.ts': "export const secret = 'private';",
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('error client-no-server:');
  });

  it('detects unused server imports before Svelte preprocessing removes them', () => {
    const result = check({
      'src/routes/Widget.svelte': "<script>import { secret } from '../lib/server/store';</script><p>Hello</p>",
      'src/lib/server/store.ts': "export const secret = 'private';",
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('error client-no-server:');
  });

  it('rejects server imports through the SvelteKit $lib alias', () => {
    const result = check({
      'src/routes/Widget.svelte': "<script>import { secret } from '$lib/server/store';</script><p>{secret}</p>",
      'src/lib/server/store.ts': "export const secret = 'private';",
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('error client-no-server:');
  });

  it('rejects an unresolved project alias instead of silently missing its dependency', () => {
    const result = check({
      'src/routes/Widget.svelte': "<script>import { secret } from '$lib/server/store';</script><p>{secret}</p>",
      'src/lib/server/store.ts': "export const secret = 'private';",
    }, false);
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('error unresolved-project-alias:');
  });

  it('rejects unresolved relative application imports', () => {
    const result = check({
      'src/lib/chores/domain.ts': "export { value } from './missing';",
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('error unresolved-local:');
  });

  it('rejects server imports from a universal route', () => {
    const result = check({
      'src/routes/+page.ts': "export { secret } from '../lib/server/store';",
      'src/lib/server/store.ts': "export const secret = 'private';",
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('error client-no-server:');
  });

  it('rejects server imports through shared client-capable modules', () => {
    const result = check({
      'src/lib/shared.ts': "export { secret } from './server/store';",
      'src/lib/server/store.ts': "export const secret = 'private';",
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('error client-no-server:');
  });
});
