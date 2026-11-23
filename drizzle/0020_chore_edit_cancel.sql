ALTER TABLE chore ADD COLUMN cancelled_at TEXT;
--> statement-breakpoint
ALTER TABLE chore ADD COLUMN cancelled_by TEXT REFERENCES user(id);
--> statement-breakpoint
CREATE TABLE chore_revision (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chore_id TEXT NOT NULL REFERENCES chore(id),
  actor_id TEXT NOT NULL REFERENCES user(id),
  changed_at TEXT NOT NULL,
  changes TEXT NOT NULL CHECK(length(changes) BETWEEN 2 AND 4000)
);
--> statement-breakpoint
CREATE INDEX chore_revision_chore ON chore_revision(chore_id, changed_at, id);
