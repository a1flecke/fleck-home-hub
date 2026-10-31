/** Dependency boundaries for the modular monolith. */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: { path: '^src/' },
      to: { circular: true },
    },
    {
      name: 'domain-independent',
      severity: 'error',
      from: { path: '^src/lib/(chores|earnings)/' },
      to: { pathNot: '^src/lib/(chores|earnings)/' },
    },
    {
      name: 'server-no-presentation',
      severity: 'error',
      from: { path: '^src/lib/server/' },
      to: { path: '^src/routes/' },
    },
    {
      name: 'client-no-server',
      severity: 'error',
      from: { path: ['^src/.*\\.svelte$', '^src/routes/.*\\+(page|layout)\\.(ts|js)$', '^src/lib/'], pathNot: '^src/lib/server/' },
      to: { path: '^src/lib/server/', dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'unresolved-project-alias',
      severity: 'error',
      from: { path: '^src/' },
      to: { path: '^\\$lib(/|$)' },
    },
    {
      name: 'unresolved-local',
      severity: 'error',
      from: { path: '^src/' },
      to: { path: '^\\.', couldNotResolve: true },
    },
  ],
  options: { doNotFollow: { path: 'node_modules' }, tsConfig: { fileName: 'tsconfig.json' } },
};
