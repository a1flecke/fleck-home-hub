CREATE TABLE expense (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES household(id),
  creator_id TEXT NOT NULL REFERENCES user(id),
  due_date TEXT NOT NULL,
  cadence TEXT NOT NULL CHECK(cadence IN ('once', 'weekly', 'biweekly', 'monthly', 'yearly')),
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active', 'paused', 'ended')),
  ended_on TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id, household_id)
);
--> statement-breakpoint
CREATE INDEX expense_household ON expense(household_id);
--> statement-breakpoint
CREATE TABLE expense_version (
  expense_id TEXT NOT NULL REFERENCES expense(id),
  effective_date TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
  amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents) = 'integer' AND amount_cents > 0),
  payee TEXT,
  category TEXT,
  notes TEXT,
  actor_id TEXT NOT NULL REFERENCES user(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY(expense_id, effective_date)
);
--> statement-breakpoint
CREATE TABLE expense_pause (
  expense_id TEXT NOT NULL REFERENCES expense(id),
  start_date TEXT NOT NULL,
  end_date TEXT,
  actor_id TEXT NOT NULL REFERENCES user(id),
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE expense_skip (
  expense_id TEXT NOT NULL REFERENCES expense(id),
  scheduled_date TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES user(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY(expense_id, scheduled_date)
);
