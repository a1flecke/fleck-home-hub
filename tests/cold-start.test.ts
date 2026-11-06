import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Reuse installed dependencies, but give the fixture its own node_modules so
// sync cannot accidentally find or change the developer checkout's $app files.
it.each(['test', 'e2e'])('%s starts without generated SvelteKit configuration', (task) => {
  const root = mkdtempSync(join(tmpdir(), 'fleck-cold-start-'));
  try {
    mkdirSync(join(root, 'node_modules'));
    for (const name of readdirSync('node_modules')) {
      if (name === '$app' || name.startsWith('.') && name !== '.bin') continue;
      symlinkSync(resolve('node_modules', name), join(root, 'node_modules', name));
    }
    for (const name of ['package.json', 'tsconfig.json', 'vite.config.ts', 'vitest.config.ts']) copyFileSync(name, join(root, name));
    mkdirSync(join(root, 'src/routes'), { recursive: true });
    copyFileSync('src/app.html', join(root, 'src/app.html'));
    writeFileSync(join(root, 'src/routes/+page.svelte'), '<h1>Synthetic fixture</h1>');
    mkdirSync(join(root, 'tests'));
    mkdirSync(join(root, 'e2e'));
    writeFileSync(join(root, 'tests/synthetic.test.ts'), "import { expect, it } from 'vitest'; it('loads TypeScript', () => expect(true).toBe(true));");
    writeFileSync(join(root, 'playwright.config.ts'), "import { defineConfig } from '@playwright/test'; export default defineConfig({ testDir: './e2e' });");
    writeFileSync(join(root, 'e2e/synthetic.spec.ts'), "import { test } from '@playwright/test'; test('discovery only', () => {});");
    expect(existsSync(join(root, 'node_modules/$app'))).toBe(false);
    const result = spawnSync('pnpm', ['run', task, ...(task === 'e2e' ? ['--list'] : [])], { cwd: root, encoding: 'utf8', timeout: 20000 });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(join(root, 'node_modules/$app/tsconfig.json'))).toBe(true);
    expect(result.stdout).toContain(task === 'test' ? '1 passed' : 'Total: 1 test');
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 25000);
