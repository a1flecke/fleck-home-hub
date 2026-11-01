# Meals

Parents can add and edit meals for a household-local date, including a serving time, servings, a user-entered ingredient list with quantities, private notes, source attribution and an optional HTTPS recipe link. Ingredients are stored as text, one per line; they are not yet a structured grocery list. A link and source are optional. The application does not fetch recipe pages, collect third-party credentials or synchronize eMeals accounts.

Meals are private by default. A parent can explicitly share a meal on the family display; children can see shared meals, but private notes remain parent-only. The display shows only shared meals for the current household-local date, including ingredients and an optional recipe link. Display access still requires a household session and a normal session permits other access allowed by that account.

Migration `0006_meals` adds the meal table. Back up the database before upgrading and follow the existing migration and recovery procedure. Parents can add selected ingredient lines to the [grocery list](groceries.md). Structured ingredient quantities and real eMeals share-link verification are future work.
