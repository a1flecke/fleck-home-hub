# eMeals on-demand recipe preview — design

**Date:** 2026-11-04
**Issue:** #30 follow-up
**Branch:** `feature/emeals-recipe-preview`
**Supersedes:** the link-only-only boundary in PR #52 for this private, user-initiated preview

## Goal

Let a parent explicitly request details for a single eMeals recipe link they already
shared or pasted. Show the recipe yield, total time and named ingredient groups,
preserve quantity text, and let the parent add provider ingredient lines to the
household grocery list. Keep the link-only meal path and source credit untouched
when retrieval fails.

## Scope and boundary

In scope:

- One parent-triggered fetch of the exact HTTPS eMeals URL in the current draft.
- Exact hosts `emeals.com` and `www.emeals.com`; no other hosts.
- JSON-LD `Recipe` records only: name, yield, total time, ingredient lines.
- At most 10 named groups, 200 lines and 1 MB of HTML.
- Manual redirects, approved-host-only, at most 3, 5-second timeout.
- No cookies, credentials, account session, crawling or background refresh.
- Family-entered ingredients remain separate from provider ingredients.
- Provider groups display on Meals, parent Today and the shared display.
- Grocery selection accepts provider lines through the existing duplicate-review path.
- Link-only fallback on fetch, parse or content failure.

Out of scope:

- Directions, images, photos, logos, creator notices or full recipe text.
- Account login, weekly-plan enumeration, final grocery-list export, retailer carts.
- Automatic fetching on paste/share, scheduled refresh, or scraping multiple pages.
- Any public redistribution. This is a private household feature.

The earlier issue deferral remains the record for account/API integration. This
feature is a user-initiated, single-link preview for personal use; it does not claim
provider permission or a licensed import. Documentation states that the household is
responsible for the provider terms and for keeping imported fields private.

## Data model

Migration `0009_meal_recipe_details` adds nullable `meal.recipe_details` TEXT.
The stored JSON is normalized and validated:

```text
{
  sourceUrl: string,          // must match the meal recipeUrl and an exact eMeals host
  title: string | null,
  yield: string | null,
  totalTime: string | null,
  groups: [{ name: string, lines: string[] }]
}
```

`src/lib/meals/recipe-details.ts` owns normalization, serialization, source matching
and flattened provider lines. It is pure and safe for client rendering. Provider
details are cleared when the recipe URL no longer matches `sourceUrl`.

## Fetch and parse

`src/lib/server/recipe-preview.ts`:

- validates the URL with the existing `parseRecipeLink` and requires the eMeals provider;
- returns `unavailable` without a network call for other hosts;
- fetches with `redirect: 'manual'`, a browser-like Accept header, a private-app
  User-Agent, no cookies and a 5-second abort signal;
- follows at most three redirects, each revalidated against the exact host list;
- requires an HTML content type and enforces a 1 MB streaming body limit;
- extracts `<script type="application/ld+json">` blocks, walks arrays and `@graph`,
  and accepts only `@type` values containing `Recipe`;
- formats ISO 8601 durations (`PT25M` → `25 min`, `PT1H30M` → `1 hr 30 min`);
- ignores `recipeInstructions`, `image` and every other field;
- returns generic `failed` on any error. The URL and response body are not logged.

## Draft and save flow

The existing link draft form adds a `Preview recipe details` submit button
(`name="intent" value="preview" formnovalidate`) for recognized eMeals links. It
submits the current draft fields to the existing parent-only, same-origin save action.

- Preview validates and fetches; it performs no database write.
- On success, it returns a draft with normalized details, the provider title when the
  current title is blank or still the path suggestion, and a status message.
- On failure, it returns the unchanged draft with a non-blocking message; Save still
  stores the link-only meal.
- Non-eMeals drafts do not offer the preview button; the server also refuses to fetch
  them.
- Save stores the hidden normalized details only when the source URL matches.
- Edit forms carry existing details; changing the link and saving clears stale details.

## Display and groceries

`RecipeDetails.svelte` renders **Recipe details from eMeals** with yield and total
time, and a collapsed **Recipe ingredients from eMeals** section with each group name
and its lines. It is used on Meals, the parent Today card and the family display. The
source credit remains outside the collapsed section.

`IngredientForm` renders provider groups and family-entered lines separately.
Selecting a provider line submits the same `ingredient` field. The server reads the
meal's stored details and validates selections against both family and provider lines.
Existing duplicate review and explicit confirmation remain; selections are deduplicated
to avoid adding the same line twice.

## Security and failure handling

- Session and parent checks precede preview and save.
- Same-origin check on the save/preview action.
- Exact-host allowlist prevents arbitrary server-side requests; redirects are
  revalidated and capped.
- No credentials, cookies, account state, raw HTML or response bodies are stored.
- Provider text is rendered as text; no `{@html}`.
- Failure is non-blocking and never removes the original link or credit.
- Preview is user-triggered only; there is no background or automatic fetch.

## Tests

Unit: detail normalization/limits/source matching, JSON-LD extraction, two-recipe
groups, duration formatting, malformed JSON, ignored instructions/images, non-eMeals
no-fetch, redirect rejection, HTTP/content-type/size failures.

Integration: meal persistence with details, display projection, unshare removal,
stale-source clearing, provider ingredient selection, duplicate review, migration
preserves existing meals.

Browser: preview success with a synthetic fixture served by the e2e test server,
provider groups and quantities visible, save, display, grocery add; preview failure
keeps the link-only draft; non-eMeals drafts have no preview button; hydration and
invalid-save recovery remain green.

## Documentation

Update `docs/meals.md`, `docs/display.md`, `docs/architecture.md` and add
`docs/adr/0003-emeals-recipe-preview.md`. Explicitly distinguish this private,
user-initiated preview from account synchronization, provider permission, crawling
and redistribution.
