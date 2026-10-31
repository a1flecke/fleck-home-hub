# Groceries

Household members can add, edit, mark bought, and remove grocery items. Quantity and unit are optional text. A parent can select ingredients from a meal and add them to the list; each ingredient line is preserved as entered, including quantities. Active items with matching names, or one name at the end of the other, require explicit confirmation before another is added; case and incidental whitespace are ignored. Differently worded items may not match, and quantities are never automatically combined.

Each edit and removal includes a version. If another session has changed the item, the stale action is rejected; reload to see the current item before saving again. The list is household scoped and requires a normal member session. Item creators and most recent editors are recorded; removal deletes the item and is not an audit ledger.

Migration `0007_groceries` adds the list. Back up the database before upgrading and follow the existing migration and recovery procedure. No external grocery service, checkout, or recipe fetching is involved.
