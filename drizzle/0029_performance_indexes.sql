CREATE INDEX meal_household_date ON meal(household_id, meal_date, id);
--> statement-breakpoint
CREATE INDEX expense_pause_expense_dates ON expense_pause(expense_id, start_date, end_date);
--> statement-breakpoint
CREATE INDEX expense_payment_household_date ON expense_payment(household_id, scheduled_date, created_at, id);
--> statement-breakpoint
CREATE INDEX membership_household_active ON membership(household_id, disabled_at, role, user_id);
--> statement-breakpoint
CREATE INDEX calendar_inbox_household_state ON calendar_inbox(household_id, state, created_at, id);
--> statement-breakpoint
CREATE INDEX household_invitation_household ON household_invitation(household_id, expires_at, id);
--> statement-breakpoint
CREATE INDEX managed_child_household ON managed_child(household_id, user_id);
--> statement-breakpoint
CREATE INDEX chore_household_updated ON chore(household_id, updated_at, id);
--> statement-breakpoint
CREATE INDEX chore_household_assignee_due ON chore(household_id, assignee_id, due_date, id);
