# eMeals recipe-link drafts and source attribution — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or
> superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Let a parent paste or share a recipe link, review a private editable meal
draft, choose a date, save idempotently, optionally share it, and preserve accurate
source credit without fetching provider content.

**Architecture:** A pure provider registry and link parser feed a shared attribution
component used by Meals, Today and the display. The draft action validates a URL and
returns an unchanged, editable form; persistence stays in `createMeal`, with a
nullable submission key for retry safety. A minimal non-caching service worker lets
supported browsers POST a Web Share Target into a review route.

**Tech stack:** SvelteKit 3, Svelte 5, TypeScript, Better Auth, SQLite/Drizzle,
Vitest, Playwright, mise.

---

## File map

- Create `src/lib/meals/recipe-sources.ts` — vendor registry and exact host names.
- Modify `src/lib/meals/recipe-link.ts` — parse, title suggestion, attribution.
- Create `src/lib/meals/RecipeCredit.svelte` — shared credit/link presentation.
- Modify `src/lib/server/meals.ts` — submission key and idempotent create.
- Create `drizzle/0008_meal_submission.sql`; update `drizzle/meta/_journal.json`.
- Modify `src/routes/meals/+page.server.ts` and `+page.svelte` — draft action, form
  and card attribution.
- Modify `src/routes/meals/MealForm.svelte` — submission key, action override,
  family-entered ingredient note.
- Modify `src/routes/dashboard/+page.svelte` and `src/routes/display/+page.svelte` —
  shared credit and ingredient label.
- Create `src/routes/meals/share/+page.server.ts`, `+page.svelte` — share-target
  review flow.
- Create `static/service-worker.js`; modify `src/routes/+layout.svelte`,
  `static/manifest.webmanifest`.
- Tests: `tests/recipe-link.test.ts`, `tests/meals.integration.test.ts`,
  `tests/display.integration.test.ts`, `tests/pwa-assets.test.ts`,
  `e2e/meals.spec.ts`, `e2e/pwa.spec.ts`.
- Docs: `docs/meals.md`, `docs/display.md`, `docs/architecture.md`, `docs/pwa.md`.
- Screenshots: `docs/screenshots/emeals-link-mobile.png`,
  `docs/screenshots/emeals-display.png`.

## Task 1: Provider registry and link parsing

- [ ] Write failing tests in `tests/recipe-link.test.ts` for:
  approved eMeals links, `www`, lookalike/suffix hosts, non-HTTPS, credentials,
  root/malformed/oversize, opaque paths, query+fragment preservation, unrelated
  providers, missing links, typed `eMeals` with an unrelated URL, HTML-special
  title text, and first-HTTPS-link extraction from shared text.
- [ ] Run `./scripts/dev.sh test tests/recipe-link.test.ts`; confirm failures.
- [ ] Add `recipe-sources.ts` with the emeals descriptor and exact-host lookup.
- [ ] Implement `parseRecipeLink`, `recipeAttribution`, `firstHttpsRecipeLink` and
  title cleanup in `recipe-link.ts`.
- [ ] Rerun the focused test until green.

## Task 2: Shared attribution components and existing surfaces

- [ ] Add `RecipeCredit.svelte`; use `recipeAttribution` for credit and link text.
- [ ] Replace `recipeLinkLabel` use in Meals, dashboard and display. Show
  `Family-entered ingredients` when a verified provider is recognized.
- [ ] Preserve existing unrelated-link behavior as neutral `View recipe`.
- [ ] Run `mise run typecheck` and the existing meals/display tests.
- [ ] Update existing browser expectations that assumed a typed source controlled
  the destination label.

## Task 3: Idempotent save

- [ ] Extend `tests/meals.integration.test.ts` first: duplicate key returns one id
  and one row; same link two dates with different keys creates two rows; migration
  from 0006 preserves a meal and adds the column/index.
- [ ] Confirm the new assertions fail.
- [ ] Add `0008_meal_submission.sql` with the nullable column and partial unique
  index; append the journal entry.
- [ ] Extend `MealInput`, validation, `createMeal` and the insert inside an immediate
  transaction. Keep `updateMeal` unchanged.
- [ ] Rerun `./scripts/dev.sh test tests/meals.integration.test.ts`.

## Task 4: Paste draft workflow

- [ ] Add a parent-only `draft` action to `src/routes/meals/+page.server.ts`:
  origin check, `parseRecipeLink`, preserve URL, return `recipeDraft` or a failing
  `recipeLinkError`, fresh submission key.
- [ ] Return a fresh `submissionKey` from `load` for the normal add form.
- [ ] Extend `MealForm.svelte` with `submissionKey`, optional `action`, hidden mode,
  and the family-entered ingredient note. Keep hydration-safe defaults.
- [ ] Render **Add meal from recipe link** with a URL form and a review state.
  Preserve URL on error; keep the draft open on save error via `mode`.
- [ ] Pass `submissionKey` through save and validation errors.
- [ ] Add focused browser coverage for paste → suggestion → date → save, invalid
  link preservation and invalid save preservation.

## Task 5: Web Share Target

- [ ] Add manifest `share_target` POST to `/meals/share`.
- [ ] Add the minimal service worker and registration; no cache API.
- [ ] Add `/meals/share` POST action: authenticated parent, extract link, use
  shared title when readable, render review draft, no writes, reject explicit
  foreign Origin. GET redirects to `/meals`.
- [ ] Add `/meals/share` page reusing `MealForm` and `RecipeCredit`; provide a paste
  fallback for failed shares.
- [ ] Update `tests/pwa-assets.test.ts` to assert share-target metadata, a
  non-caching worker and no offline claim.
- [ ] Add browser coverage that submits a synthetic share POST and saves the draft;
  verify anonymous/child rejection at the server boundary.

## Task 6: End-to-end meal and display journey

- [ ] Add a Playwright journey with a synthetic eMeals URL:
  paste, edit suggested title, choose date, enter ingredients/private notes, save
  unshared, verify credit/link, rename and verify credit remains.
- [ ] Share explicitly; verify display shows approved fields and credit/link but no
  notes.
- [ ] Unshare; verify display no longer contains the meal or URL.
- [ ] Assert no outbound request to the recipe host.
- [ ] Add delayed-hydration coverage for the paste form and the share draft form.
- [ ] Run `mise run e2e -- e2e/meals.spec.ts e2e/pwa.spec.ts`.

## Task 7: Documentation, verification and delivery

- [ ] Update `docs/meals.md` with paste/share, recognition, iOS fallback, ingredient
  distinction, privacy/sharing, disabled retrieval, idempotency and migration.
- [ ] Update `docs/display.md`, `docs/architecture.md`, `docs/pwa.md` for credit,
  provider registry and the non-caching share-target worker.
- [ ] Generate mobile and display screenshots from synthetic data.
- [ ] Run `mise run lint`, `mise run typecheck`, focused tests, then
  `mise run verify`.
- [ ] Review the full diff for secrets, private data and unrelated changes.
- [ ] Commit, push the feature branch, open one PR titled
  **“Add eMeals recipe-link drafts and source attribution”**.
- [ ] Comment a concise implementation update on issue #30, distinguishing shipped
  link handling from unapproved automated import. Do not merge or self-approve.
