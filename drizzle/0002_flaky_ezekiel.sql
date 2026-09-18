ALTER TABLE `packages` ADD `system_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `packages_system_key` ON `packages` (`system_key`);--> statement-breakpoint
ALTER TABLE `versions` ADD `manifest` text;