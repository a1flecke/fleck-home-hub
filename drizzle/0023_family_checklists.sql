CREATE TABLE family_checklist (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES household(id),
  name TEXT NOT NULL,
  description TEXT,
  target_date TEXT,
  shared INTEGER NOT NULL DEFAULT 0 CHECK (shared IN (0, 1)),
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL REFERENCES user(id),
  create_request_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX family_checklist_create_request ON family_checklist(household_id, created_by, create_request_id);
--> statement-breakpoint
CREATE INDEX family_checklist_household ON family_checklist(household_id, archived);
--> statement-breakpoint
CREATE TABLE family_checklist_item (
  id TEXT PRIMARY KEY NOT NULL,
  checklist_id TEXT NOT NULL REFERENCES family_checklist(id),
  name TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  completed_by TEXT REFERENCES user(id),
  completed_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX family_checklist_item_list ON family_checklist_item(checklist_id, position);
--> statement-breakpoint
CREATE TABLE family_checklist_add_request (
  checklist_id TEXT NOT NULL REFERENCES family_checklist(id),
  actor_id TEXT NOT NULL REFERENCES user(id),
  request_id TEXT NOT NULL,
  PRIMARY KEY (checklist_id, actor_id, request_id)
);
