CREATE TABLE display_event (
  event_id TEXT NOT NULL,
  household_id TEXT NOT NULL,
  PRIMARY KEY (event_id, household_id),
  FOREIGN KEY (event_id, household_id) REFERENCES calendar_event(id, household_id)
);
--> statement-breakpoint
CREATE TABLE display_chore (
  chore_id TEXT NOT NULL,
  household_id TEXT NOT NULL,
  PRIMARY KEY (chore_id, household_id),
  FOREIGN KEY (chore_id, household_id) REFERENCES chore(id, household_id)
);
