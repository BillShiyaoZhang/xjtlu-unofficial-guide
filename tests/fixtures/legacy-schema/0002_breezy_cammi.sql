CREATE TABLE `workflow_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`expected_version` integer NOT NULL,
	`target_status` text NOT NULL,
	`actor_id` text NOT NULL,
	`reason` text NOT NULL,
	`request_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`applied_at` integer,
	CONSTRAINT "workflow_operations_target_type_check" CHECK("workflow_operations"."target_type" IN ('answer_card', 'report', 'research_intake'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_workflow_operations_request` ON `workflow_operations` (`request_id`);--> statement-breakpoint
CREATE INDEX `idx_workflow_operations_target` ON `workflow_operations` (`target_type`,`target_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `answer_cards` ADD `last_workflow_operation_id` text;--> statement-breakpoint
ALTER TABLE `reports` ADD `lock_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `reports` ADD `last_workflow_operation_id` text;--> statement-breakpoint
ALTER TABLE `research_intakes` ADD `lock_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `research_intakes` ADD `last_workflow_operation_id` text;--> statement-breakpoint
CREATE TRIGGER `trg_answer_cards_validate_visibility_workflow`
BEFORE UPDATE OF `publication_status` ON `answer_cards`
WHEN NEW.`publication_status` IS NOT OLD.`publication_status`
  AND NEW.`current_public_revision_id` IS OLD.`current_public_revision_id`
BEGIN
  SELECT CASE WHEN NOT (
    (OLD.`publication_status` = 'published' AND NEW.`publication_status` = 'hidden')
    OR (OLD.`publication_status` = 'hidden' AND NEW.`publication_status` = 'published')
  ) THEN RAISE(ABORT, 'invalid_answer_card_visibility_transition') END;

  SELECT CASE WHEN NEW.`lock_version` != OLD.`lock_version` + 1
    THEN RAISE(ABORT, 'invalid_answer_card_visibility_version') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `workflow_operations` op
    WHERE op.`id` = NEW.`last_workflow_operation_id`
      AND op.`target_type` = 'answer_card'
      AND op.`target_id` = OLD.`id`
      AND op.`expected_version` = OLD.`lock_version`
      AND op.`target_status` = NEW.`publication_status`
      AND op.`applied_at` IS NULL
  ) THEN RAISE(ABORT, 'missing_or_stale_answer_card_workflow') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_answer_cards_record_visibility_workflow`
AFTER UPDATE OF `publication_status` ON `answer_cards`
WHEN NEW.`publication_status` IS NOT OLD.`publication_status`
  AND NEW.`current_public_revision_id` IS OLD.`current_public_revision_id`
BEGIN
  UPDATE `workflow_operations` SET `applied_at` = unixepoch()
  WHERE `id` = NEW.`last_workflow_operation_id`;

  INSERT INTO `audit_events` (
    `id`, `actor_id`, `action`, `target_type`, `target_id`, `reason`,
    `request_id`, `metadata_json`, `created_at`
  )
  SELECT
    'audit-' || op.`id`, op.`actor_id`,
    CASE WHEN NEW.`publication_status` = 'hidden'
      THEN 'answer_card.hide' ELSE 'answer_card.restore' END,
    'answer_card', NEW.`id`, op.`reason`, op.`request_id`,
    json_object('status', NEW.`publication_status`, 'lock_version', NEW.`lock_version`),
    unixepoch()
  FROM `workflow_operations` op
  WHERE op.`id` = NEW.`last_workflow_operation_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_reports_validate_workflow`
BEFORE UPDATE OF `status` ON `reports`
WHEN NEW.`status` IS NOT OLD.`status`
BEGIN
  SELECT CASE WHEN NOT (
    (OLD.`status` = 'received' AND NEW.`status` IN ('reviewing', 'resolved', 'closed'))
    OR (OLD.`status` = 'reviewing' AND NEW.`status` IN ('resolved', 'closed'))
  ) THEN RAISE(ABORT, 'invalid_report_status_transition') END;

  SELECT CASE WHEN NEW.`lock_version` != OLD.`lock_version` + 1
    THEN RAISE(ABORT, 'invalid_report_workflow_version') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `workflow_operations` op
    WHERE op.`id` = NEW.`last_workflow_operation_id`
      AND op.`target_type` = 'report'
      AND op.`target_id` = OLD.`id`
      AND op.`expected_version` = OLD.`lock_version`
      AND op.`target_status` = NEW.`status`
      AND op.`applied_at` IS NULL
  ) THEN RAISE(ABORT, 'missing_or_stale_report_workflow') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_reports_record_workflow`
AFTER UPDATE OF `status` ON `reports`
WHEN NEW.`status` IS NOT OLD.`status`
BEGIN
  UPDATE `workflow_operations` SET `applied_at` = unixepoch()
  WHERE `id` = NEW.`last_workflow_operation_id`;

  INSERT INTO `audit_events` (
    `id`, `actor_id`, `action`, `target_type`, `target_id`, `reason`,
    `request_id`, `metadata_json`, `created_at`
  )
  SELECT 'audit-' || op.`id`, op.`actor_id`, 'report.update', 'report',
         NEW.`id`, op.`reason`, op.`request_id`,
         json_object('status', NEW.`status`, 'lock_version', NEW.`lock_version`),
         unixepoch()
  FROM `workflow_operations` op
  WHERE op.`id` = NEW.`last_workflow_operation_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_research_intakes_validate_expiry_purge`
BEFORE UPDATE OF `status` ON `research_intakes`
WHEN NEW.`status` = 'expired' AND NEW.`status` IS NOT OLD.`status`
BEGIN
  SELECT CASE WHEN NEW.`expires_at` > unixepoch()
    OR NEW.`purged_at` IS NULL
    OR NEW.`participant_ref_hash` != 'purged'
    OR NEW.`body` IS NOT NULL
    OR NEW.`source_url` IS NOT NULL
    OR NEW.`provenance_role` IS NOT NULL
    THEN RAISE(ABORT, 'invalid_research_intake_expiry_purge') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_research_intakes_validate_workflow`
BEFORE UPDATE OF `status` ON `research_intakes`
WHEN NEW.`status` IS NOT OLD.`status` AND NEW.`status` != 'expired'
BEGIN
  SELECT CASE WHEN NOT (
    (OLD.`status` = 'submitted' AND NEW.`status` IN ('screening', 'rejected'))
    OR (OLD.`status` = 'screening' AND NEW.`status` IN ('actioned', 'rejected'))
  ) THEN RAISE(ABORT, 'invalid_research_intake_status_transition') END;

  SELECT CASE WHEN OLD.`purged_at` IS NOT NULL OR OLD.`expires_at` <= unixepoch()
    THEN RAISE(ABORT, 'research_intake_expired') END;

  SELECT CASE WHEN NEW.`lock_version` != OLD.`lock_version` + 1
    THEN RAISE(ABORT, 'invalid_research_intake_workflow_version') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `workflow_operations` op
    WHERE op.`id` = NEW.`last_workflow_operation_id`
      AND op.`target_type` = 'research_intake'
      AND op.`target_id` = OLD.`id`
      AND op.`expected_version` = OLD.`lock_version`
      AND op.`target_status` = NEW.`status`
      AND op.`applied_at` IS NULL
  ) THEN RAISE(ABORT, 'missing_or_stale_research_intake_workflow') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_research_intakes_record_workflow`
AFTER UPDATE OF `status` ON `research_intakes`
WHEN NEW.`status` IS NOT OLD.`status` AND NEW.`status` != 'expired'
BEGIN
  UPDATE `workflow_operations` SET `applied_at` = unixepoch()
  WHERE `id` = NEW.`last_workflow_operation_id`;

  INSERT INTO `audit_events` (
    `id`, `actor_id`, `action`, `target_type`, `target_id`, `reason`,
    `request_id`, `metadata_json`, `created_at`
  )
  SELECT 'audit-' || op.`id`, op.`actor_id`, 'research_intake.update',
         'research_intake', NEW.`id`, op.`reason`, op.`request_id`,
         json_object('status', NEW.`status`, 'lock_version', NEW.`lock_version`),
         unixepoch()
  FROM `workflow_operations` op
  WHERE op.`id` = NEW.`last_workflow_operation_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_high_risk_answer_card_publish_disabled`
BEFORE UPDATE OF `current_public_revision_id` ON `answer_cards`
WHEN NEW.`current_public_revision_id` IS NOT OLD.`current_public_revision_id`
  AND OLD.`risk_level` = 'high'
BEGIN
  SELECT RAISE(ABORT, 'high_risk_publishing_disabled');
END;
--> statement-breakpoint
PRAGMA optimize;
