# Meals

Parents can add and edit meals for a household-local date, including a serving time, servings, a family-entered ingredient list with quantities, private notes, source attribution and an optional HTTPS recipe link. Ingredients are stored as text, one per line. The grocery handoff suggests a structured name, quantity and unit for parent review, but it never rewrites the meal. A link and source are optional. The application fetches a recipe page only when a parent explicitly chooses **Preview recipe details** for a recognized eMeals link. It never collects eMeals credentials or synchronizes accounts.

## Add dinner from a recipe link

A parent can choose **Add meal from recipe link** on the Meals page:

1. Paste an HTTPS recipe link.
2. Choose **Review draft**. The server validates the link without opening it.
3. Review or change the suggested meal name, date, time, servings, family-entered ingredients, notes and sharing choice.
4. Choose **Save meal**. Nothing is stored until that confirmation. The draft is private unless **Share on family display** is selected.

The same link can be used on different dates. Repeating the same Save (a double click or a retry) returns the existing meal instead of creating a duplicate. A later page load starts a new draft, so a deliberate second meal is still possible.

Browsers that support Web Share Target can send a link directly from another app. The installed Home Hub app must already be signed in and must have been opened once so its non-caching share service worker is active. The share endpoint only prepares a review page; it does not create a meal. The parent still chooses Save. A failed share keeps a paste form available.

Safari and iOS Home Screen web apps do not reliably support Web Share Target. On an iPhone, use the eMeals Share menu to copy the recipe link, open Home Hub, and paste it into **Add meal from recipe link**. This paste workflow is always available and is the required fallback. No claim is made here that Home Hub appears in the iOS Share Sheet.

Real-device checks still required:

- On an installed Android Chromium PWA, sign in, open one real eMeals recipe, choose Share, confirm Home Hub appears, choose it, verify the draft link and Save.
- On the intended iPhone, use a temporary Shortcut with Apple's **View Content Graph** action on an eMeals recipe share. Record whether a URL, title, text or file is supplied, without sharing the URL or recipe content outside the device. Then verify the copy-and-paste fallback on the same device.

## Preview recipe details from eMeals

After reviewing a draft with a recognized eMeals link, a parent can choose **Preview recipe details**. This is an explicit, single-link request. The server:

- fetches only the exact HTTPS link on `emeals.com` or `www.emeals.com`;
- follows at most three redirects, revalidating every destination against the same exact hosts;
- sends no cookies or account credentials, uses a 5-second timeout and reads at most 1 MB;
- reads only JSON-LD `Recipe` name, yield, total time and ingredient lines;
- ignores directions, images, photos, logos, creator notices and all other fields.

The preview shows **Recipe details from eMeals** with the recipe yield and total time, and a collapsible **Recipe ingredients from eMeals** list with one named group per recipe record. Quantities are preserved as text. The parent can still edit the meal name, date, family-entered ingredients, notes and sharing choice before saving. Provider details are stored only when their source URL matches the saved meal link; changing the link and saving clears stale details.

If the fetch or JSON-LD read fails, the draft stays available and the parent can save the link-only meal. The original link and source credit remain. There is no automatic fetch on paste or share, no background refresh and no crawling.

This is a private household feature. It does not claim provider permission, a licensed import or redistribution rights. The household is responsible for the applicable eMeals terms. Account-level synchronization, weekly-plan enumeration, final grocery-list export, retailer writes and checkout remain out of scope.

## What is recognized automatically

The source registry in `src/lib/meals/recipe-sources.ts` recognizes only exact HTTPS hosts. eMeals is currently registered for `emeals.com` and `www.emeals.com`. `emeals.com.attacker.test`, `notemeals.com` and other lookalikes are not recognized. Insecure, credential-bearing, malformed, root-only and oversized links are rejected.

For a recognized eMeals link, the meal shows **Recipe source: eMeals** and **Open original recipe on eMeals**. An unrelated link gets the neutral **View recipe** label. Typing `eMeals` as the source does not relabel an unrelated destination; it is shown as the family-entered source. The original validated URL, including query parameters and fragment, is stored unchanged. The credit comes from the link rather than the editable meal name, so renaming a dinner does not erase it.

A readable final path segment can become a suggested title. Empty or opaque identifiers produce a blank title that the parent must fill in. The application does not manufacture a name from an opaque id.

Adding another provider later means adding one registry descriptor with exact hosts and reviewed labels, plus tests. The registry grants no permission to fetch or store that provider's content.

## Ingredients and provider content

Provider ingredient lines are shown as **Recipe ingredients from eMeals**, grouped by recipe record with quantity text preserved. Lines the parent types remain **Family-entered ingredients**. The meal cards label family lines that way when a verified provider link is present. The two sources stay separate; nothing is presented as if the family typed provider lines.

Selecting provider or family lines for groceries opens a review step; nothing is written until the parent confirms it. The review shows the original line, the suggested name, quantity and unit, the source group, and any probable active grocery match. The parent can edit every field and choose to add, skip or keep a separate duplicate. Ambiguous lines such as `2 (15 oz) cans tomatoes`, ranges, package descriptions and unknown abbreviations stay whole and are flagged rather than guessed. Quantities are never combined with existing items. Exact duplicate selections from overlapping groups are shown but included once by default. See [groceries](groceries.md) for the parsing and duplicate rules.

Provider details and the saved meal are unchanged by the grocery handoff. No directions, images or provider instructions are imported.

Automatic, background or multi-page retrieval is not implemented. The preview is limited to the single link the parent explicitly shares. Account synchronization and a permissioned provider feed remain separate, unapproved work.

## Privacy and sharing

Meals are private by default. A parent can explicitly share a meal on the family display. Children can see shared meals, but private notes remain parent-only. Unsharing removes the meal, its ingredients and its recipe URL from child and shared-display responses. Recipe links can be visible to household members when a meal is shared, so do not save links containing private credentials or tokens.

The draft is private because no row exists before Save. A draft with no title cannot be saved. A link draft does not create a shared meal unless the parent selects sharing and confirms Save.

## Source labels and the display

**Recipe source: eMeals** and **Open original recipe on eMeals** are shown together on the Meals page, the parent Today card and the opted-in family display. **Recipe details from eMeals** and its collapsed ingredient groups appear when details were saved; the source credit stays visible outside that collapsed section. The compact cards keep the credit and link while omitting parent controls and private notes. **Family-entered ingredients** remains visible when the ingredient details are shown. Grocery selection is offered when there are family or provider ingredient lines, and it always opens the parent-reviewed handoff described in [groceries](groceries.md).

The Meals page no longer labels a link as an eMeals destination merely because the free-text source says `eMeals`. Only the recognized HTTPS destination receives that label.

## Migration and verification

Migration `0008_meal_submission` adds a nullable `submission_key` and a partial unique index on `(household_id, submission_key)`. Migration `0010_meal_recipe_details` adds nullable `recipe_details` for normalized provider fields. Existing meals keep their data. Back up the database before upgrading and follow the existing migration and recovery procedure.

Automated tests use synthetic HTML fixtures and never contact eMeals. A subscribed adult must still verify a real share link and the preview on the intended devices and assess applicable content rights. Supported account-sync investigation is tracked separately in [issue #30](https://github.com/a1flecke/fleck-home-hub/issues/30); account synchronization is not implemented and is not claimed.
