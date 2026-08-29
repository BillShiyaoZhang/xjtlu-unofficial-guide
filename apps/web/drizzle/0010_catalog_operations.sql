ALTER TABLE `applicability_scopes` ADD `status` text DEFAULT 'active' NOT NULL
  CONSTRAINT `applicability_scopes_status_check`
  CHECK (`status` IN ('active', 'hidden'));
--> statement-breakpoint
CREATE TABLE `artifact_disposition_events` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_id` text NOT NULL,
	`previous_status` text NOT NULL,
	`new_status` text NOT NULL,
	`reason` text NOT NULL,
	`actor_id` text NOT NULL,
	`request_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `artifact_disposition_previous_check` CHECK(`previous_status` IN ('approved', 'under_review', 'withdrawn', 'unavailable')),
	CONSTRAINT `artifact_disposition_new_check` CHECK(`new_status` IN ('approved', 'under_review', 'withdrawn', 'unavailable'))
);
--> statement-breakpoint
CREATE INDEX `idx_artifact_disposition_artifact` ON `artifact_disposition_events` (`artifact_id`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_artifact_disposition_request` ON `artifact_disposition_events` (`request_id`);
--> statement-breakpoint
CREATE TRIGGER `trg_artifact_status_values`
BEFORE UPDATE OF `moderation_status` ON `artifacts`
WHEN NEW.`moderation_status` NOT IN ('approved', 'under_review', 'withdrawn', 'unavailable')
BEGIN
  SELECT RAISE(ABORT, 'invalid_artifact_moderation_status');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_publish_requires_approved_artifacts`
BEFORE UPDATE OF `current_public_revision_id` ON `answer_cards`
WHEN NEW.`current_public_revision_id` IS NOT OLD.`current_public_revision_id`
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM `answer_card_sentence_citations` sc
    LEFT JOIN `evidence_spans` es ON es.`id` = sc.`evidence_span_id`
    LEFT JOIN `link_citations` lc ON lc.`id` = sc.`link_citation_id`
    JOIN `artifact_revisions` ar
      ON ar.`id` = COALESCE(es.`artifact_revision_id`, lc.`artifact_revision_id`)
    JOIN `artifacts` a ON a.`id` = ar.`artifact_id`
    WHERE sc.`card_revision_id` = NEW.`current_public_revision_id`
      AND a.`moderation_status` != 'approved'
  ) THEN RAISE(ABORT, 'artifact_not_approved') END;
END;
--> statement-breakpoint
PRAGMA optimize;
