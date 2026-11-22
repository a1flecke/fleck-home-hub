CREATE TABLE grocery_week_confirmation (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES household(id),
  actor_id TEXT NOT NULL REFERENCES user(id),
  confirmation_key TEXT NOT NULL,
  week_start TEXT NOT NULL,
  week_end TEXT NOT NULL,
  added INTEGER NOT NULL,
  skipped INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX grocery_week_confirmation_household_key ON grocery_week_confirmation(household_id, confirmation_key);
