# Testing and frontend practice

Use this guidance with `AGENTS.md` when planning and reviewing changes. It applies to all project agents; it is guidance for engineering judgment, not an independently enforced security boundary.

## Choose tests for the risk

- Start with a small, observable behavior and write a test before implementation. Run it and check that it fails for the expected reason; implement, rerun, then refactor. If a test already passes, establish what it proves before adding it. Report exceptions and evidence honestly.
- Put the majority of cases in fast unit tests for pure rules: valid and invalid transitions, money and date calculations, input validation, and relevant edge dates. Assert outcomes and invariants rather than private calls, implementation details, or mocks reproducing the algorithm.
- Use integration tests where real boundaries matter: SvelteKit request and action semantics, real sessions and roles, household isolation, SQLite constraints, transactions, migration and backup recovery. Use valid synthetic requests and verify both rejection and absence of a side effect. Test concurrent financial operations on independent connections or processes where the invariant requires it.
- Use a small number of browser tests for essential journeys, accessibility and behaviors that depend on real rendering: native and enhanced form recovery, hydration, focus, visible state changes, and network failure/recovery when applicable. Reuse a journey for related assertions instead of duplicating every unit case end to end. Use isolated synthetic records, deterministic synchronization and controlled time; investigate flakes, never mask them with sleeps or retries.
- For each changed workflow consider the normal path, plausible user errors, authorization, conflicting or repeated operations, and recovery. Add the lowest-level test that can prove the risk; omit hypothetical or duplicate tests without a clear failure they would catch. Keep a short record of meaningful coverage gaps and run the relevant neighboring workflows as well as the new test.

## Frontend boundaries

- Use semantic HTML, labels, keyboard-operable controls, visible focus, status text and accessible errors; do not rely on color alone. Check narrow screens and reduced motion where relevant. Keep editable data and the active form available after a rejected submission. Prefer native forms and links with progressive enhancement, and test pre-hydration interaction when changing server-rendered controls.
- In SvelteKit, keep authorization and validation on the server, use server-only modules for private data, and avoid shared mutable server state across requests. Use the pinned SvelteKit/Svelte versions and working local patterns; verify action result types, errors and redirects at the actual request boundary. Read the official [form actions](https://svelte.dev/docs/kit/form-actions) and [state management](https://svelte.dev/docs/kit/state-management) guidance when relevant.
- For asynchronous UI, define the lifecycle: loading, failure, recovery, cancellation, stale responses, teardown and what happens if the user changes context. Test the relevant boundaries using controlled requests or clocks. Do not interrupt reading or keyboard focus with automatic full-page refreshes.
- With Vite, treat client-exposed environment variables and built assets as public; do not place secrets in them. Check the configured prefix and [Vite environment guidance](https://vite.dev/guide/env-and-mode) before changing configuration.
- Vue is not used by this project. If a future approved change introduces Vue, apply the same server trust and accessibility principles, never compile untrusted templates or render untrusted HTML, and consult Vue's [security](https://vuejs.org/guide/best-practices/security.html) and [accessibility](https://vuejs.org/guide/best-practices/accessibility.html) guidance for the installed version. Do not add Vue tooling merely to satisfy this paragraph.

## Browser tests and client-side navigation

Playwright auto-waits for browser navigations, not for SvelteKit's client router. After a link click or a GET-form submission the app keeps the outgoing page on screen while the destination's data loads, so `click()` returns before the new page exists. On a same-route navigation (search, filter, pagination, date or view change) the same inputs and buttons are on both pages, and a following action can silently target the outgoing DOM. When the navigation lands, SvelteKit (3.1.1, default `data-sveltekit-reset`) blurs the focused element before updating the DOM, and resets focus afterwards, which can drop a `fill()` in progress. The order is: URL update, blur and DOM update, focus reset, then `afterNavigate`. A URL assertion can therefore pass before the DOM has changed.

The root layout exposes the state as `html[data-navigation]`: `loading` from `beforeNavigate`, which runs before `click()` returns, and `idle` from `afterNavigate`. The attribute is absent before hydration and without JavaScript. `settle(page)` in `e2e/support/navigation.ts` waits until it is not `loading`; call it after every navigating click. `e2e/navigation-settle.spec.ts` proves the marker semantics, and `tests/architecture/e2e-navigation-settle.test.ts` flags navigating clicks, meaning links and the submit buttons of GET forms in `src/routes`, that are not followed by `settle(...)`, a `goto(...)` or the end of the test.

A test that intends to act during a navigation, such as one that holds a response to inspect the in-flight state, marks the click with `// no-settle: <reason>`.

This was found from main CI run 45930899060. In that run `chore-reuse.spec.ts` typed into the search box while the "Clear search" navigation landed. The text was dropped, Search re-submitted the previous query, and the click target never appeared. The run reported a test timeout at the following click, 28 seconds after the real fault. Read the trace (action timeline, DOM snapshots with live input values, and network) before attributing a failure; `playwright.config.ts` sets a 10 s `actionTimeout` so that a stuck action fails as itself.

## Repeatable browser tests

A browser test should pass when it runs twice in the same server. Shared seeded households in `scripts/e2e-server.ts` break that in three ways, all measured with a whole-suite `--repeat-each=2` run (70 of 470 test runs failed across 21 spec files):

- A reused record name matches two records on the second run.
- An exact assertion over shared data, such as a balance or a session count, accumulates.
- A one-time action on a shared account, such as disabling a member or redeeming an invitation, cannot happen twice.

`freshHousehold()` in `e2e/support/households.ts` asks the browser-test seeding service (`scripts/e2e-seed-server.ts`, on `127.0.0.1:4175`) for a new household with its own members, optionally disabled, and its own chores, optionally verified with their earning. It returns generated emails, passwords and chore ids. `signInAs()` signs a context in through the real sign-in API and checks the response. Member names only need to be unique within a household, so assertions can keep readable names and exact totals.

The service runs in the e2e server process and writes the same SQLite file as the app, which runs in another process. It hashes passwords with Better Auth's default hasher, then writes the user and credential rows, the household, memberships, chores and earnings in one `BEGIN IMMEDIATE` transaction. Calling Better Auth's sign-up from the second process failed with `database is locked`: its deferred transaction reads, then writes, and SQLite returns `SQLITE_BUSY` immediately, without waiting for the busy timeout, when a read transaction cannot upgrade to a write lock. An immediate transaction takes the write lock up front and waits for it.

Mark a spec built this way `// e2e-isolation: fresh-households`. `mise run e2e-repeat` runs the marked specs twice, and CI runs it after the full suite. `tests/architecture/e2e-isolation.test.ts` rejects shared seeded accounts in marked specs, rejects new unmarked specs, and requires migrated specs to leave `LEGACY_SHARED_SPECS`, so the shared-household suite can only shrink.

## Browser tests run the production build

`mise run e2e` and `mise run e2e-repeat` build the application with `scripts/e2e-prepare.mjs`, then start each test server with `node` on that build (`scripts/e2e-app-command.ts`), as the household's install does. `E2E_SERVER=dev` runs `vite dev` instead, for debugging with source modules; a passing dev run says nothing about the production build.

- **One build per test server.** `AUTH_ORIGIN` is a build-time input: it sets SvelteKit's `paths.origin`, and Better Auth serves `/api/auth` only for that origin. A build made without it answers every `/api/auth` request with 404. So the main server (`127.0.0.1:4173`) and the onboarding server (`127.0.0.1:4174`) each get their own build in `.e2e-build/`, through an optional `E2E_BUILD_OUT`. The deployable `build/` is never touched.
- **`NODE_ENV=test`** keeps Better Auth's sign-in limiter off for the suite, as under `vite dev`. `mise run sign-in-limit-test` still proves the limiter with the real launcher.
- **Gating hydration.** A production build serves hashed bundles, not `src/routes/.../+page.svelte`. `pageModule(route)` returns a pattern for a page's client module in either mode: the hashed node chunk from the build manifest, or the dev source URL, with parameter folders such as `lists/[id]` matched even when percent-encoded. It throws when no page matches, or when the two builds would serve different client files. An architecture test rejects hard-coded `src/routes` module URLs, which silently gate nothing in a build and leave the test waiting for a request that never comes.

Differences found when the suite first ran against a build, which tests must allow for:

- SvelteKit's CSRF check rejects cross-site and origin-less form POSTs with a plain-text 403 before any action runs; `vite dev` let them reach the action. Assert the status and that nothing changed, not the action's own response body. Same-origin requests, such as a share from the installed app, send their origin.
- With `paths.origin`, the build renders `<link>` asset URLs absolute (`http://127.0.0.1:4173/icon.svg`); `vite dev` renders them relative. Assert that they resolve to this origin's path.

## Migration upgrade fixtures

Construct historical journals as a contiguous prefix before a named migration, rather than filtering out known later entries. The pinned Drizzle migrator uses migration timestamps, so admitting a future entry can hide missing migrations. Assert the target schema is absent before the upgrade and test that appending a synthetic future entry leaves the baseline unchanged. Check existing data and migration history after upgrading. A fixture reconstructed from current SQL does not establish compatibility with every previously released schema.
