# ADR 0003: On-demand eMeals recipe preview

Status: accepted for private household use; real subscriber-link and device checks
remain outstanding.

- **User-initiated only:** the server fetches an eMeals page only when a parent
  chooses **Preview recipe details** for the link already in the draft. There is no
  fetch on paste/share, no background refresh, no crawling and no account access.
- **Exact host allowlist:** `emeals.com` and `www.emeals.com` only. HTTPS is required,
  credentials and non-default ports are rejected, and each of at most three redirects
  is revalidated against the same list.
- **Bounded request:** 5-second timeout, 1 MB maximum body and an HTML content type.
  No cookies, account session, provider credentials or referrer-derived state are sent.
- **Narrow fields:** only JSON-LD `Recipe` name, yield, total time and ingredient
  lines are read. Directions, images, photos, logos, creator notices and all other
  fields are ignored. No raw HTML is stored.
- **Normalized local data:** nullable `meal.recipe_details` stores the source URL,
  title, yield, total time and named ingredient groups. Details are accepted only when
  the source URL exactly matches the saved link; changing the link clears stale data.
- **Fallback:** any fetch, redirect, content-type, size or parse failure leaves the
  draft available and the parent can save the link-only meal with the original credit.
- **Grocery boundary:** provider lines are presented as **Recipe ingredients from
  eMeals**, separate from family-entered lines. The existing explicit selection,
  duplicate review and household authorization remain in force. Selections are
  deduplicated.
- **Privacy:** shared display and child responses receive provider details only for
  explicitly shared meals. Unsharing removes the card, ingredients, details and URL.
  Private notes remain parent-only.
- **Rights:** this is a private, single-household, user-initiated preview. It does not
  claim provider permission, a licensed import, redistribution rights or account
  synchronization. The household remains responsible for the applicable eMeals terms.
- **Testing:** automated preview tests use synthetic HTML fixtures and an isolated
  e2e fetch shim; they never contact eMeals. A real subscriber link and the intended
  devices still require manual verification.

Consequences: Home Hub can show a useful, narrow recipe preview without storing or
exposing provider instructions or media. It depends on eMeals HTML structure and may
fail closed when the page changes. Account-level weekly plans, final grocery lists,
retailer carts and checkout remain separate, unsupported capabilities.
