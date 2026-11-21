# Weekly Meal Planning and Grocery Shopping Implementation Plan

> **For agentic workers:** Use TDD for each behavior. This arc is delivered as four stacked PRs because earlier PRs may not have merged when later work begins.

**Goal:** Let a busy parent plan a full week of dinners, repeat a favorite meal, turn the plan into a reviewed grocery list, and see upcoming dinners in ordinary daily use.

**Architecture:** Extend the existing `meal` and `grocery_item` domains and `/meals`, `/groceries`, and `/dashboard` routes. Reuse the existing parent authorization, bounded date validation, meal form, ingredient parser, duplicate rules, and immediate SQLite transactions. No new database table, provider integration, or second grocery list.

**Tech Stack:** SvelteKit 3, Svelte 5, better-sqlite3, Drizzle migrations, Vitest, Playwright.

---

## PR 1 — Weekly meal planner

**User outcome:** A parent sees seven household-local days, plans empty days and extra meals, edits, moves and removes meals, and children see only shared meals.

- Add `src/lib/meals/week.ts` for Sunday-based week math and bounded date validation.
- Add `listMealWeek` (exactly seven days), `moveMeal`, and `removeMeal` to `src/lib/server/meals.ts`, always with active parent membership and household scope for writes.
- Rework `/meals` to a seven-day view with native previous/current/next links, day-scoped plan links, an add form that opens for the selected day, edit, move, and native removal confirmation.
- Keep recipe attribution, recipe URL, ingredients, notes and sharing unchanged by moves.
- Preserve the selected week and submitted draft on validation failure.
- Tests: week math unit tests, authorization and range integration tests, mobile/desktop, no-JavaScript, invalid recovery, move, remove, and child isolation browser journeys.
- Docs and synthetic screenshots.

## PR 2 — Plan it again

**User outcome:** A parent searches recent household dinners and plans a copy on a new date without changing the original.

- Add bounded recent-meal listing (title search, limited rows) and source validation on the server.
- Add `/meals/again`: choose a source meal, preview an editable copy (title, date, time, servings, ingredients, recipe link, sharing), then save.
- Copy only valid recipe attribution that matches the saved link; never fetch provider content.
- Create a new row via the existing submission-key idempotency; default private; reject removed or cross-household sources.
- Tests: copy isolation, attribution preservation, removed source, duplicate save, authorization, search bounds, native and hydrated browser journeys.

## PR 3 — Shop the week

**User outcome:** A parent selects ingredients from several planned meals and writes a reviewed grocery list.

- Extend `src/lib/server/groceries.ts` with a multi-meal review and atomic confirm path.
- Review shows original line, parsed name/quantity/unit, source group, every meal requiring the line, active grocery matches, and cross-meal duplicates.
- Default a later duplicate to Skip and require an explicit decision; never combine quantities or incompatible units.
- Revalidate meals, lines, parent membership and the current list inside one immediate transaction; reject stale selections and preserve review edits on conflict.
- Add `/meals/shop` and link it from the planner; show added/skipped counts and link to Groceries.
- Tests: multi-meal review, duplicate decisions, stale and concurrent conflicts, authorization, atomicity, and a complete week-to-groceries browser journey.

## PR 4 — Family dinner at a glance

**User outcome:** Parents see upcoming dinners and missing days on My Day; children get a read-only shared week.

- Add a seven-day dinner preview to the parent My Day dashboard with links to the planner and grocery handoff.
- Add a child My Day link to the weekly read-only view; keep responses free of private meals and notes.
- Keep the shared display projection unchanged.
- Tests: parent, child, anonymous, responsive phone layouts, native and hydrated submissions, invalid recovery, and a second-parent conflict.
- Update product docs and capture synthetic screenshots.
