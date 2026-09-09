DROP TRIGGER `trg_pilot_invitation_monotonic`;--> statement-breakpoint
CREATE TRIGGER `trg_pilot_invitation_monotonic`
BEFORE UPDATE ON `pilot_invitations`
BEGIN
  SELECT CASE WHEN NEW.`id` IS NOT OLD.`id`
    OR NEW.`participant_id` IS NOT OLD.`participant_id`
    OR NEW.`issued_by` IS NOT OLD.`issued_by`
    OR NEW.`issued_at` IS NOT OLD.`issued_at`
    OR NEW.`expires_at` IS NOT OLD.`expires_at`
    THEN RAISE(ABORT, 'pilot_invitation_core_fields_immutable') END;
  SELECT CASE WHEN OLD.`redeemed_at` IS NOT NULL
    AND NEW.`redeemed_at` IS NOT OLD.`redeemed_at`
    THEN RAISE(ABORT, 'pilot_invitation_redemption_is_monotonic') END;
  SELECT CASE WHEN OLD.`revoked_at` IS NOT NULL
    AND NEW.`revoked_at` IS NOT OLD.`revoked_at`
    THEN RAISE(ABORT, 'pilot_invitation_revocation_is_monotonic') END;
  SELECT CASE WHEN NEW.`lock_version` < OLD.`lock_version`
    THEN RAISE(ABORT, 'pilot_invitation_version_is_monotonic') END;
  SELECT CASE WHEN OLD.`redeemed_at` IS NULL AND NEW.`redeemed_at` IS NOT NULL
    AND (NEW.`revoked_at` IS NOT NULL
      OR NEW.`redeemed_at` < NEW.`issued_at`
      OR NEW.`lock_version` != OLD.`lock_version` + 1)
    THEN RAISE(ABORT, 'invalid_pilot_invitation_redemption') END;
  SELECT CASE WHEN OLD.`revoked_at` IS NULL AND NEW.`revoked_at` IS NOT NULL
    AND (NEW.`revoked_at` < NEW.`issued_at`
      OR NEW.`lock_version` != OLD.`lock_version` + 1)
    THEN RAISE(ABORT, 'invalid_pilot_invitation_revocation') END;
  SELECT CASE WHEN NEW.`token_hash` IS NOT OLD.`token_hash` AND NOT (
    NEW.`revoked_at` IS NOT NULL AND (
      (NEW.`token_hash` = 'withdrawn:' || OLD.`id` AND EXISTS (
        SELECT 1 FROM `pilot_participants` p
        WHERE p.`id` = OLD.`participant_id`
          AND p.`status` = 'withdrawn' AND p.`withdrawn_at` IS NOT NULL
      )) OR
      (NEW.`token_hash` = 'expired:' || OLD.`id` AND EXISTS (
        SELECT 1 FROM `pilot_participants` p
        WHERE p.`id` = OLD.`participant_id`
          AND p.`participant_ref_hmac` IS NULL
          AND p.`participant_hint` = 'retained'
      ))
    )
  ) THEN RAISE(ABORT, 'pilot_invitation_token_is_immutable') END;
END;--> statement-breakpoint
DROP TRIGGER `trg_reports_validate_workflow`;--> statement-breakpoint
UPDATE `reports`
SET `reviewing_at` = COALESCE(`reviewing_at`, `created_at`)
WHERE `status` = 'reviewing';--> statement-breakpoint
UPDATE `reports`
SET `reviewing_at` = COALESCE(`reviewing_at`, `created_at`),
    `resolved_at` = COALESCE(`resolved_at`, `updated_at`, `created_at`),
    `public_response` = CASE
      WHEN `public_response` IS NULL OR length(trim(`public_response`)) < 10
      THEN '历史处理记录：该报告在新版复核流程启用前已经完成。'
      ELSE `public_response`
    END
WHERE `status` IN ('resolved', 'closed');--> statement-breakpoint
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
END;--> statement-breakpoint
DROP TRIGGER `trg_query_impression_validate_revision`;--> statement-breakpoint
DROP TRIGGER `trg_answer_open_requires_impression`;--> statement-breakpoint
DROP TRIGGER `trg_feedback_requires_visible_revision`;--> statement-breakpoint
CREATE TRIGGER `trg_query_impression_validate_revision`
BEFORE INSERT ON `query_result_impressions`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `answer_card_revisions` r
    WHERE r.`id` = NEW.`card_revision_id` AND r.`card_id` = NEW.`card_id`
  ) THEN RAISE(ABORT, 'query_impression_card_revision_mismatch') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM `query_events` q
    WHERE q.`id` = NEW.`query_event_id` AND q.`principal_kind` = 'withdrawn'
  ) THEN RAISE(ABORT, 'withdrawn_query_rejects_new_events') END;
END;--> statement-breakpoint
CREATE TRIGGER `trg_answer_open_requires_impression`
BEFORE INSERT ON `answer_open_events`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `query_result_impressions` i
    WHERE i.`query_event_id` = NEW.`query_event_id`
      AND i.`card_revision_id` = NEW.`card_revision_id`
  ) THEN RAISE(ABORT, 'answer_open_requires_query_impression') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM `query_events` q
    WHERE q.`id` = NEW.`query_event_id` AND q.`principal_kind` = 'withdrawn'
  ) THEN RAISE(ABORT, 'withdrawn_query_rejects_new_events') END;
END;--> statement-breakpoint
CREATE TRIGGER `trg_feedback_requires_visible_revision`
BEFORE INSERT ON `feedback_events`
BEGIN
  SELECT CASE WHEN NEW.`query_event_id` IS NULL AND NOT EXISTS (
    SELECT 1 FROM `answer_card_revisions` r
    JOIN `answer_cards` c ON c.`id` = r.`card_id`
    WHERE r.`id` = NEW.`card_revision_id`
      AND c.`current_public_revision_id` = NEW.`card_revision_id`
      AND c.`publication_status` = 'published'
  ) THEN RAISE(ABORT, 'feedback_requires_current_public_revision') END;
  SELECT CASE WHEN NEW.`query_event_id` IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM `answer_open_events` o
    WHERE o.`query_event_id` = NEW.`query_event_id`
      AND o.`card_revision_id` = NEW.`card_revision_id`
  ) THEN RAISE(ABORT, 'feedback_requires_answer_open') END;
  SELECT CASE WHEN NEW.`query_event_id` IS NOT NULL AND EXISTS (
    SELECT 1 FROM `query_events` q
    WHERE q.`id` = NEW.`query_event_id` AND q.`principal_kind` = 'withdrawn'
  ) THEN RAISE(ABORT, 'withdrawn_query_rejects_new_events') END;
END;--> statement-breakpoint
DROP TRIGGER `trg_reports_require_pilot_or_privacy`;--> statement-breakpoint
DROP TRIGGER `trg_research_intake_requires_pilot`;--> statement-breakpoint
CREATE TRIGGER `trg_reports_require_pilot_or_privacy`
BEFORE INSERT ON `reports`
BEGIN
  SELECT CASE WHEN NEW.`type` = 'privacy'
    AND NEW.`pilot_participant_id` IS NOT NULL
    THEN RAISE(ABORT, 'privacy_report_must_be_anonymous') END;
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
CREATE TRIGGER `trg_research_intake_requires_pilot`
BEFORE INSERT ON `research_intakes`
BEGIN
  SELECT CASE WHEN NEW.`pilot_participant_id` IS NULL
    OR NEW.`participant_ref_hash` != 'managed'
    THEN RAISE(ABORT, 'research_intake_requires_pilot_session') END;
  SELECT CASE WHEN NOT EXISTS (
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
  ) THEN RAISE(ABORT, 'research_intake_requires_active_pilot_session') END;
  SELECT CASE WHEN NEW.`origin_query_event_id` IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM `query_events` q
    JOIN `pilot_sessions` s ON s.`id` = q.`pilot_session_id`
    WHERE q.`id` = NEW.`origin_query_event_id`
      AND q.`principal_kind` = 'research_participant'
      AND s.`participant_id` = NEW.`pilot_participant_id`
  ) THEN RAISE(ABORT, 'research_intake_query_participant_mismatch') END;
END;--> statement-breakpoint
PRAGMA optimize;
