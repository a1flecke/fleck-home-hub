CREATE TABLE recurring_schedule_revision (
  id TEXT PRIMARY KEY NOT NULL,
  series_id TEXT NOT NULL,
  household_id TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES user(id),
  effective_date TEXT NOT NULL,
  old_start_date TEXT NOT NULL,
  old_end_date TEXT,
  old_weekdays TEXT NOT NULL,
  new_start_date TEXT NOT NULL,
  new_end_date TEXT,
  new_weekdays TEXT NOT NULL,
  cancelled_dates TEXT NOT NULL DEFAULT '[]',
  created_dates TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  FOREIGN KEY(series_id, household_id) REFERENCES recurring_series(id, household_id)
);
--> statement-breakpoint
CREATE INDEX recurring_schedule_revision_series ON recurring_schedule_revision(series_id, created_at, id);
