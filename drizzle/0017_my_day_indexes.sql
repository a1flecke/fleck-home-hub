CREATE INDEX chore_household_status_due ON chore(household_id, status, due_date, id);
--> statement-breakpoint
CREATE INDEX chore_household_assignee_status_due ON chore(household_id, assignee_id, status, due_date, id);
--> statement-breakpoint
CREATE INDEX chore_household_status_updated ON chore(household_id, status, updated_at, id);
--> statement-breakpoint
CREATE INDEX earning_household_child ON earning(household_id, child_id, amount_cents);
--> statement-breakpoint
CREATE INDEX payout_household_child_date ON payout(household_id, child_id, paid_date, created_at, id);
--> statement-breakpoint
CREATE INDEX chore_transition_pending ON chore_transition(chore_id, to_status, id);
--> statement-breakpoint
CREATE INDEX recurring_series_household_created ON recurring_series(household_id, created_at, id);
