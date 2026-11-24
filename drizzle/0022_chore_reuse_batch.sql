CREATE TABLE chore_reuse_batch (
  id TEXT NOT NULL,
  household_id TEXT NOT NULL REFERENCES household(id),
  actor_id TEXT NOT NULL REFERENCES user(id),
  source_chore_id TEXT NOT NULL REFERENCES chore(id),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
  description TEXT CHECK(description IS NULL OR length(description) <= 1000),
  reward_cents INTEGER CHECK(reward_cents IS NULL OR (typeof(reward_cents) = 'integer' AND reward_cents >= 0)),
  due_date TEXT NOT NULL,
  assignee_ids TEXT NOT NULL,
  chore_ids TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(id, household_id)
);
--> statement-breakpoint
CREATE INDEX chore_reuse_batch_household_created ON chore_reuse_batch(household_id, created_at, id);
