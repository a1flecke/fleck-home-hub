ALTER TABLE `membership` ADD COLUMN `disabled_at` integer;
--> statement-breakpoint
ALTER TABLE `membership` ADD COLUMN `disabled_by` text REFERENCES `user`(`id`);
--> statement-breakpoint
CREATE VIEW `active_membership` AS
  SELECT `user_id`, `household_id`, `role` FROM `membership` WHERE `disabled_at` IS NULL;
--> statement-breakpoint
CREATE TRIGGER `membership_disable_requires_actor` BEFORE UPDATE OF `disabled_at` ON `membership`
WHEN NEW.`disabled_at` IS NOT NULL AND OLD.`disabled_at` IS NULL AND (NEW.`disabled_by` IS NULL OR NEW.`disabled_by` = OLD.`user_id`)
BEGIN SELECT RAISE(ABORT, 'A member must be disabled by another member'); END;
--> statement-breakpoint
CREATE TRIGGER `membership_keep_active_parent` BEFORE UPDATE OF `disabled_at` ON `membership`
WHEN NEW.`disabled_at` IS NOT NULL AND OLD.`disabled_at` IS NULL AND OLD.`role` = 'parent'
  AND NOT EXISTS (SELECT 1 FROM `membership` WHERE `household_id` = OLD.`household_id` AND `role` = 'parent' AND `disabled_at` IS NULL AND `user_id` <> OLD.`user_id`)
BEGIN SELECT RAISE(ABORT, 'A household must keep an active parent'); END;
