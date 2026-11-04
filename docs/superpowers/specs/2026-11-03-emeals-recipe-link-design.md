# eMeals recipe-link drafts and source attribution — design

**Date:** 2026-11-03
**Issues:** #30 (primary), #5 (related)
**Branch:** `feature/emeals-recipe-link-drafts`

## Goal

Let a parent turn a shared or pasted recipe link into a private, editable dated meal,
then optionally share that meal with the household. Preserve the original link and
accurate source credit. Do not fetch, import, or store provider content.

## Scope

Shipped in this slice:

- HTTPS recipe-link validation with no network request.
- Exact-host recognition for eMeals (`emeals.com`, `www.emeals.com`).
- Editable title suggestion from readable final path segments.
- Private draft review, household-local date, existing meal fields and Save.
- Server-side submission idempotency.
- Source credit and original-link labels on Meals, parent Today and the shared display.
- Paste workflow and a Web Share Target POST endpoint for supported browsers.
- Tests, documentation and a real-device limitation note.

Explicitly out of scope:

- Fetching recipe pages, JSON-LD, directions, images or ingredient metadata.
- eMeals sign-in, account sync, weekly-plan enumeration or grocery-list export.
- Retailer carts, checkout, or any provider credential collection.
- A logo or licensed recipe content.
- Claiming iOS Share Sheet support without a real-device check.

## Provider-neutral source registry

`src/lib/meals/recipe-sources.ts` owns a small data registry. Each entry declares:

- stable id and exact display name;
- the exact HTTPS hosts it owns;
- credit and link labels;
- optional path-prefix cleanup for readable titles.

Only `emeals` is registered. Adding another vendor later means adding one descriptor
and tests; no recognition logic is copied. The registry grants no fetch or import
permission. `metadataRetrieval` is not implemented.

Host matching is exact and case-insensitive. `emeals.com.attacker.test`,
`notemeals.com`, and trailing-dot variants are not recognized. The original URL
string is preserved, including query parameters and fragment.

## Link parsing and title suggestion

`parseRecipeLink(raw)`:

1. Trim; reject empty, over 2048 characters, malformed, non-HTTPS, embedded
   credentials, non-default ports and root-only paths.
2. Read the final non-empty path segment.
3. Decode safely; strip common `recipe-<number>-<number>-` prefixes, file
   extensions, separators and camelCase boundaries.
4. Remove control characters and collapse whitespace.
5. Reject opaque identifiers (pure numbers, UUIDs, long hex, or identifier-like
   alphanumeric tokens with no separators).
6. Return `null` for the suggested title when no readable name exists. Never invent
   a name from an opaque id.
7. Return the validated original URL string, not a reserialized URL.

`recipeAttribution(source, recipeUrl)` is the single presentation rule:

- Recognized eMeals link: `Recipe source: eMeals` and
  `Open original recipe on eMeals`.
- Other valid HTTPS link: neutral `View recipe`; the entered source, if any, is
  shown as `Source: <entered>`.
- No link: show the entered source only.
- A typed `eMeals` source never changes the destination label for an unrelated URL.
- If a recognized link also has a different family-entered source, show both
  credits; suppress the duplicate when the entered source is just `eMeals`.

## Draft workflow

The Meals page gains a parent-only **Add meal from recipe link** disclosure:

1. Parent pastes an HTTPS link.
2. The `draft` form action validates the link without fetching it.
3. On success, the same page renders an editable draft form with the original URL,
   suggested title (possibly blank), the selected household-local date and a fresh
   submission key.
4. The parent can change every field, add family-entered ingredients, notes, time,
   servings, and explicitly chooses sharing.
5. Save uses the existing `createMeal` validation and persistence.

A failed link validation keeps the URL and shows a status message. A failed save
returns the existing meal error shape plus `mode: 'recipeLink'`, so the draft stays
open with all entered values. No draft row is written before Save.

## Web Share Target

Manifest:

```json
"share_target": {
  "action": "/meals/share",
  "method": "POST",
  "enctype": "application/x-www-form-urlencoded",
  "params": { "title": "title", "text": "text", "url": "url" }
}
```

A minimal service worker forwards only same-origin POSTs to `/meals/share`; it
performs no caching and does not intercept other requests. The share route:

- requires an authenticated parent;
- extracts the first valid HTTPS link from `url` or `text`;
- uses a readable shared `title` before the path-derived suggestion;
- renders a private review draft in the POST response, so the URL never enters a
  query string, history entry, analytics event or log line;
- performs no database mutation, so a forged POST cannot create a meal;
- rejects an explicit foreign `Origin` while tolerating the share-target request
  form, which may omit it.

The Save action remains the existing same-origin-checked `/meals?/save`.

Safari/iOS Home Screen web apps do not reliably support Web Share Target. The paste
workflow is always available. A real Android Chrome device check and an iOS
Share → View Content Graph check remain manual, documented validations.

## Idempotency

Add nullable `meal.submission_key` and a partial unique index on
`(household_id, submission_key)`.

- Each server-rendered add/draft form gets a fresh UUID.
- Double-clicks and retries reuse the key; `createMeal` finds and returns the
  existing row inside an immediate transaction.
- A later page load gets a new key, so the same recipe used on another date creates
  a separate meal.
- Edits do not change the key.

This is preferable to deduplicating on `(recipe_url, meal_date)`, which would block
intentional same-day reuse and encode provider semantics into persistence.

## Presentation

`RecipeCredit.svelte` renders the shared attribution rule. Meals, parent Today and
the shared display all use it. The credit is derived from the link, not the editable
title, so renaming a meal cannot erase it. Ingredients remain family-entered text;
when a verified provider link is present, the cards label them
**Family-entered ingredients**. No grocery selection appears without ingredient
lines, and the existing duplicate-review path is unchanged.

Shared display responses keep only shared meals and the existing approved fields:
title, time, servings, ingredients, source, recipe URL. Private notes are excluded.
Unsharing removes the whole card and URL.

## Security and privacy

- Server session and parent membership checks on draft save and share handling.
- Same-origin check on the mutating Save action.
- Link validation rejects `javascript:`, `data:`, HTTP, credentials, malformed and
  oversized values. React/Svelte auto-escaping is used; no `{@html}`.
- No server network request to provider hosts; tests assert no outbound call.
- No analytics, no URL logging, no persistent browser copy of the draft URL.
- CSP, cache-control `no-store`, and existing session protections are preserved.
- Share-target POST has no write side effect; a forged request can at most render a
  draft that the parent must separately save.

## Tests

Unit: approved hosts, lookalikes, non-HTTPS, credentials, root/malformed, opaque
paths, query/fragment preservation, unrelated providers, missing links, typed-source
mismatch, HTML-special characters, shared-text extraction, exact host registry.

Integration: parent-only create, household isolation, private default, display
projection, unsharing removes the URL, duplicate submission returns one row, same
recipe on two dates creates two rows, migration preserves existing meals.

Browser: paste eMeals link, editable suggestion, date choice, save, credit and exact
destination, rename keeps credit, optional share, display fields only, unshare
removal, invalid link preservation, invalid save preservation, pre-hydration edits,
share-target POST, no outbound provider request.

## Documentation

Update `docs/meals.md`, `docs/display.md`, `docs/architecture.md`, `docs/pwa.md`, and
post a concise implementation update to issue #30. The update distinguishes shipped
link handling from unapproved automated imports and does not claim account sync.

## Follow-ups requiring provider authorization

- Permission to read structured title, yield, timing and ingredient fields from a
  subscriber-shared recipe URL.
- A permission-gated JSON-LD preview with named ingredient groups, quantity text,
  group selection and duplicate review.
- Subscriber weekly-plan or final-list export, if eMeals documents a supported
  interface.
