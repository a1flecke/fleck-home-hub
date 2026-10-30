CREATE TABLE calendar_event (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES household(id),
  creator_id TEXT NOT NULL REFERENCES user(id),
  title TEXT NOT NULL,
  description TEXT,
  location TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT,
  start_time TEXT,
  end_time TEXT,
  all_day INTEGER NOT NULL CHECK (all_day IN (0, 1)),
  weekdays TEXT,
  cancelled INTEGER NOT NULL DEFAULT 0 CHECK (cancelled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (id, household_id)
);
--> statement-breakpoint
CREATE TABLE calendar_participant (
  event_id TEXT NOT NULL,
  household_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (event_id, user_id),
  FOREIGN KEY (event_id, household_id) REFERENCES calendar_event(id, household_id),
  FOREIGN KEY (user_id, household_id) REFERENCES membership(user_id, household_id)
);
--> statement-breakpoint
CREATE TABLE calendar_exception (
  event_id TEXT NOT NULL REFERENCES calendar_event(id),
  occurrence_date TEXT NOT NULL,
  PRIMARY KEY (event_id, occurrence_date)
);
--> statement-breakpoint
CREATE TABLE calendar_inbox (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES household(id),
  creator_id TEXT NOT NULL REFERENCES user(id),
  title TEXT NOT NULL,
  description TEXT,
  owner_id TEXT,
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'scheduled', 'archived')),
  event_id TEXT REFERENCES calendar_event(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, household_id) REFERENCES membership(user_id, household_id)
);
