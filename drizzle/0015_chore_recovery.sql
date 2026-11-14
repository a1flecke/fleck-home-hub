CREATE TABLE recurring_pause_interval (
  id INTEGER PRIMARY KEY,
  series_id TEXT NOT NULL REFERENCES recurring_series(id),
  started_on TEXT NOT NULL,
  ended_on TEXT,
  actor_id TEXT NOT NULL REFERENCES user(id),
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX recurring_pause_series ON recurring_pause_interval(series_id, started_on);
--> statement-breakpoint
CREATE TABLE recurring_recovery_decision (
  series_id TEXT NOT NULL,
  household_id TEXT NOT NULL,
  scheduled_date TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('create', 'skip')),
  chore_id TEXT REFERENCES chore(id),
  actor_id TEXT NOT NULL REFERENCES user(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY(series_id, scheduled_date),
  FOREIGN KEY(series_id, household_id) REFERENCES recurring_series(id, household_id)
);
