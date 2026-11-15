CREATE TABLE initial_setup (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
--> statement-breakpoint
CREATE TABLE household_onboarding (
  household_id TEXT PRIMARY KEY REFERENCES household(id) ON DELETE CASCADE,
  step TEXT NOT NULL CHECK (step IN ('parents', 'children', 'activities', 'complete'))
);

--> statement-breakpoint
CREATE TABLE managed_child (
  user_id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  username TEXT COLLATE NOCASE UNIQUE,
  version INTEGER NOT NULL DEFAULT 0,
  request_id TEXT UNIQUE,
  created_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id, household_id) REFERENCES membership(user_id, household_id) ON DELETE CASCADE
);
