CREATE TABLE meal (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES household(id),
  title TEXT NOT NULL,
  meal_date TEXT NOT NULL,
  meal_time TEXT,
  servings INTEGER,
  ingredients TEXT NOT NULL DEFAULT '',
  notes TEXT,
  source TEXT,
  recipe_url TEXT,
  shared INTEGER NOT NULL DEFAULT 0 CHECK (shared IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
