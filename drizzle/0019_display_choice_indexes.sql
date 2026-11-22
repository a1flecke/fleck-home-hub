CREATE INDEX display_event_household ON display_event(household_id, event_id);
--> statement-breakpoint
CREATE INDEX display_chore_household ON display_chore(household_id, chore_id);
--> statement-breakpoint
CREATE INDEX calendar_event_household_start ON calendar_event(household_id, start_date, id);
--> statement-breakpoint
CREATE INDEX chore_household_due ON chore(household_id, due_date, id);
