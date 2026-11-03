ALTER TABLE meal ADD COLUMN submission_key TEXT;
--> statement-breakpoint
CREATE UNIQUE INDEX meal_household_submission ON meal (household_id, submission_key) WHERE submission_key IS NOT NULL;
