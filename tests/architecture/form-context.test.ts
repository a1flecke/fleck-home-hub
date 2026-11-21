import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, it } from 'vitest';

// A form whose action is a bare named action ("?/save") posts to a URL with no query string, so the
// server forgets the page, filter, date or household the parent was looking at. That has shipped
// several times: history lost its child filter, recurring schedules lost their page, and display
// management fell back to a different household. When a route reads query context, each of its
// forms must carry that context, or be listed here with the reason the default is correct.
// Limitation: this only detects bare actions. An action that carries some of the query but not all
// of it (history once kept scope and page but dropped child) still needs review and a browser test.

/** Query parameters that are one-shot results of a previous action, not context to preserve. */
const oneShot = new Set(['notice', 'welcome', 'added', 'skipped', 'success']);

/** Bare actions that deliberately drop the route's query context. */
const allowed = new Map([
  ['src/routes/chores/series ?/series', 'creating a schedule: new schedules sort first, so page 1 is where it appears']
]);

type Route = { dir: string; server: string; views: string[] };

export function contextParams(server: string): string[] {
  return [...new Set([...server.matchAll(/searchParams\.(?:get|has|getAll)\(\s*['"]([\w-]+)['"]/g)].map(match => match[1]))].filter(name => !oneShot.has(name)).sort();
}

export function bareActions(view: string): string[] {
  return [...new Set([...view.matchAll(/\baction=(?:"(\?\/[\w]+)"|\{['"`](\?\/[\w]+)['"`]\})/g)].map(match => match[1] ?? match[2]))].sort();
}

export function contextLoss(routes: Route[], exceptions: Map<string, string>): string[] {
  return routes.flatMap(route => {
    const params = contextParams(route.server);
    if (!params.length) return [];
    return route.views.flatMap(bareActions)
      .filter(action => !exceptions.has(`${route.dir} ${action}`))
      .map(action => `${route.dir}: ${action} drops ${params.join(', ')}`);
  }).sort();
}

function routes(dir: string): Route[] {
  const names = readdirSync(dir);
  const nested = names.filter(name => statSync(join(dir, name)).isDirectory()).flatMap(name => routes(join(dir, name)));
  if (!names.includes('+page.server.ts')) return nested;
  const views = names.filter(name => name.endsWith('.svelte')).map(name => readFileSync(join(dir, name), 'utf8'));
  return [{ dir: relative(process.cwd(), dir), server: readFileSync(join(dir, '+page.server.ts'), 'utf8'), views }, ...nested];
}

it('forms on routes with query context carry that context to their actions', () => {
  expect(contextLoss(routes('src/routes'), allowed)).toEqual([]);
});

it('every allowed bare action still exists, so stale exceptions cannot hide new ones', () => {
  const present = new Set(routes('src/routes').flatMap(route => route.views.flatMap(bareActions).map(action => `${route.dir} ${action}`)));
  expect([...allowed.keys()].filter(key => !present.has(key))).toEqual([]);
});

it('detects a bare action on a filtered page and accepts one that carries the filter', () => {
  const server = "const child = url.searchParams.get('child'); const notice = url.searchParams.get('notice');";
  const losing = { dir: 'fixture/losing', server, views: ['<form method="POST" action="?/review"></form>', "<form action={'?/remove'}></form>"] };
  const keeping = { dir: 'fixture/keeping', server, views: ['<form method="POST" action={`?/review&child=${child}`}></form>'] };
  const noContext = { dir: 'fixture/plain', server: "const notice = url.searchParams.get('notice');", views: ['<form action="?/save"></form>'] };
  expect(contextLoss([losing, keeping, noContext], new Map())).toEqual(['fixture/losing: ?/remove drops child', 'fixture/losing: ?/review drops child']);
  expect(contextLoss([losing], new Map([['fixture/losing ?/review', 'fixture'], ['fixture/losing ?/remove', 'fixture']]))).toEqual([]);
});
