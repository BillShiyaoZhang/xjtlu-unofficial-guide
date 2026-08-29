CREATE TABLE `answer_share_events` (
	`query_event_id` text NOT NULL,
	`card_revision_id` text NOT NULL,
	`shared_at` integer NOT NULL,
	PRIMARY KEY(`query_event_id`, `card_revision_id`),
	FOREIGN KEY (`query_event_id`) REFERENCES `query_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_revision_id`) REFERENCES `answer_card_revisions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_answer_share_events_event` ON `answer_share_events` (`query_event_id`,`shared_at`);--> statement-breakpoint
ALTER TABLE `reports` ADD `affected_area` text
  CONSTRAINT `reports_affected_area_check`
  CHECK (`affected_area` IS NULL OR `affected_area` IN
    ('home', 'search', 'topics', 'pilot', 'intake', 'reporting', 'other'));--> statement-breakpoint
DROP TRIGGER `trg_reports_core_fields_immutable`;--> statement-breakpoint
CREATE TRIGGER `trg_reports_core_fields_immutable`
BEFORE UPDATE ON `reports`
WHEN NEW.`public_code` IS NOT OLD.`public_code`
  OR NEW.`target_card_id` IS NOT OLD.`target_card_id`
  OR NEW.`affected_area` IS NOT OLD.`affected_area`
  OR NEW.`type` IS NOT OLD.`type`
  OR NEW.`created_at` IS NOT OLD.`created_at`
BEGIN
  SELECT RAISE(ABORT, 'report_core_fields_are_immutable');
END;--> statement-breakpoint
DROP TRIGGER `trg_reports_require_pilot_or_privacy`;--> statement-breakpoint
CREATE TRIGGER `trg_reports_require_pilot_or_privacy`
BEFORE INSERT ON `reports`
BEGIN
  SELECT CASE WHEN NEW.`type` = 'privacy'
    AND NEW.`pilot_participant_id` IS NOT NULL
    THEN RAISE(ABORT, 'privacy_report_must_be_anonymous') END;
  SELECT CASE WHEN NEW.`type` = 'privacy' AND NEW.`target_card_id` IS NULL
    AND NEW.`affected_area` IS NULL
    THEN RAISE(ABORT, 'privacy_report_requires_affected_area') END;
  SELECT CASE WHEN NEW.`type` != 'privacy' AND NEW.`affected_area` IS NOT NULL
    THEN RAISE(ABORT, 'nonprivacy_report_rejects_affected_area') END;
  SELECT CASE WHEN NEW.`type` != 'privacy' AND NOT EXISTS (
    SELECT 1
    FROM `pilot_participants` p
    JOIN `pilot_sessions` s ON s.`participant_id` = p.`id`
    JOIN `pilot_consent_records` c ON c.`id` = s.`consent_id`
    JOIN `pilot_invitations` i ON i.`id` = s.`invitation_id`
    WHERE p.`id` = NEW.`pilot_participant_id`
      AND p.`status` = 'active' AND p.`withdrawn_at` IS NULL
      AND p.`adult_verified_at` IS NOT NULL
      AND c.`participant_id` = p.`id`
      AND c.`invitation_id` = i.`id`
      AND i.`participant_id` = p.`id`
      AND s.`revoked_at` IS NULL AND s.`expires_at` > unixepoch()
      AND c.`withdrawn_at` IS NULL AND c.`separate_consent` = 1
      AND i.`revoked_at` IS NULL
  ) THEN RAISE(ABORT, 'report_requires_active_pilot_session') END;
END;--> statement-breakpoint
CREATE TRIGGER `trg_answer_share_requires_active_query`
BEFORE INSERT ON `answer_share_events`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `answer_open_events` o
    JOIN `query_events` q ON q.`id` = o.`query_event_id`
    WHERE o.`query_event_id` = NEW.`query_event_id`
      AND o.`card_revision_id` = NEW.`card_revision_id`
      AND q.`principal_kind` != 'withdrawn'
  ) THEN RAISE(ABORT, 'answer_share_requires_active_query_open') END;
END;--> statement-breakpoint
PRAGMA optimize;
