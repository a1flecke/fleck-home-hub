CREATE TABLE calendar_import_batch (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES household(id),
  actor_id TEXT NOT NULL REFERENCES user(id),
  import_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  added_count INTEGER NOT NULL CHECK (added_count >= 0),
  skipped_count INTEGER NOT NULL CHECK (skipped_count >= 0),
  first_date TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (household_id, import_key)
);
--> statement-breakpoint
CREATE TABLE calendar_import_item (
  batch_id TEXT NOT NULL REFERENCES calendar_import_batch(id),
  event_id TEXT NOT NULL,
  household_id TEXT NOT NULL,
  source_uid TEXT,
  PRIMARY KEY (batch_id, event_id),
  FOREIGN KEY (event_id, household_id) REFERENCES calendar_event(id, household_id)
);
--> statement-breakpoint
CREATE INDEX calendar_import_item_uid ON calendar_import_item(household_id, source_uid)
  WHERE source_uid IS NOT NULL;
