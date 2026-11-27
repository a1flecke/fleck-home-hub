CREATE UNIQUE INDEX family_checklist_item_list_identity ON family_checklist_item(id, checklist_id);
--> statement-breakpoint
CREATE TABLE family_checklist_item_assignment (
  item_id TEXT PRIMARY KEY NOT NULL,
  checklist_id TEXT NOT NULL,
  household_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  FOREIGN KEY (item_id, checklist_id) REFERENCES family_checklist_item(id, checklist_id) ON DELETE CASCADE,
  FOREIGN KEY (checklist_id, household_id) REFERENCES family_checklist(id, household_id),
  FOREIGN KEY (member_id, household_id) REFERENCES membership(user_id, household_id)
);
--> statement-breakpoint
CREATE INDEX family_checklist_target_date ON family_checklist(household_id, target_date, id)
  WHERE archived = 0 AND target_date IS NOT NULL;
