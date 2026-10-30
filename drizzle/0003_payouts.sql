CREATE TABLE payout (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES household(id),
  child_id TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES user(id),
  amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents) = 'integer' AND amount_cents > 0),
  paid_date TEXT NOT NULL,
  note TEXT,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(household_id, request_id),
  UNIQUE(id, household_id, child_id),
  FOREIGN KEY(child_id, household_id) REFERENCES membership(user_id, household_id)
);
--> statement-breakpoint
CREATE TRIGGER payout_no_update BEFORE UPDATE ON payout BEGIN SELECT RAISE(ABORT, 'payouts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER payout_no_delete BEFORE DELETE ON payout BEGIN SELECT RAISE(ABORT, 'payouts are immutable'); END;
--> statement-breakpoint
CREATE TABLE payout_reversal (
  id TEXT PRIMARY KEY NOT NULL,
  payout_id TEXT NOT NULL UNIQUE REFERENCES payout(id),
  actor_id TEXT NOT NULL REFERENCES user(id),
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER payout_reversal_no_update BEFORE UPDATE ON payout_reversal BEGIN SELECT RAISE(ABORT, 'reversals are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER payout_reversal_no_delete BEFORE DELETE ON payout_reversal BEGIN SELECT RAISE(ABORT, 'reversals are immutable'); END;
--> statement-breakpoint
CREATE TABLE payday_schedule (
  household_id TEXT PRIMARY KEY NOT NULL REFERENCES household(id),
  anchor_date TEXT NOT NULL,
  cadence_days INTEGER NOT NULL CHECK(cadence_days IN (7, 14)),
  updated_by TEXT NOT NULL REFERENCES user(id),
  updated_at TEXT NOT NULL
);
