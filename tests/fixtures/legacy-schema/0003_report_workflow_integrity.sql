ALTER TABLE `reports` ADD `reviewing_at` integer;
--> statement-breakpoint
ALTER TABLE `reports` ADD `updated_at` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `reports` SET `updated_at` = `created_at` WHERE `updated_at` = 0;
--> statement-breakpoint
UPDATE `reports`
SET `reviewing_at` = COALESCE(`reviewing_at`, `created_at`)
WHERE `status` = 'reviewing';
--> statement-breakpoint
UPDATE `reports`
SET `reviewing_at` = COALESCE(`reviewing_at`, `created_at`),
    `resolved_at` = COALESCE(`resolved_at`, `updated_at`, `created_at`),
    `public_response` = CASE
      WHEN `public_response` IS NULL OR length(trim(`public_response`)) < 10
      THEN '历史处理记录：该报告在新版复核流程启用前已经完成。'
      ELSE `public_response`
    END
WHERE `status` IN ('resolved', 'closed');
--> statement-breakpoint
DROP TRIGGER `trg_reports_validate_workflow`;
--> statement-breakpoint
DROP TRIGGER `trg_reports_record_workflow`;
--> statement-breakpoint
CREATE TRIGGER `trg_reports_core_fields_immutable`
BEFORE UPDATE ON `reports`
WHEN NEW.`public_code` IS NOT OLD.`public_code`
  OR NEW.`target_card_id` IS NOT OLD.`target_card_id`
  OR NEW.`type` IS NOT OLD.`type`
  OR NEW.`created_at` IS NOT OLD.`created_at`
BEGIN
  SELECT RAISE(ABORT, 'report_core_fields_are_immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_reports_validate_workflow`
BEFORE UPDATE OF `status`, `public_response`, `reviewing_at`, `updated_at`,
  `resolved_at`, `lock_version`, `last_workflow_operation_id` ON `reports`
WHEN NEW.`status` IS NOT OLD.`status`
  OR NEW.`public_response` IS NOT OLD.`public_response`
  OR NEW.`reviewing_at` IS NOT OLD.`reviewing_at`
  OR NEW.`updated_at` IS NOT OLD.`updated_at`
  OR NEW.`resolved_at` IS NOT OLD.`resolved_at`
  OR NEW.`lock_version` IS NOT OLD.`lock_version`
  OR NEW.`last_workflow_operation_id` IS NOT OLD.`last_workflow_operation_id`
BEGIN
  SELECT CASE WHEN NEW.`status` IS OLD.`status`
    THEN RAISE(ABORT, 'report_update_requires_status_change') END;

  SELECT CASE WHEN NOT (
    (OLD.`status` = 'received' AND NEW.`status` = 'reviewing')
    OR (OLD.`status` = 'reviewing' AND NEW.`status` IN ('resolved', 'closed'))
  ) THEN RAISE(ABORT, 'invalid_report_status_transition') END;

  SELECT CASE WHEN NEW.`lock_version` != OLD.`lock_version` + 1
    THEN RAISE(ABORT, 'invalid_report_workflow_version') END;

  SELECT CASE WHEN NEW.`updated_at` IS NULL OR NEW.`updated_at` < OLD.`updated_at`
    THEN RAISE(ABORT, 'invalid_report_updated_at') END;

  SELECT CASE WHEN NEW.`status` = 'reviewing' AND (
    NEW.`reviewing_at` IS NULL OR NEW.`resolved_at` IS NOT NULL
    OR NEW.`public_response` IS NOT NULL
  ) THEN RAISE(ABORT, 'invalid_report_reviewing_state') END;

  SELECT CASE WHEN NEW.`status` IN ('resolved', 'closed') AND (
    NEW.`reviewing_at` IS NULL OR NEW.`resolved_at` IS NULL
    OR NEW.`public_response` IS NULL
    OR length(trim(NEW.`public_response`)) < 10
  ) THEN RAISE(ABORT, 'report_resolution_requires_public_response') END;

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
AFTER UPDATE OF `status`, `public_response`, `reviewing_at`, `updated_at`,
  `resolved_at`, `lock_version`, `last_workflow_operation_id` ON `reports`
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
         json_object(
           'status', NEW.`status`,
           'lock_version', NEW.`lock_version`,
           'has_public_response', NEW.`public_response` IS NOT NULL
         ),
         unixepoch()
  FROM `workflow_operations` op
  WHERE op.`id` = NEW.`last_workflow_operation_id`;
END;
--> statement-breakpoint
PRAGMA optimize;
