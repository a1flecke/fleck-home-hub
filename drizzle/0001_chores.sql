CREATE TABLE chore (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES household(id),
  assignee_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
  description TEXT CHECK(description IS NULL OR length(description) <= 1000),
  due_date TEXT NOT NULL,
  reward_cents INTEGER CHECK(reward_cents IS NULL OR (typeof(reward_cents) = 'integer' AND reward_cents >= 0)),
  status TEXT NOT NULL CHECK(status IN ('todo', 'pending_verification', 'needs_rework', 'verified')),
  rework_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id, household_id, assignee_id),
  FOREIGN KEY(assignee_id, household_id) REFERENCES membership(user_id, household_id)
);
--> statement-breakpoint
CREATE TABLE chore_transition (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chore_id TEXT NOT NULL REFERENCES chore(id),
  actor_id TEXT NOT NULL REFERENCES user(id),
  from_status TEXT,
  to_status TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE earning (
  id TEXT PRIMARY KEY NOT NULL,
  chore_id TEXT NOT NULL UNIQUE,
  household_id TEXT NOT NULL,
  child_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents) = 'integer' AND amount_cents > 0),
  created_at TEXT NOT NULL,
  FOREIGN KEY(chore_id, household_id, child_id) REFERENCES chore(id, household_id, assignee_id)
);
--> statement-breakpoint
CREATE TRIGGER earning_no_update BEFORE UPDATE ON earning BEGIN SELECT RAISE(ABORT, 'earnings are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER earning_no_delete BEFORE DELETE ON earning BEGIN SELECT RAISE(ABORT, 'earnings are immutable'); END;
