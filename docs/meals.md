# Meals

Parents can add and edit meals for a household-local date, including a serving time, servings, a user-entered ingredient list with quantities, private notes, source attribution and an optional HTTPS recipe link. Ingredients are stored as text, one per line; they are not yet a structured grocery list. A link and source are optional. The application does not fetch recipe pages, collect third-party credentials or synchronize eMeals accounts.

For an eMeals recipe, use the app's [share feature](https://support.emeals.com/portal/en/kb/articles/how-do-i-share-a-recipe-from-the-app), paste the HTTPS share link into Recipe link, and enter `eMeals` as the source. Add ingredients yourself, subject to the provider's terms. The meal and family display label the link “Open in eMeals”; this label reflects the entered source, not independent verification of the destination. An unavailable link does not prevent use of the saved meal. Recipe links can be visible to household members when a meal is shared, so do not save links containing private credentials or tokens.

The current workflow has been tested with synthetic links only. A subscribed adult must verify a real share link on the intended devices and assess applicable content rights. Supported SDK and account-sync investigation is tracked separately in [issue #30](https://github.com/a1flecke/fleck-home-hub/issues/30); it is not part of this feature.

Meals are private by default. A parent can explicitly share a meal on the family display; children can see shared meals, but private notes remain parent-only. The display shows only shared meals for the current household-local date, including ingredients and an optional recipe link. Display access still requires a household session and a normal session permits other access allowed by that account.

The parent dashboard shows all of the household's meals for today, including unshared meals, their ingredients and any saved recipe links. It does not include private meal notes. The child's dashboard does not receive this meal-card data; children can view shared meals on the Meals page.

Migration `0006_meals` adds the meal table. Back up the database before upgrading and follow the existing migration and recovery procedure. Parents can add selected ingredient lines to the [grocery list](groceries.md). Structured ingredient quantities and real eMeals share-link verification are future work.
