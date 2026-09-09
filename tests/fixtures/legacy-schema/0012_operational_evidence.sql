CREATE TABLE `backup_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`snapshot_ref_hash` text,
	`checksum_sha256` text,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`expires_at` integer,
	`verified_at` integer,
	`details_json` text,
	CONSTRAINT `backup_runs_status_check` CHECK(`status` IN ('running', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `idx_backup_runs_started` ON `backup_runs` (`started_at`);
--> statement-breakpoint
CREATE TABLE `recovery_drills` (
	`id` text PRIMARY KEY NOT NULL,
	`backup_run_id` text,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`foreign_key_check_passed` integer,
	`smoke_check_passed` integer,
	`details_json` text,
	FOREIGN KEY (`backup_run_id`) REFERENCES `backup_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `recovery_drills_status_check` CHECK(`status` IN ('running', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `idx_recovery_drills_started` ON `recovery_drills` (`started_at`);
--> statement-breakpoint
PRAGMA optimize;
