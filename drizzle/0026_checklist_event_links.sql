CREATE UNIQUE INDEX family_checklist_id_household ON family_checklist(id, household_id);
--> statement-breakpoint
CREATE TABLE family_checklist_event (
  checklist_id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  occurrence_date TEXT NOT NULL,
  token TEXT NOT NULL,
  FOREIGN KEY (checklist_id, household_id) REFERENCES family_checklist(id, household_id),
  FOREIGN KEY (event_id, household_id) REFERENCES calendar_event(id, household_id)
);
--> statement-breakpoint
CREATE INDEX family_checklist_event_household_date ON family_checklist_event(household_id, occurrence_date, event_id);
