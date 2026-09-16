CREATE TABLE `activity` (
	`id` text PRIMARY KEY NOT NULL,
	`package_id` text,
	`actor` text NOT NULL,
	`message` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_email` ON `members` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `members_user` ON `members` (`user_id`);--> statement-breakpoint
CREATE TABLE `packages` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`subsystem` text NOT NULL,
	`status` text DEFAULT 'In progress' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`current_version_id` text NOT NULL,
	`locked_by` text,
	`lock_token` text,
	`locked_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `versions` (
	`id` text PRIMARY KEY NOT NULL,
	`package_id` text NOT NULL,
	`revision` integer NOT NULL,
	`filename` text NOT NULL,
	`size` integer NOT NULL,
	`storage_key` text NOT NULL,
	`note` text NOT NULL,
	`author_id` text NOT NULL,
	`author_name` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`package_id`) REFERENCES `packages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `versions_package_revision` ON `versions` (`package_id`,`revision`);