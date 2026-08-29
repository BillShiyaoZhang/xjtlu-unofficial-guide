CREATE TABLE `answer_open_events` (
	`query_event_id` text NOT NULL,
	`card_revision_id` text NOT NULL,
	`opened_at` integer NOT NULL,
	PRIMARY KEY(`query_event_id`, `card_revision_id`),
	FOREIGN KEY (`query_event_id`) REFERENCES `query_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_revision_id`) REFERENCES `answer_card_revisions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_answer_open_events_event` ON `answer_open_events` (`query_event_id`,`opened_at`);--> statement-breakpoint
CREATE TABLE `pilot_consent_records` (
	`id` text PRIMARY KEY NOT NULL,
	`participant_id` text NOT NULL,
	`invitation_id` text NOT NULL,
	`notice_version` text NOT NULL,
	`purpose` text NOT NULL,
	`separate_consent` integer DEFAULT true NOT NULL,
	`granted_at` integer NOT NULL,
	`withdrawn_at` integer,
	FOREIGN KEY (`participant_id`) REFERENCES `pilot_participants`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`invitation_id`) REFERENCES `pilot_invitations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "pilot_consent_purpose_check" CHECK("pilot_consent_records"."purpose" = 'stage1_product_research'),
	CONSTRAINT "pilot_consent_separate_check" CHECK("pilot_consent_records"."separate_consent" = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_pilot_consent_invitation` ON `pilot_consent_records` (`invitation_id`);--> statement-breakpoint
CREATE INDEX `idx_pilot_consent_participant` ON `pilot_consent_records` (`participant_id`,`granted_at`);--> statement-breakpoint
CREATE TABLE `pilot_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`participant_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`issued_by` text NOT NULL,
	`issued_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`redeemed_at` integer,
	`revoked_at` integer,
	`revoked_by` text,
	`lock_version` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`participant_id`) REFERENCES `pilot_participants`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "pilot_invitations_expiry_check" CHECK("pilot_invitations"."expires_at" > "pilot_invitations"."issued_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_pilot_invitations_token_hash` ON `pilot_invitations` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_pilot_invitations_participant` ON `pilot_invitations` (`participant_id`,`issued_at`);--> statement-breakpoint
CREATE INDEX `idx_pilot_invitations_expiry` ON `pilot_invitations` (`expires_at`);--> statement-breakpoint
CREATE TABLE `pilot_participants` (
	`id` text PRIMARY KEY NOT NULL,
	`participant_ref_hmac` text,
	`participant_hint` text NOT NULL,
	`recruitment_channel` text NOT NULL,
	`is_test` integer DEFAULT false NOT NULL,
	`adult_verified_at` integer NOT NULL,
	`adult_verified_by` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`withdrawn_at` integer,
	CONSTRAINT "pilot_participants_channel_check" CHECK("pilot_participants"."recruitment_channel" IN ('campus', 'student_group', 'referral', 'other')),
	CONSTRAINT "pilot_participants_status_check" CHECK("pilot_participants"."status" IN ('active', 'withdrawn'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_pilot_participants_ref_hmac` ON `pilot_participants` (`participant_ref_hmac`);--> statement-breakpoint
CREATE INDEX `idx_pilot_participants_status_created` ON `pilot_participants` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `pilot_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`participant_id` text NOT NULL,
	`consent_id` text NOT NULL,
	`invitation_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`issued_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`participant_id`) REFERENCES `pilot_participants`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`consent_id`) REFERENCES `pilot_consent_records`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`invitation_id`) REFERENCES `pilot_invitations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "pilot_sessions_expiry_check" CHECK("pilot_sessions"."expires_at" > "pilot_sessions"."issued_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_pilot_sessions_invitation` ON `pilot_sessions` (`invitation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_pilot_sessions_token_hash` ON `pilot_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_pilot_sessions_participant` ON `pilot_sessions` (`participant_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `query_events` (
	`id` text PRIMARY KEY NOT NULL,
	`principal_kind` text NOT NULL,
	`pilot_session_id` text,
	`qualified` integer DEFAULT false NOT NULL,
	`qualification_rule_version` text NOT NULL,
	`retrieval_status` text NOT NULL,
	`query_length_bucket` text NOT NULL,
	`has_topic_filter` integer DEFAULT false NOT NULL,
	`scope_filter_count` integer DEFAULT 0 NOT NULL,
	`result_count` integer,
	`retrieval_version` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`pilot_session_id`) REFERENCES `pilot_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "query_events_principal_check" CHECK("query_events"."principal_kind" IN ('public_anonymous', 'research_participant', 'editor', 'withdrawn')),
	CONSTRAINT "query_events_retrieval_status_check" CHECK("query_events"."retrieval_status" IN ('completed', 'error')),
	CONSTRAINT "query_events_length_bucket_check" CHECK("query_events"."query_length_bucket" IN ('short', 'medium', 'long')),
	CONSTRAINT "query_events_scope_count_check" CHECK("query_events"."scope_filter_count" >= 0 AND "query_events"."scope_filter_count" <= 8),
	CONSTRAINT "query_events_result_count_check" CHECK(("query_events"."retrieval_status" = 'completed' AND "query_events"."result_count" IS NOT NULL AND "query_events"."result_count" >= 0) OR ("query_events"."retrieval_status" = 'error' AND "query_events"."result_count" IS NULL)),
	CONSTRAINT "query_events_participant_check" CHECK(("query_events"."principal_kind" = 'research_participant' AND "query_events"."pilot_session_id" IS NOT NULL) OR ("query_events"."principal_kind" != 'research_participant' AND "query_events"."pilot_session_id" IS NULL)),
	CONSTRAINT "query_events_qualification_check" CHECK("query_events"."qualified" = 0 OR ("query_events"."principal_kind" = 'research_participant' AND "query_events"."pilot_session_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `idx_query_events_principal_created` ON `query_events` (`principal_kind`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_query_events_session_created` ON `query_events` (`pilot_session_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `query_result_impressions` (
	`query_event_id` text NOT NULL,
	`card_id` text NOT NULL,
	`card_revision_id` text NOT NULL,
	`rank` integer NOT NULL,
	`recorded_at` integer NOT NULL,
	PRIMARY KEY(`query_event_id`, `card_revision_id`),
	FOREIGN KEY (`query_event_id`) REFERENCES `query_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `answer_cards`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`card_revision_id`) REFERENCES `answer_card_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "query_impressions_rank_check" CHECK("query_result_impressions"."rank" > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_query_impressions_event_rank` ON `query_result_impressions` (`query_event_id`,`rank`);--> statement-breakpoint
ALTER TABLE `feedback_events` ADD `query_event_id` text REFERENCES query_events(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `idx_feedback_query_created` ON `feedback_events` (`query_event_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_feedback_query_revision_unique` ON `feedback_events` (`query_event_id`,`card_revision_id`) WHERE "feedback_events"."query_event_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE `reports` ADD `pilot_participant_id` text REFERENCES pilot_participants(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `research_intakes` ADD `pilot_participant_id` text REFERENCES pilot_participants(id) ON DELETE set null;--> statement-breakpoint
DROP TRIGGER `trg_feedback_requires_current_public_revision`;--> statement-breakpoint
DROP TRIGGER `trg_audit_events_immutable_update`;--> statement-breakpoint
UPDATE `audit_events`
SET `actor_id` = 'legacy-research-purged', `metadata_json` = NULL
WHERE `actor_id` LIKE 'research:%';--> statement-breakpoint
CREATE TRIGGER `trg_audit_events_immutable_update`
BEFORE UPDATE ON `audit_events`
BEGIN SELECT RAISE(ABORT, 'audit_events_are_append_only'); END;--> statement-breakpoint
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
  SELECT CASE WHEN NEW.`token_hash` IS NOT OLD.`token_hash`
    THEN RAISE(ABORT, 'pilot_invitation_token_is_immutable') END;
END;--> statement-breakpoint
CREATE TRIGGER `trg_pilot_participant_validate_withdrawal`
BEFORE UPDATE ON `pilot_participants`
BEGIN
  SELECT CASE WHEN OLD.`status` = 'withdrawn' AND (
    NEW.`status` IS NOT OLD.`status`
    OR NEW.`participant_ref_hmac` IS NOT OLD.`participant_ref_hmac`
    OR NEW.`withdrawn_at` IS NOT OLD.`withdrawn_at`
  ) THEN RAISE(ABORT, 'pilot_participant_withdrawal_is_monotonic') END;
  SELECT CASE WHEN OLD.`status` = 'active' AND NEW.`status` = 'withdrawn'
    AND (NEW.`participant_ref_hmac` IS NOT NULL
      OR NEW.`participant_hint` != 'withdrawn'
      OR NEW.`withdrawn_at` IS NULL)
    THEN RAISE(ABORT, 'invalid_pilot_participant_withdrawal') END;
END;--> statement-breakpoint
CREATE TRIGGER `trg_pilot_invitation_revoke_sessions`
AFTER UPDATE OF `revoked_at` ON `pilot_invitations`
WHEN OLD.`revoked_at` IS NULL AND NEW.`revoked_at` IS NOT NULL
BEGIN
  UPDATE `pilot_sessions`
  SET `token_hash` = 'revoked:' || `id`,
      `revoked_at` = COALESCE(`revoked_at`, NEW.`revoked_at`)
  WHERE `invitation_id` = NEW.`id` AND `revoked_at` IS NULL;
END;--> statement-breakpoint
CREATE TRIGGER `trg_pilot_consent_validate_insert`
BEFORE INSERT ON `pilot_consent_records`
BEGIN
  SELECT CASE WHEN NEW.`separate_consent` != 1
    OR NEW.`purpose` != 'stage1_product_research'
    OR NEW.`withdrawn_at` IS NOT NULL
    THEN RAISE(ABORT, 'invalid_pilot_consent_initial_state') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `pilot_invitations` i
    JOIN `pilot_participants` p ON p.`id` = i.`participant_id`
    WHERE i.`id` = NEW.`invitation_id`
      AND i.`participant_id` = NEW.`participant_id`
      AND i.`redeemed_at` IS NOT NULL
      AND i.`revoked_at` IS NULL
      AND p.`status` = 'active'
      AND p.`adult_verified_at` IS NOT NULL
  ) THEN RAISE(ABORT, 'pilot_consent_requires_redeemed_adult_invitation') END;
END;--> statement-breakpoint
CREATE TRIGGER `trg_pilot_consent_monotonic`
BEFORE UPDATE ON `pilot_consent_records`
BEGIN
  SELECT CASE WHEN NEW.`id` IS NOT OLD.`id`
    OR NEW.`participant_id` IS NOT OLD.`participant_id`
    OR NEW.`invitation_id` IS NOT OLD.`invitation_id`
    OR NEW.`notice_version` IS NOT OLD.`notice_version`
    OR NEW.`purpose` IS NOT OLD.`purpose`
    OR NEW.`separate_consent` IS NOT OLD.`separate_consent`
    OR NEW.`granted_at` IS NOT OLD.`granted_at`
    THEN RAISE(ABORT, 'pilot_consent_core_fields_immutable') END;
  SELECT CASE WHEN OLD.`withdrawn_at` IS NOT NULL
    AND NEW.`withdrawn_at` IS NOT OLD.`withdrawn_at`
    THEN RAISE(ABORT, 'pilot_consent_withdrawal_is_monotonic') END;
END;--> statement-breakpoint
CREATE TRIGGER `trg_pilot_session_validate_insert`
BEFORE INSERT ON `pilot_sessions`
BEGIN
  SELECT CASE WHEN NEW.`revoked_at` IS NOT NULL
    THEN RAISE(ABORT, 'invalid_pilot_session_initial_state') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `pilot_invitations` i
    JOIN `pilot_consent_records` c ON c.`invitation_id` = i.`id`
    JOIN `pilot_participants` p ON p.`id` = i.`participant_id`
    WHERE i.`id` = NEW.`invitation_id`
      AND i.`participant_id` = NEW.`participant_id`
      AND c.`id` = NEW.`consent_id`
      AND c.`participant_id` = NEW.`participant_id`
      AND i.`redeemed_at` IS NOT NULL
      AND i.`revoked_at` IS NULL
      AND c.`withdrawn_at` IS NULL
      AND p.`status` = 'active'
      AND p.`adult_verified_at` IS NOT NULL
  ) THEN RAISE(ABORT, 'pilot_session_requires_active_consent') END;
END;--> statement-breakpoint
CREATE TRIGGER `trg_pilot_session_monotonic`
BEFORE UPDATE ON `pilot_sessions`
BEGIN
  SELECT CASE WHEN NEW.`id` IS NOT OLD.`id`
    OR NEW.`participant_id` IS NOT OLD.`participant_id`
    OR NEW.`consent_id` IS NOT OLD.`consent_id`
    OR NEW.`invitation_id` IS NOT OLD.`invitation_id`
    OR NEW.`issued_at` IS NOT OLD.`issued_at`
    OR NEW.`expires_at` IS NOT OLD.`expires_at`
    THEN RAISE(ABORT, 'pilot_session_core_fields_immutable') END;
  SELECT CASE WHEN OLD.`revoked_at` IS NOT NULL
    AND NEW.`revoked_at` IS NOT OLD.`revoked_at`
    THEN RAISE(ABORT, 'pilot_session_revocation_is_monotonic') END;
  SELECT CASE WHEN NEW.`token_hash` IS NOT OLD.`token_hash`
    AND NEW.`revoked_at` IS NULL
    THEN RAISE(ABORT, 'pilot_session_token_change_requires_revocation') END;
END;--> statement-breakpoint
CREATE TRIGGER `trg_pilot_participant_withdraw_children`
AFTER UPDATE OF `status` ON `pilot_participants`
WHEN OLD.`status` = 'active' AND NEW.`status` = 'withdrawn'
BEGIN
  UPDATE `pilot_consent_records`
  SET `withdrawn_at` = COALESCE(`withdrawn_at`, NEW.`withdrawn_at`)
  WHERE `participant_id` = NEW.`id`;
  UPDATE `pilot_sessions`
  SET `token_hash` = 'revoked:' || `id`,
      `revoked_at` = COALESCE(`revoked_at`, NEW.`withdrawn_at`)
  WHERE `participant_id` = NEW.`id`;
  UPDATE `pilot_invitations`
  SET `revoked_at` = COALESCE(`revoked_at`, NEW.`withdrawn_at`),
      `lock_version` = CASE WHEN `revoked_at` IS NULL
                            THEN `lock_version` + 1 ELSE `lock_version` END
  WHERE `participant_id` = NEW.`id`;
END;--> statement-breakpoint
CREATE TRIGGER `trg_query_event_validate_participant`
BEFORE INSERT ON `query_events`
WHEN NEW.`principal_kind` = 'research_participant'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `pilot_sessions` s
    JOIN `pilot_participants` p ON p.`id` = s.`participant_id`
    JOIN `pilot_consent_records` c ON c.`id` = s.`consent_id`
    JOIN `pilot_invitations` i ON i.`id` = s.`invitation_id`
    WHERE s.`id` = NEW.`pilot_session_id`
      AND s.`revoked_at` IS NULL AND s.`expires_at` > unixepoch()
      AND p.`status` = 'active' AND p.`withdrawn_at` IS NULL
      AND c.`withdrawn_at` IS NULL AND i.`revoked_at` IS NULL
  ) THEN RAISE(ABORT, 'query_event_requires_active_pilot_session') END;
  SELECT CASE WHEN NEW.`qualified` = 1 AND EXISTS (
    SELECT 1 FROM `pilot_sessions` s
    JOIN `pilot_participants` p ON p.`id` = s.`participant_id`
    WHERE s.`id` = NEW.`pilot_session_id` AND p.`is_test` = 1
  ) THEN RAISE(ABORT, 'test_participant_query_cannot_be_qualified') END;
END;--> statement-breakpoint
CREATE TRIGGER `trg_query_impression_validate_revision`
BEFORE INSERT ON `query_result_impressions`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `answer_card_revisions` r
    WHERE r.`id` = NEW.`card_revision_id` AND r.`card_id` = NEW.`card_id`
  ) THEN RAISE(ABORT, 'query_impression_card_revision_mismatch') END;
END;--> statement-breakpoint
CREATE TRIGGER `trg_answer_open_requires_impression`
BEFORE INSERT ON `answer_open_events`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `query_result_impressions` i
    WHERE i.`query_event_id` = NEW.`query_event_id`
      AND i.`card_revision_id` = NEW.`card_revision_id`
  ) THEN RAISE(ABORT, 'answer_open_requires_query_impression') END;
END;--> statement-breakpoint
CREATE TRIGGER `trg_feedback_requires_visible_revision`
BEFORE INSERT ON `feedback_events`
BEGIN
  SELECT CASE WHEN NEW.`query_event_id` IS NULL AND NOT EXISTS (
    SELECT 1
    FROM `answer_card_revisions` r
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
END;--> statement-breakpoint
CREATE TRIGGER `trg_reports_require_pilot_or_privacy`
BEFORE INSERT ON `reports`
WHEN (NEW.`type` = 'privacy' AND NEW.`pilot_participant_id` IS NOT NULL)
  OR (NEW.`type` != 'privacy' AND NEW.`pilot_participant_id` IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'report_requires_correct_pilot_scope');
END;--> statement-breakpoint
CREATE TRIGGER `trg_research_intake_requires_pilot`
BEFORE INSERT ON `research_intakes`
WHEN NEW.`pilot_participant_id` IS NULL
  OR NEW.`participant_ref_hash` != 'managed'
BEGIN
  SELECT RAISE(ABORT, 'research_intake_requires_pilot_session');
END;--> statement-breakpoint
PRAGMA optimize;
