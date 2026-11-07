# Groceries

Household members can add, edit, mark bought, and remove grocery items. Quantity and unit are optional text. Every change is household scoped and requires a normal member session. Item creators and most recent editors are recorded; removal deletes the item and is not an audit ledger.

## Adding meal ingredients

A parent selects ingredient lines from a meal and chooses **Review selected ingredients**. Nothing is written at that point. The review shows every selected line with:

- the original ingredient text;
- a suggested item name, quantity and unit;
- **Family-entered ingredients** or **Recipe ingredients from eMeals** (with the provider group name);
- an indicator when an active grocery item probably matches;
- a note when a line could not be split confidently, or when the same text was selected from overlapping groups.

The parent can edit the name, quantity and unit, then choose **Add as new item**, **Skip this item**, or, when a match exists, **Keep separate duplicate**. Confirming writes the accepted rows in one immediate transaction and shows how many were added and skipped.

## How lines are parsed

The parser in `src/lib/grocery/ingredient-parser.ts` is deliberately conservative. It separates only a leading quantity and a recognized unit or counted item.

| Ingredient input | Item name | Quantity | Unit |
| --- | --- | --- | --- |
| `2 cups black beans` | `black beans` | `2` | `cups` |
| `1 onion` | `onion` | `1` | empty |
| `1/2 tsp salt` | `salt` | `1/2` | `tsp` |
| `3 tbsp olive oil` | `olive oil` | `3` | `tbsp` |
| `1 lb ground beef` | `ground beef` | `1` | `lb` |
| `2 cans diced tomatoes` | `diced tomatoes` | `2` | `cans` |
| `1½ cups rice` | `rice` | `1½` | `cups` |
| `Fresh basil` | `Fresh basil` | empty | empty |

Quantities keep their original integer, decimal, fraction, mixed-number or Unicode-fraction text. Units are stored as typed; the application does not convert pounds to ounces, cups to millilitres, or any other unit.

These lines stay whole and are flagged for review instead of being guessed:

- `Salt to taste`
- `2 (15 oz) cans diced tomatoes`
- `1–2 handfuls spinach`
- `2 bags lentils`
- `2 pkg cream cheese`
- `2 T butter`
- `about 2 cups beans`

Parentheses, ranges, approximate markers, ranges written with `to` or `or`, ambiguous package words (bags, boxes, packages, packets, jars, bottles and similar), and unknown short unit abbreviations keep the complete original line as the suggested name with empty quantity and unit. Brand names, package sizes, qualifiers and preparation notes are never discarded. The parent reviews and corrects the proposal before it is saved. This is not an NLP parser and does not attempt to model every culinary unit.

## Duplicate review

Review compares each proposed item name with the active grocery items. It also reads legacy rows whose entire ingredient line was stored in `name`, so an existing `2 cups black beans` still matches a proposed `black beans`. Simple singular and plural forms match; genuinely different products such as `green apples` and `red apples`, or `oil` and `olive oil`, do not.

A probable match never changes the existing item. The default action for a matched row is **Skip this item**. The parent may choose **Keep separate duplicate** to add another item. Quantities are never added together or silently overwritten, including when the two rows use different units.

If the same exact line was selected from both a family list and a provider group, both proposals stay visible and the later one defaults to **Skip**, so the ingredient is included once unless the parent decides otherwise.

## Concurrency and legacy data

Confirmation rechecks the meal's authorized lines and the current grocery list inside an immediate transaction. A forged, stale or cross-household ingredient selection is rejected and no rows are written. If another session adds a matching item between review and confirmation, the whole action is rejected and the review is shown again with the prior edits. The parent must choose the duplicate action or skip the row.

No schema change is required: `grocery_item` already stores `name`, `quantity` and `unit` separately. Existing rows, including rows whose name still contains a complete ingredient line, remain visible and editable. There is no destructive migration and no automatic update to existing quantities.

## Live updates

While the page is open and visible, it reruns the authenticated page load about every 25 seconds. Items added, completed, changed or removed in another session appear without a full browser reload, and the current scroll position and focused control are left alone. A refresh is skipped while another refresh is running, while the tab is hidden, while the browser reports that it is offline, and while a grocery draft is active.

The add form counts as a draft when any value is present or the duplicate confirmation is shown. An edit form counts as a draft when its name, quantity or unit differs from the saved item. Validation recovery keeps the submitted values and message and pauses updates until the member corrects or clears them. The status line states that updates are paused, and **Refresh list** does not replace the draft. Closing an edit form discards that draft and lets the next refresh use the current server values. An input the member already changed is not rewritten by a refresh response that was already in flight. Members can pause and resume automatic updates; hiding the tab also stops requests, and showing it or reconnecting resumes them.

**Refresh list** is an ordinary same-page link before hydration and when JavaScript is disabled, so it still reloads the current list. After hydration it performs the safe refresh instead. When the browser reports a connection loss, the rendered list stays visible and the status explains that updates are retrying. An expired session follows the normal sign-in redirect rather than presenting stale data as current.

Live refresh only replaces the displayed data. It does not retry a grocery mutation, combine quantities or bypass the item-version check; a stale save or removal is still rejected by the server. The list is not copied to localStorage, IndexedDB or a service-worker cache, and no WebSocket, message queue or separate synchronization endpoint is used. If the browser still reports itself online while the server is unreachable, SvelteKit may render its normal error page for the failed data load; that case is not detected as offline and is not guaranteed to preserve the current list.

## Unsupported

The list does not synchronize with eMeals, a retailer or any external grocery service, and it does not place orders or write to a retailer cart. Unit conversion, compound parsing, automatic quantity combining and ingredient-name normalisation beyond the conservative match above are out of scope.

Migration `0007_groceries` adds the list. Back up the database before upgrading and follow the existing migration and recovery procedure.
