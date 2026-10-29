CREATE TABLE `household` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `membership` (
  `user_id` text NOT NULL REFERENCES `user`(`id`) ON DELETE CASCADE,
  `household_id` text NOT NULL REFERENCES `household`(`id`) ON DELETE CASCADE,
  `role` text NOT NULL CHECK (`role` IN ('parent', 'kid')),
  PRIMARY KEY (`user_id`, `household_id`)
);
