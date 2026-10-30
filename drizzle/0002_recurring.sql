CREATE TABLE household_settings (
  household_id TEXT PRIMARY KEY REFERENCES household(id),
  timezone TEXT NOT NULL DEFAULT 'America/Chicago'
);
--> statement-breakpoint
CREATE TABLE recurring_series (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES household(id),
  creator_id TEXT NOT NULL REFERENCES user(id),
  assignee_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
  description TEXT,
  reward_cents INTEGER CHECK(reward_cents IS NULL OR (typeof(reward_cents) = 'integer' AND reward_cents >= 0)),
  start_date TEXT NOT NULL,
  end_date TEXT,
  weekdays TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active', 'paused', 'ended')),
  paused_on TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id, household_id),
  FOREIGN KEY(assignee_id, household_id) REFERENCES membership(user_id, household_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX chore_household_identity ON chore(id, household_id);
--> statement-breakpoint
CREATE TABLE recurring_occurrence (
  series_id TEXT NOT NULL,
  household_id TEXT NOT NULL,
  scheduled_date TEXT NOT NULL,
  chore_id TEXT NOT NULL UNIQUE,
  PRIMARY KEY(series_id, scheduled_date),
  FOREIGN KEY(series_id, household_id) REFERENCES recurring_series(id, household_id),
  FOREIGN KEY(chore_id, household_id) REFERENCES chore(id, household_id)
);
--> statement-breakpoint
CREATE TABLE recurring_skip (
  series_id TEXT NOT NULL REFERENCES recurring_series(id),
  scheduled_date TEXT NOT NULL,
  PRIMARY KEY(series_id, scheduled_date)
);
