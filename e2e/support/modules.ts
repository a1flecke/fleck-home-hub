import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Browser tests run against a production build by default (`node build`), and against `vite dev`
 * only when E2E_SERVER=dev. The same test must be able to hold back one page's client module to
 * exercise pre-hydration behaviour in either mode.
 */
export const e2eServerMode: 'build' | 'dev' = process.env.E2E_SERVER === 'dev' ? 'dev' : 'build';

/**
 * The path segments of `route` under src/routes as a RegExp source. `lists/[id]` is literal
 * (SvelteKit's parameter folder); `*` is one path segment and `**` any number, including none.
 * With `encoded`, brackets may also arrive percent-encoded, as in a dev-server module URL.
 */
function routeSegments(route: string, encoded: boolean): string {
  let source = '';
  for (const segment of route.split('/')) {
    if (segment === '**') { source += '(?:/[^/]+)*'; continue; }
    let literal = segment.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]+');
    if (encoded) literal = literal.replace(/\\\[/g, '(?:\\[|%5B)').replace(/\\\]/g, '(?:\\]|%5D)');
    source += `/${literal}`;
  }
  return source;
}

/** Matches the source path of `route`'s `+page.svelte`, as SvelteKit's build output names it. */
export function routePattern(route: string): RegExp {
  return new RegExp(`(?:^|/)src/routes${routeSegments(route, false)}/\\+page\\.svelte$`);
}

/** Matches the URL vite dev serves `route`'s `+page.svelte` module from. */
export function devModulePattern(route: string): RegExp {
  return new RegExp(`/src/routes${routeSegments(route, true)}/\\+page\\.svelte(?:\\?.*)?$`, 'i');
}

let builtNodes: { source: string; file: string }[] | undefined;

/** Maps each built page node to the `+page.svelte` it wraps, from SvelteKit's build output. */
function nodesFromBuild(): { source: string; file: string }[] {
  if (builtNodes) return builtNodes;
  const generated = '.svelte-kit/generated/build/client-optimized/nodes';
  const manifest = JSON.parse(readFileSync('.svelte-kit/output/client/.vite/manifest.json', 'utf8')) as Record<string, { file: string }>;
  builtNodes = readdirSync(generated).flatMap(name => {
    const component = /from "([^"]*\+page\.svelte)"/.exec(readFileSync(join(generated, name), 'utf8'))?.[1];
    const entry = manifest[`${generated}/${name}`];
    return component && entry ? [{ source: component.replace(/^(\.\.\/)+/, ''), file: `/${entry.file}` }] : [];
  });
  return builtNodes;
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A Playwright URL pattern for the client module of the page at `route` (a path under src/routes,
 * such as `expenses`, `lists/[id]` or `lists/templates/**`). Holding its request back keeps that
 * page from hydrating. It is a RegExp so every Playwright URL API accepts it (route, unroute,
 * waitForRequest). Throws when no built page matches, so a renamed route cannot silently stop
 * gating anything.
 */
export function pageModule(route: string): RegExp {
  const pattern = routePattern(route);
  if (e2eServerMode === 'dev') return devModulePattern(route);
  const files = [...new Set(nodesFromBuild().filter(node => pattern.test(node.source)).map(node => node.file))];
  if (!files.length) throw new Error(`No built page module matches route "${route}"; run vite build or check the route path`);
  // Each test server runs its own build (scripts/e2e-prepare.mjs). The manifest describes the last
  // one; the others must serve the same client files, or gating would silently match nothing.
  for (const build of readdirSync('.e2e-build')) {
    for (const file of files) {
      if (!existsSync(join('.e2e-build', build, 'client', file))) throw new Error(`The ${build} e2e build has no ${file}; rebuild with scripts/e2e-prepare.mjs`);
    }
  }
  return new RegExp(`^https?://[^/]+(?:${files.map(escape).join('|')})(?:\\?.*)?$`);
}
