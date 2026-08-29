CREATE TRIGGER `trg_evidence_spans_require_public_rights`
BEFORE INSERT ON `evidence_spans`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `artifact_revisions` ar
    WHERE ar.`id` = NEW.`artifact_revision_id`
      AND ar.`visibility` = 'public'
      AND ar.`rights_mode` IN ('quote_allowed', 'snapshot_allowed')
      AND (ar.`rights_expires_at` IS NULL OR ar.`rights_expires_at` > unixepoch())
  ) THEN RAISE(ABORT, 'evidence_requires_public_quote_rights') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_link_citations_require_link_only`
BEFORE INSERT ON `link_citations`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `artifact_revisions` ar
    WHERE ar.`id` = NEW.`artifact_revision_id`
      AND ar.`visibility` = 'public'
      AND ar.`rights_mode` = 'link_only'
  ) THEN RAISE(ABORT, 'link_citation_requires_public_link_only_revision') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_card_revisions_validate_parent`
BEFORE INSERT ON `answer_card_revisions`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `answer_cards` c
    WHERE c.`id` = NEW.`card_id`
      AND c.`lock_version` = NEW.`expected_card_version`
      AND (
        (c.`current_public_revision_id` IS NULL AND NEW.`parent_revision_id` IS NULL)
        OR c.`current_public_revision_id` = NEW.`parent_revision_id`
      )
  ) THEN RAISE(ABORT, 'stale_card_version_or_invalid_parent') END;

  SELECT CASE WHEN NEW.`version_number` != (
    SELECT COALESCE(MAX(r.`version_number`), 0) + 1
    FROM `answer_card_revisions` r
    WHERE r.`card_id` = NEW.`card_id`
  ) THEN RAISE(ABORT, 'invalid_revision_version_number') END;

  SELECT CASE WHEN NEW.`review_due_at` <= NEW.`verified_at`
    THEN RAISE(ABORT, 'review_due_must_follow_verification') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_answer_cards_validate_publish`
BEFORE UPDATE OF `current_public_revision_id` ON `answer_cards`
WHEN NEW.`current_public_revision_id` IS NOT OLD.`current_public_revision_id`
BEGIN
  SELECT CASE WHEN NEW.`publication_status` != 'published'
    OR NEW.`lock_version` != OLD.`lock_version` + 1
    THEN RAISE(ABORT, 'invalid_publish_transition') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `publish_operations` po
    WHERE po.`id` = NEW.`last_publish_operation_id`
      AND po.`card_id` = OLD.`id`
      AND po.`revision_id` = NEW.`current_public_revision_id`
      AND po.`expected_card_version` = OLD.`lock_version`
      AND po.`applied_at` IS NULL
  ) THEN RAISE(ABORT, 'missing_or_stale_publish_operation') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `answer_card_revisions` r
    WHERE r.`id` = NEW.`current_public_revision_id`
      AND r.`card_id` = OLD.`id`
      AND r.`expected_card_version` = OLD.`lock_version`
      AND r.`generation_type` = 'human'
      AND r.`review_due_at` > unixepoch()
  ) THEN RAISE(ABORT, 'revision_not_publishable') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `answer_card_revision_sentences` s
    WHERE s.`card_revision_id` = NEW.`current_public_revision_id`
      AND s.`is_factual` = 1
  ) THEN RAISE(ABORT, 'revision_requires_factual_sentence') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM `answer_card_revision_sentences` s
    WHERE s.`card_revision_id` = NEW.`current_public_revision_id`
      AND s.`is_factual` = 1
      AND NOT EXISTS (
        SELECT 1
        FROM `answer_card_sentence_citations` sc
        WHERE sc.`card_revision_id` = s.`card_revision_id`
          AND sc.`sentence_key` = s.`sentence_key`
      )
  ) THEN RAISE(ABORT, 'factual_sentence_missing_citation') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM `answer_card_sentence_citations` sc
    JOIN `evidence_spans` es ON es.`id` = sc.`evidence_span_id`
    JOIN `artifact_revisions` ar ON ar.`id` = es.`artifact_revision_id`
    WHERE sc.`card_revision_id` = NEW.`current_public_revision_id`
      AND (
        es.`visibility` != 'public'
        OR ar.`visibility` != 'public'
        OR ar.`rights_mode` NOT IN ('quote_allowed', 'snapshot_allowed')
        OR (ar.`rights_expires_at` IS NOT NULL AND ar.`rights_expires_at` <= unixepoch())
      )
  ) THEN RAISE(ABORT, 'evidence_not_public_or_rights_expired') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM `answer_card_sentence_citations` sc
    JOIN `link_citations` lc ON lc.`id` = sc.`link_citation_id`
    JOIN `artifact_revisions` ar ON ar.`id` = lc.`artifact_revision_id`
    WHERE sc.`card_revision_id` = NEW.`current_public_revision_id`
      AND (ar.`visibility` != 'public' OR ar.`rights_mode` != 'link_only')
  ) THEN RAISE(ABORT, 'link_citation_not_public_link_only') END;

  SELECT CASE WHEN (
    SELECT r.`scope_mode`
    FROM `answer_card_revisions` r
    WHERE r.`id` = NEW.`current_public_revision_id`
  ) = 'constrained' AND NOT EXISTS (
    SELECT 1
    FROM `answer_card_revision_scopes` rs
    WHERE rs.`card_revision_id` = NEW.`current_public_revision_id`
  ) THEN RAISE(ABORT, 'constrained_revision_requires_scope') END;

  SELECT CASE WHEN (
    SELECT r.`scope_mode`
    FROM `answer_card_revisions` r
    WHERE r.`id` = NEW.`current_public_revision_id`
  ) != 'constrained' AND EXISTS (
    SELECT 1
    FROM `answer_card_revision_scopes` rs
    WHERE rs.`card_revision_id` = NEW.`current_public_revision_id`
  ) THEN RAISE(ABORT, 'universal_or_unknown_revision_cannot_have_scopes') END;

  SELECT CASE WHEN OLD.`risk_level` = 'high' AND EXISTS (
    SELECT 1
    FROM `answer_card_sentence_citations` sc
    WHERE sc.`card_revision_id` = NEW.`current_public_revision_id`
      AND sc.`link_citation_id` IS NOT NULL
  ) THEN RAISE(ABORT, 'high_risk_revision_requires_exact_evidence') END;

  SELECT CASE WHEN (
    SELECT r.`evidence_coverage`
    FROM `answer_card_revisions` r
    WHERE r.`id` = NEW.`current_public_revision_id`
  ) = 'linked_only' AND EXISTS (
    SELECT 1 FROM `answer_card_sentence_citations` sc
    WHERE sc.`card_revision_id` = NEW.`current_public_revision_id`
      AND sc.`evidence_span_id` IS NOT NULL
  ) THEN RAISE(ABORT, 'linked_only_coverage_mismatch') END;

  SELECT CASE WHEN (
    SELECT r.`evidence_coverage`
    FROM `answer_card_revisions` r
    WHERE r.`id` = NEW.`current_public_revision_id`
  ) = 'fully_archived' AND EXISTS (
    SELECT 1 FROM `answer_card_sentence_citations` sc
    WHERE sc.`card_revision_id` = NEW.`current_public_revision_id`
      AND sc.`link_citation_id` IS NOT NULL
  ) THEN RAISE(ABORT, 'fully_archived_coverage_mismatch') END;

  SELECT CASE WHEN (
    SELECT r.`evidence_coverage`
    FROM `answer_card_revisions` r
    WHERE r.`id` = NEW.`current_public_revision_id`
  ) = 'partial_archived' AND (
    NOT EXISTS (
      SELECT 1 FROM `answer_card_sentence_citations` sc
      WHERE sc.`card_revision_id` = NEW.`current_public_revision_id`
        AND sc.`evidence_span_id` IS NOT NULL
    ) OR NOT EXISTS (
      SELECT 1 FROM `answer_card_sentence_citations` sc
      WHERE sc.`card_revision_id` = NEW.`current_public_revision_id`
        AND sc.`link_citation_id` IS NOT NULL
    )
  ) THEN RAISE(ABORT, 'partial_archived_coverage_mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_answer_cards_record_publish`
AFTER UPDATE OF `current_public_revision_id` ON `answer_cards`
WHEN NEW.`current_public_revision_id` IS NOT OLD.`current_public_revision_id`
BEGIN
  UPDATE `publish_operations`
  SET `applied_at` = unixepoch()
  WHERE `id` = NEW.`last_publish_operation_id`;

  INSERT INTO `audit_events` (
    `id`, `actor_id`, `action`, `target_type`, `target_id`, `reason`,
    `request_id`, `metadata_json`, `created_at`
  )
  SELECT
    'audit-' || po.`id`, po.`reviewer_id`, 'answer_card.publish',
    'answer_card', NEW.`id`, po.`reason`, po.`request_id`,
    '{"revision_id":"' || NEW.`current_public_revision_id` || '","lock_version":' || NEW.`lock_version` || '}',
    unixepoch()
  FROM `publish_operations` po
  WHERE po.`id` = NEW.`last_publish_operation_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_feedback_requires_current_public_revision`
BEFORE INSERT ON `feedback_events`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `answer_cards` c
    WHERE c.`publication_status` = 'published'
      AND c.`current_public_revision_id` = NEW.`card_revision_id`
  ) THEN RAISE(ABORT, 'feedback_requires_current_public_revision') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_artifact_revisions_immutable_update`
BEFORE UPDATE ON `artifact_revisions`
BEGIN SELECT RAISE(ABORT, 'artifact_revisions_are_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_artifact_revisions_immutable_delete`
BEFORE DELETE ON `artifact_revisions`
BEGIN SELECT RAISE(ABORT, 'artifact_revisions_are_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_evidence_spans_immutable_update`
BEFORE UPDATE ON `evidence_spans`
BEGIN SELECT RAISE(ABORT, 'evidence_spans_are_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_evidence_spans_immutable_delete`
BEFORE DELETE ON `evidence_spans`
BEGIN SELECT RAISE(ABORT, 'evidence_spans_are_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_link_citations_immutable_update`
BEFORE UPDATE ON `link_citations`
BEGIN SELECT RAISE(ABORT, 'link_citations_are_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_link_citations_immutable_delete`
BEFORE DELETE ON `link_citations`
BEGIN SELECT RAISE(ABORT, 'link_citations_are_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_card_revisions_immutable_update`
BEFORE UPDATE ON `answer_card_revisions`
BEGIN SELECT RAISE(ABORT, 'answer_card_revisions_are_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_card_revisions_immutable_delete`
BEFORE DELETE ON `answer_card_revisions`
BEGIN SELECT RAISE(ABORT, 'answer_card_revisions_are_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_card_revision_sentences_immutable_update`
BEFORE UPDATE ON `answer_card_revision_sentences`
BEGIN SELECT RAISE(ABORT, 'answer_card_revision_sentences_are_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_card_revision_sentences_immutable_delete`
BEFORE DELETE ON `answer_card_revision_sentences`
BEGIN SELECT RAISE(ABORT, 'answer_card_revision_sentences_are_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_card_sentence_citations_immutable_update`
BEFORE UPDATE ON `answer_card_sentence_citations`
BEGIN SELECT RAISE(ABORT, 'answer_card_sentence_citations_are_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_card_sentence_citations_immutable_delete`
BEFORE DELETE ON `answer_card_sentence_citations`
BEGIN SELECT RAISE(ABORT, 'answer_card_sentence_citations_are_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_card_revision_scopes_immutable_update`
BEFORE UPDATE ON `answer_card_revision_scopes`
BEGIN SELECT RAISE(ABORT, 'answer_card_revision_scopes_are_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_card_revision_scopes_immutable_delete`
BEFORE DELETE ON `answer_card_revision_scopes`
BEGIN SELECT RAISE(ABORT, 'answer_card_revision_scopes_are_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_audit_events_immutable_update`
BEFORE UPDATE ON `audit_events`
BEGIN SELECT RAISE(ABORT, 'audit_events_are_append_only'); END;
--> statement-breakpoint
CREATE TRIGGER `trg_audit_events_immutable_delete`
BEFORE DELETE ON `audit_events`
BEGIN SELECT RAISE(ABORT, 'audit_events_are_append_only'); END;
--> statement-breakpoint
PRAGMA optimize;
