CREATE TABLE recurring_series_version (
  series_id TEXT NOT NULL,
  household_id TEXT NOT NULL,
  effective_date TEXT NOT NULL,
  assignee_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
  description TEXT,
  reward_cents INTEGER CHECK(reward_cents IS NULL OR (typeof(reward_cents) = 'integer' AND reward_cents >= 0)),
  end_date TEXT,
  weekdays TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(series_id, effective_date),
  FOREIGN KEY(series_id, household_id) REFERENCES recurring_series(id, household_id),
  FOREIGN KEY(assignee_id, household_id) REFERENCES membership(user_id, household_id)
);
--> statement-breakpoint
INSERT INTO recurring_series_version (series_id, household_id, effective_date, assignee_id, title, description, reward_cents, end_date, weekdays, created_at)
SELECT id, household_id, start_date, assignee_id, title, description, reward_cents, end_date, weekdays, created_at
FROM recurring_series;
--> statement-breakpoint
CREATE TABLE recurring_occurrence_new (
  series_id TEXT NOT NULL,
  household_id TEXT NOT NULL,
  scheduled_date TEXT NOT NULL,
  chore_id TEXT PRIMARY KEY NOT NULL,
  archived_at TEXT,
  FOREIGN KEY(series_id, household_id) REFERENCES recurring_series(id, household_id),
  FOREIGN KEY(chore_id, household_id) REFERENCES chore(id, household_id)
);
--> statement-breakpoint
INSERT INTO recurring_occurrence_new (series_id, household_id, scheduled_date, chore_id, archived_at)
SELECT o.series_id, o.household_id, o.scheduled_date, o.chore_id, c.cancelled_at
FROM recurring_occurrence o
JOIN chore c ON c.id = o.chore_id;
--> statement-breakpoint
DROP TABLE recurring_occurrence;
--> statement-breakpoint
ALTER TABLE recurring_occurrence_new RENAME TO recurring_occurrence;
--> statement-breakpoint
CREATE UNIQUE INDEX recurring_occurrence_active ON recurring_occurrence(series_id, scheduled_date) WHERE archived_at IS NULL;
--> statement-breakpoint
CREATE INDEX recurring_occurrence_series_date ON recurring_occurrence(series_id, scheduled_date);
