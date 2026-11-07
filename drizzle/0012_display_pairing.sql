CREATE TABLE `display_pairing` (
  `id` text PRIMARY KEY NOT NULL,
  `secret_hash` text NOT NULL UNIQUE,
  `household_id` text NOT NULL REFERENCES `household`(`id`) ON DELETE CASCADE,
  `label` text NOT NULL CHECK (length(`label`) BETWEEN 1 AND 60),
  `created_by` text NOT NULL REFERENCES `user`(`id`),
  `created_at` integer NOT NULL,
  `expires_at` integer NOT NULL,
  `consumed_at` integer,
  `revoked_at` integer
);
--> statement-breakpoint
CREATE INDEX `display_pairing_household` ON `display_pairing` (`household_id`, `created_by`);
--> statement-breakpoint
CREATE TABLE `display_device` (
  `id` text PRIMARY KEY NOT NULL,
  `pairing_id` text NOT NULL UNIQUE REFERENCES `display_pairing`(`id`) ON DELETE CASCADE,
  `token_hash` text NOT NULL UNIQUE,
  `household_id` text NOT NULL REFERENCES `household`(`id`) ON DELETE CASCADE,
  `label` text NOT NULL CHECK (length(`label`) BETWEEN 1 AND 60),
  `created_by` text NOT NULL REFERENCES `user`(`id`),
  `created_at` integer NOT NULL,
  `expires_at` integer NOT NULL,
  `last_seen_at` integer,
  `revoked_at` integer,
  `revoked_by` text REFERENCES `user`(`id`)
);
--> statement-breakpoint
CREATE INDEX `display_device_household` ON `display_device` (`household_id`, `created_by`);
