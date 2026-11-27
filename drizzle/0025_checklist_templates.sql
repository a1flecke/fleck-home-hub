CREATE TABLE family_checklist_template (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES household(id),
  name TEXT NOT NULL,
  description TEXT,
  items TEXT NOT NULL CHECK (json_valid(items) AND json_type(items) = 'array' AND json_array_length(items) <= 500),
  version INTEGER NOT NULL DEFAULT 1
);
--> statement-breakpoint
CREATE INDEX family_checklist_template_household ON family_checklist_template(household_id, name COLLATE NOCASE, id);
--> statement-breakpoint
ALTER TABLE family_checklist ADD COLUMN copy_fingerprint TEXT;
