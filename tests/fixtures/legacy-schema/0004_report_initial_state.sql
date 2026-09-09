CREATE TRIGGER `trg_reports_validate_insert`
BEFORE INSERT ON `reports`
WHEN NEW.`status` != 'received'
  OR NEW.`public_response` IS NOT NULL
  OR NEW.`reviewing_at` IS NOT NULL
  OR NEW.`resolved_at` IS NOT NULL
  OR NEW.`lock_version` != 0
  OR NEW.`last_workflow_operation_id` IS NOT NULL
  OR NEW.`updated_at` != NEW.`created_at`
BEGIN
  SELECT RAISE(ABORT, 'invalid_report_initial_state');
END;
--> statement-breakpoint
PRAGMA optimize;
