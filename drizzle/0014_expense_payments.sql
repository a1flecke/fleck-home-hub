CREATE TABLE expense_payment (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL,
  expense_id TEXT NOT NULL,
  scheduled_date TEXT NOT NULL,
  paid_date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents) = 'integer' AND amount_cents > 0),
  planned_title TEXT NOT NULL,
  planned_payee TEXT,
  planned_category TEXT,
  planned_notes TEXT,
  planned_amount_cents INTEGER NOT NULL CHECK(typeof(planned_amount_cents) = 'integer' AND planned_amount_cents > 0),
  actor_id TEXT NOT NULL REFERENCES user(id),
  note TEXT,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(household_id, request_id),
  FOREIGN KEY(expense_id, household_id) REFERENCES expense(id, household_id)
);
--> statement-breakpoint
CREATE INDEX expense_payment_occurrence ON expense_payment(expense_id, scheduled_date);
--> statement-breakpoint
CREATE TABLE expense_payment_reversal (
  id TEXT PRIMARY KEY NOT NULL,
  payment_id TEXT NOT NULL UNIQUE REFERENCES expense_payment(id),
  actor_id TEXT NOT NULL REFERENCES user(id),
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER expense_payment_one_effective BEFORE INSERT ON expense_payment
WHEN EXISTS (SELECT 1 FROM expense_payment p WHERE p.expense_id = NEW.expense_id AND p.scheduled_date = NEW.scheduled_date AND NOT EXISTS (SELECT 1 FROM expense_payment_reversal r WHERE r.payment_id = p.id))
BEGIN SELECT RAISE(ABORT, 'occurrence already paid'); END;
--> statement-breakpoint
CREATE TRIGGER expense_payment_no_update BEFORE UPDATE ON expense_payment BEGIN SELECT RAISE(ABORT, 'payments are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER expense_payment_no_delete BEFORE DELETE ON expense_payment BEGIN SELECT RAISE(ABORT, 'payments are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER expense_payment_reversal_no_update BEFORE UPDATE ON expense_payment_reversal BEGIN SELECT RAISE(ABORT, 'reversals are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER expense_payment_reversal_no_delete BEFORE DELETE ON expense_payment_reversal BEGIN SELECT RAISE(ABORT, 'reversals are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER expense_paid_anchor_immutable BEFORE UPDATE OF due_date, cadence ON expense
WHEN (NEW.due_date != OLD.due_date OR NEW.cadence != OLD.cadence) AND EXISTS (SELECT 1 FROM expense_payment p WHERE p.expense_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'payment history exists'); END;
--> statement-breakpoint
CREATE TRIGGER expense_paid_skip_forbidden BEFORE INSERT ON expense_skip
WHEN EXISTS (SELECT 1 FROM expense_payment p WHERE p.expense_id = NEW.expense_id AND p.scheduled_date = NEW.scheduled_date)
BEGIN SELECT RAISE(ABORT, 'payment history exists'); END;
