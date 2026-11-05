CREATE TABLE `household_invitation` (
  `id` text PRIMARY KEY NOT NULL,
  `token_hash` text NOT NULL UNIQUE,
  `household_id` text NOT NULL REFERENCES `household`(`id`) ON DELETE CASCADE,
  `role` text NOT NULL CHECK (`role` IN ('parent', 'kid')),
  `created_by` text NOT NULL REFERENCES `user`(`id`),
  `expires_at` integer NOT NULL,
  `consumed_at` integer,
  `revoked_at` integer
);
