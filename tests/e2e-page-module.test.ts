import { describe, expect, it } from 'vitest';
import { devModulePattern, routePattern } from '../e2e/support/modules';

describe('browser-test page module patterns', () => {
  const matches = (route: string, path: string) => routePattern(route).test(path);

  it('matches one route exactly, in source and dev-server paths', () => {
    expect(matches('expenses', 'src/routes/expenses/+page.svelte')).toBe(true);
    expect(matches('expenses', '/home/x/src/routes/expenses/+page.svelte')).toBe(true);
    expect(matches('expenses', 'src/routes/expenses/plan/+page.svelte')).toBe(false);
    expect(matches('expenses', 'src/routes/old-expenses/+page.svelte')).toBe(false);
    expect(matches('meals', 'src/routes/meals/shop/+page.svelte')).toBe(false);
  });

  it('treats SvelteKit parameter folders literally', () => {
    expect(matches('lists/[id]', 'src/routes/lists/[id]/+page.svelte')).toBe(true);
    expect(matches('lists/[id]', 'src/routes/lists/i/+page.svelte')).toBe(false);
    expect(matches('lists/[id]', 'src/routes/lists/[id]/event/+page.svelte')).toBe(false);
  });

  it('matches one segment for * and any number for **', () => {
    expect(matches('earnings/*', 'src/routes/earnings/[childId]/+page.svelte')).toBe(true);
    expect(matches('earnings/*', 'src/routes/earnings/+page.svelte')).toBe(false);
    expect(matches('earnings/*', 'src/routes/earnings/a/b/+page.svelte')).toBe(false);
    expect(matches('lists/*/event', 'src/routes/lists/[id]/event/+page.svelte')).toBe(true);
    expect(matches('lists/templates/**', 'src/routes/lists/templates/+page.svelte')).toBe(true);
    expect(matches('lists/templates/**', 'src/routes/lists/templates/[id]/+page.svelte')).toBe(true);
    expect(matches('lists/templates/**', 'src/routes/lists/copy/[source]/[id]/+page.svelte')).toBe(false);
  });

  it('matches the dev-server module URL, including percent-encoded parameter folders', () => {
    const dev = (route: string, url: string) => devModulePattern(route).test(url);
    expect(dev('expenses', 'http://127.0.0.1:4173/src/routes/expenses/+page.svelte')).toBe(true);
    expect(dev('expenses', 'http://127.0.0.1:4173/src/routes/expenses/+page.svelte?t=1700000000')).toBe(true);
    expect(dev('expenses', 'http://127.0.0.1:4173/src/routes/expenses/+page.svelte.css')).toBe(false);
    expect(dev('lists/[id]', 'http://127.0.0.1:4173/src/routes/lists/%5Bid%5D/+page.svelte')).toBe(true);
    expect(dev('lists/[id]', 'http://127.0.0.1:4173/src/routes/lists/[id]/+page.svelte')).toBe(true);
    expect(dev('lists/[id]', 'http://127.0.0.1:4173/src/routes/lists/abc/+page.svelte')).toBe(false);
    expect(dev('lists/*/event', 'http://127.0.0.1:4173/src/routes/lists/%5Bid%5D/event/+page.svelte')).toBe(true);
  });
});
