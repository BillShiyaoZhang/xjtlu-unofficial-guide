DROP TRIGGER `trg_research_intake_outcome_required`;
--> statement-breakpoint
CREATE TRIGGER `trg_research_intake_outcome_required`
BEFORE UPDATE OF `status` ON `research_intakes`
WHEN NEW.`status` IN ('actioned', 'rejected') AND NEW.`status` IS NOT OLD.`status`
BEGIN
  SELECT CASE WHEN NEW.`decision_code` IS NULL
                    OR NEW.`outcome_reason` IS NULL
                    OR length(trim(NEW.`outcome_reason`)) < 8
    THEN RAISE(ABORT, 'research_intake_outcome_required') END;
  SELECT CASE WHEN NEW.`status` = 'actioned'
    AND NEW.`linked_card_id` IS NULL AND NEW.`linked_revision_id` IS NULL
    THEN RAISE(ABORT, 'research_intake_action_requires_content_link') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_backup_run_terminal_state`
BEFORE UPDATE OF `status` ON `backup_runs`
WHEN OLD.`status` IN ('succeeded', 'failed') AND NEW.`status` IS NOT OLD.`status`
BEGIN
  SELECT RAISE(ABORT, 'backup_terminal_state');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_backup_success_evidence`
BEFORE INSERT ON `backup_runs`
WHEN NEW.`status` = 'succeeded'
BEGIN
  SELECT CASE WHEN NEW.`snapshot_ref_hash` IS NULL
                    OR NEW.`checksum_sha256` IS NULL
                    OR length(NEW.`checksum_sha256`) != 64
                    OR NEW.`verified_at` IS NULL
                    OR NEW.`completed_at` IS NULL
    THEN RAISE(ABORT, 'backup_success_evidence_required') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_backup_update_success_evidence`
BEFORE UPDATE ON `backup_runs`
WHEN NEW.`status` = 'succeeded'
BEGIN
  SELECT CASE WHEN NEW.`snapshot_ref_hash` IS NULL
                    OR NEW.`checksum_sha256` IS NULL
                    OR length(NEW.`checksum_sha256`) != 64
                    OR NEW.`verified_at` IS NULL
                    OR NEW.`completed_at` IS NULL
    THEN RAISE(ABORT, 'backup_success_evidence_required') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_recovery_drill_terminal_state`
BEFORE UPDATE OF `status` ON `recovery_drills`
WHEN OLD.`status` IN ('succeeded', 'failed') AND NEW.`status` IS NOT OLD.`status`
BEGIN
  SELECT RAISE(ABORT, 'recovery_drill_terminal_state');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_recovery_drill_success_evidence`
BEFORE INSERT ON `recovery_drills`
WHEN NEW.`status` = 'succeeded'
BEGIN
  SELECT CASE WHEN NEW.`backup_run_id` IS NULL
                    OR NEW.`completed_at` IS NULL
                    OR NEW.`foreign_key_check_passed` IS NOT 1
                    OR NEW.`smoke_check_passed` IS NOT 1
    THEN RAISE(ABORT, 'recovery_success_evidence_required') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_recovery_drill_update_success_evidence`
BEFORE UPDATE ON `recovery_drills`
WHEN NEW.`status` = 'succeeded'
BEGIN
  SELECT CASE WHEN NEW.`backup_run_id` IS NULL
                    OR NEW.`completed_at` IS NULL
                    OR NEW.`foreign_key_check_passed` IS NOT 1
                    OR NEW.`smoke_check_passed` IS NOT 1
    THEN RAISE(ABORT, 'recovery_success_evidence_required') END;
END;
--> statement-breakpoint
PRAGMA optimize;
