CREATE TABLE `editor_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`password_salt` text NOT NULL,
	`password_hash` text NOT NULL,
	`password_iterations` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`session_version` integer DEFAULT 1 NOT NULL,
	`must_change_password` integer DEFAULT false NOT NULL,
	`failed_login_count` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	`last_login_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `editor_accounts_status_check` CHECK(`status` IN ('active', 'disabled')),
	CONSTRAINT `editor_accounts_iterations_check` CHECK(`password_iterations` >= 600000),
	CONSTRAINT `editor_accounts_email_normalized_check` CHECK(`email` = lower(trim(`email`))),
	CONSTRAINT `editor_accounts_session_version_check` CHECK(`session_version` > 0),
	CONSTRAINT `editor_accounts_failed_count_check` CHECK(`failed_login_count` >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_editor_accounts_email` ON `editor_accounts` (`email`);
--> statement-breakpoint
CREATE INDEX `idx_editor_accounts_status` ON `editor_accounts` (`status`);
--> statement-breakpoint
CREATE TABLE `editor_role_grants` (
	`account_id` text NOT NULL,
	`role` text NOT NULL,
	`granted_by` text NOT NULL,
	`granted_at` integer NOT NULL,
	`revoked_by` text,
	`revoked_at` integer,
	PRIMARY KEY(`account_id`, `role`),
	FOREIGN KEY (`account_id`) REFERENCES `editor_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `editor_role_grants_role_check` CHECK(`role` IN ('content_editor', 'content_reviewer', 'pilot_operator', 'safety_reviewer', 'account_admin', 'operations_admin'))
);
--> statement-breakpoint
CREATE INDEX `idx_editor_role_grants_role` ON `editor_role_grants` (`role`,`revoked_at`);
--> statement-breakpoint
CREATE TABLE `editor_totp_factors` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`label` text NOT NULL,
	`encrypted_secret` text NOT NULL,
	`key_version` integer DEFAULT 1 NOT NULL,
	`last_used_counter` integer,
	`verified_at` integer NOT NULL,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `editor_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_editor_totp_account` ON `editor_totp_factors` (`account_id`);
--> statement-breakpoint
CREATE INDEX `idx_editor_totp_active` ON `editor_totp_factors` (`account_id`,`revoked_at`);
--> statement-breakpoint
CREATE TABLE `editor_recovery_codes` (
	`account_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`used_at` integer,
	PRIMARY KEY(`account_id`, `code_hash`),
	FOREIGN KEY (`account_id`) REFERENCES `editor_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_editor_recovery_unused` ON `editor_recovery_codes` (`account_id`,`used_at`);
--> statement-breakpoint
CREATE TABLE `editor_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`session_version` integer NOT NULL,
	`issued_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`idle_expires_at` integer NOT NULL,
	`absolute_expires_at` integer NOT NULL,
	`revoked_at` integer,
	`revoked_by` text,
	`revoke_reason` text,
	FOREIGN KEY (`account_id`) REFERENCES `editor_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `editor_sessions_expiry_check` CHECK(`absolute_expires_at` > `issued_at` AND `idle_expires_at` > `issued_at` AND `idle_expires_at` <= `absolute_expires_at`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_editor_sessions_token_hash` ON `editor_sessions` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `idx_editor_sessions_account` ON `editor_sessions` (`account_id`,`absolute_expires_at`);
--> statement-breakpoint
CREATE INDEX `idx_editor_sessions_expiry` ON `editor_sessions` (`idle_expires_at`,`absolute_expires_at`);
--> statement-breakpoint
CREATE TABLE `rate_limit_windows` (
	`scope` text NOT NULL,
	`key_hash` text NOT NULL,
	`window_started_at` integer NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`scope`, `key_hash`),
	CONSTRAINT `rate_limit_windows_count_check` CHECK(`count` > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_rate_limit_windows_expiry` ON `rate_limit_windows` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `maintenance_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`job` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`details_json` text,
	CONSTRAINT `maintenance_runs_status_check` CHECK(`status` IN ('running', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `idx_maintenance_runs_job_started` ON `maintenance_runs` (`job`,`started_at`);
--> statement-breakpoint
CREATE TRIGGER `trg_editor_account_security_change_revokes_sessions`
AFTER UPDATE OF `status`, `password_hash`, `session_version` ON `editor_accounts`
WHEN NEW.`status` IS NOT OLD.`status`
  OR NEW.`password_hash` IS NOT OLD.`password_hash`
  OR NEW.`session_version` IS NOT OLD.`session_version`
BEGIN
  UPDATE `editor_sessions`
  SET `revoked_at` = COALESCE(`revoked_at`, unixepoch()),
      `revoked_by` = COALESCE(`revoked_by`, 'system:account-change'),
      `revoke_reason` = COALESCE(`revoke_reason`, '账号安全状态已变更')
  WHERE `account_id` = NEW.`id` AND `revoked_at` IS NULL;
END;
--> statement-breakpoint
PRAGMA optimize;
