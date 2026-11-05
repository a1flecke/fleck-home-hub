# eMeals on-demand recipe preview — implementation plan

> **For agentic workers:** use `executing-plans` or `subagent-driven-development`.
> Track steps with checkboxes.

**Goal:** A parent can explicitly preview one shared eMeals link, see yield/time and
named ingredient groups, save them privately, and add provider lines to groceries.
Link-only fallback remains.

**Architecture:** A pure details module normalizes stored JSON; a server-only preview
module fetches one approved-host URL and extracts a small JSON-LD subset; the existing
meal draft/save action gains a preview intent; one shared Svelte component renders
details on all meal surfaces; the grocery service validates selections against both
family and provider lines.

**Tech stack:** SvelteKit 3, Svelte 5, TypeScript, SQLite/Drizzle, Vitest, Playwright.

---

## Task 1: Pure recipe details

- [ ] Add `tests/recipe-details.test.ts` covering normalization, limits, quantities,
      control characters, malformed JSON, source mismatch and flattened lines.
- [ ] Run it and confirm the missing module failure.
- [ ] Add `src/lib/meals/recipe-details.ts` with `RecipeDetails`,
      `RecipeIngredientGroup`, `normalizeRecipeDetails`, `parseRecipeDetailsJson`,
      `serializeRecipeDetails`, `recipeDetailsForMeal` and `providerIngredientLines`.
- [ ] Rerun until green.

## Task 2: JSON-LD preview service

- [ ] Add `tests/recipe-metadata.test.ts` with synthetic fetch/HTML fixtures:
      one two-recipe `@graph`, durations, ignored instructions/images, non-eMeals
      no-fetch, HTTP/content-type failure, off-host redirect rejection.
- [ ] Confirm failures.
- [ ] Add `src/lib/server/recipe-preview.ts` with allowlisted manual-redirect fetch,
      timeout, size limit and JSON-LD extraction.
- [ ] Rerun until green.

## Task 3: Persist and project details

- [ ] Extend `tests/meals.integration.test.ts`: save details, list/display projection,
      unshare removal, stale-source clearing, migration from 0008 preserves meals.
- [ ] Confirm failures.
- [ ] Add `drizzle/0010_meal_recipe_details.sql` and journal entry.
- [ ] Add `recipeDetails` to `MealInput`/`Meal`, validate source match, insert/update,
      parse on list; add to dashboard and display projections.
- [ ] Rerun integration tests.

## Task 4: Provider grocery lines

- [ ] Extend `tests/grocery.integration.test.ts` to select a provider line, reject a
      forged line, and preserve duplicate review/dedup behavior.
- [ ] Confirm failures.
- [ ] Update `addMealIngredients` to read stored details and validate against family
      plus provider lines; dedupe selections.
- [ ] Rerun.

## Task 5: Draft preview action and components

- [ ] Add `RecipeDetails.svelte`.
- [ ] Extend `MealForm` with optional `preview`, `recipeDetails`, `suggestedTitle`,
      hidden JSON, preview submit button (`intent=preview`, `formnovalidate`) and
      save intent.
- [ ] Add the preview branch to `/meals?/save`: validate parent/origin/link, fetch,
      preserve fields, choose title, return a `recipeDraft`; never write.
- [ ] Render details on Meals draft/cards, parent Today and display; extend
      `IngredientForm` with provider group checkboxes.
- [ ] Run typecheck/lint and focused unit/integration tests.

## Task 6: Browser coverage

- [ ] Add an e2e-only fetch fixture (`scripts/mock-recipe-fetch.cjs`) and load it in
      `scripts/e2e-server.ts` with `NODE_OPTIONS=--require`, no app test hook.
- [ ] Add a synthetic two-recipe fixture with yield, total time, quantities, and
      instructions/images that must not appear.
- [ ] Test preview success → details/groups → save → display → provider grocery add.
- [ ] Test preview failure keeps the link-only draft and save remains possible.
- [ ] Test non-eMeals draft has no preview button.
- [ ] Run `./scripts/dev.sh e2e e2e/meals.spec.ts` and existing grocery/pwa tests.

## Task 7: Documentation and delivery

- [ ] Update `docs/meals.md`, `docs/display.md`, `docs/architecture.md`; add the ADR.
- [ ] State the private, user-initiated boundary and the remaining account-sync
      limitations honestly.
- [ ] Run `mise run verify`.
- [ ] Review the full diff, commit, push with `./scripts/push-branch.sh`, open a PR,
      and comment a concise update on #30. Do not merge or self-approve.
