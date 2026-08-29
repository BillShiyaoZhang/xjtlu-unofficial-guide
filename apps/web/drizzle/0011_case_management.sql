ALTER TABLE `reports` ADD `priority` text DEFAULT 'standard' NOT NULL
  CONSTRAINT `reports_priority_check`
  CHECK (`priority` IN ('critical', 'high', 'standard'));
--> statement-breakpoint
ALTER TABLE `reports` ADD `assignee_editor_id` text;
--> statement-breakpoint
ALTER TABLE `reports` ADD `assigned_at` integer;
--> statement-breakpoint
ALTER TABLE `reports` ADD `sla_due_at` integer;
--> statement-breakpoint
ALTER TABLE `reports` ADD `decision_code` text
  CONSTRAINT `reports_decision_check`
  CHECK (`decision_code` IS NULL OR `decision_code` IN
    ('corrected', 'hidden', 'no_change', 'duplicate', 'invalid'));
--> statement-breakpoint
ALTER TABLE `reports` ADD `resolution_card_id` text
  REFERENCES `answer_cards`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `reports` ADD `resolution_revision_id` text
  REFERENCES `answer_card_revisions`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
UPDATE `reports`
SET `priority` = CASE
      WHEN `type` = 'privacy' THEN 'critical'
      WHEN `type` = 'source_mismatch' THEN 'high'
      ELSE 'standard' END,
    `sla_due_at` = `created_at` + CASE
      WHEN `type` = 'privacy' THEN 3600
      WHEN `type` = 'source_mismatch' THEN 86400
      ELSE 259200 END
WHERE `sla_due_at` IS NULL;
--> statement-breakpoint
ALTER TABLE `research_intakes` ADD `assignee_editor_id` text;
--> statement-breakpoint
ALTER TABLE `research_intakes` ADD `assigned_at` integer;
--> statement-breakpoint
ALTER TABLE `research_intakes` ADD `decision_code` text
  CONSTRAINT `research_intakes_decision_check`
  CHECK (`decision_code` IS NULL OR `decision_code` IN
    ('draft_created', 'linked_existing', 'rejected_out_of_scope',
     'rejected_insufficient', 'duplicate'));
--> statement-breakpoint
ALTER TABLE `research_intakes` ADD `outcome_reason` text;
--> statement-breakpoint
ALTER TABLE `research_intakes` ADD `linked_card_id` text
  REFERENCES `answer_cards`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `research_intakes` ADD `linked_revision_id` text
  REFERENCES `answer_card_revisions`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `research_intakes` ADD `actioned_at` integer;
--> statement-breakpoint
CREATE TABLE `case_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`author_editor_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `case_notes_target_check` CHECK(`target_type` IN ('report', 'research_intake'))
);
--> statement-breakpoint
CREATE INDEX `idx_case_notes_target` ON `case_notes` (`target_type`,`target_id`,`created_at`);
--> statement-breakpoint
CREATE TRIGGER `trg_reports_resolution_requires_decision`
BEFORE UPDATE OF `status` ON `reports`
WHEN NEW.`status` IN ('resolved', 'closed') AND NEW.`status` IS NOT OLD.`status`
BEGIN
  SELECT CASE WHEN NEW.`decision_code` IS NULL
    THEN RAISE(ABORT, 'report_resolution_requires_decision') END;
  SELECT CASE WHEN NEW.`decision_code` = 'corrected'
    AND NEW.`resolution_revision_id` IS NULL
    THEN RAISE(ABORT, 'report_correction_requires_revision') END;
  SELECT CASE WHEN NEW.`decision_code` = 'hidden'
    AND NEW.`resolution_card_id` IS NULL
    THEN RAISE(ABORT, 'report_hide_requires_card') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_research_intake_outcome_required`
BEFORE UPDATE OF `status` ON `research_intakes`
WHEN NEW.`status` IN ('actioned', 'rejected') AND NEW.`status` IS NOT OLD.`status`
BEGIN
  SELECT CASE WHEN NEW.`decision_code` IS NULL OR length(trim(NEW.`outcome_reason`)) < 8
    THEN RAISE(ABORT, 'research_intake_outcome_required') END;
  SELECT CASE WHEN NEW.`status` = 'actioned'
    AND NEW.`linked_card_id` IS NULL AND NEW.`linked_revision_id` IS NULL
    THEN RAISE(ABORT, 'research_intake_action_requires_content_link') END;
END;
--> statement-breakpoint
PRAGMA optimize;
