CREATE TABLE `answer_card_revision_scopes` (
	`card_revision_id` text NOT NULL,
	`scope_id` text NOT NULL,
	PRIMARY KEY(`card_revision_id`, `scope_id`),
	FOREIGN KEY (`card_revision_id`) REFERENCES `answer_card_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`scope_id`) REFERENCES `applicability_scopes`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_card_revision_scopes_scope` ON `answer_card_revision_scopes` (`scope_id`,`card_revision_id`);--> statement-breakpoint
CREATE TABLE `answer_card_revision_sentences` (
	`card_revision_id` text NOT NULL,
	`sentence_key` text NOT NULL,
	`ordinal` integer NOT NULL,
	`text` text NOT NULL,
	`is_factual` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`card_revision_id`, `sentence_key`),
	FOREIGN KEY (`card_revision_id`) REFERENCES `answer_card_revisions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_card_revision_sentences_ordinal` ON `answer_card_revision_sentences` (`card_revision_id`,`ordinal`);--> statement-breakpoint
CREATE TABLE `answer_card_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`card_id` text NOT NULL,
	`parent_revision_id` text,
	`version_number` integer NOT NULL,
	`expected_card_version` integer NOT NULL,
	`locale` text DEFAULT 'zh-CN' NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`search_text` text NOT NULL,
	`scope_mode` text NOT NULL,
	`as_of` text NOT NULL,
	`verified_at` integer NOT NULL,
	`review_due_at` integer NOT NULL,
	`review_owner_id` text NOT NULL,
	`review_owner_label` text NOT NULL,
	`generation_type` text DEFAULT 'human' NOT NULL,
	`evidence_coverage` text NOT NULL,
	`dispute_status` text DEFAULT 'none' NOT NULL,
	`evidence_note` text,
	`editor_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `answer_cards`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "answer_card_revisions_scope_mode_check" CHECK("answer_card_revisions"."scope_mode" IN ('universal', 'constrained', 'unknown')),
	CONSTRAINT "answer_card_revisions_generation_type_check" CHECK("answer_card_revisions"."generation_type" IN ('human', 'ai_draft')),
	CONSTRAINT "answer_card_revisions_evidence_coverage_check" CHECK("answer_card_revisions"."evidence_coverage" IN ('linked_only', 'partial_archived', 'fully_archived')),
	CONSTRAINT "answer_card_revisions_dispute_status_check" CHECK("answer_card_revisions"."dispute_status" IN ('none', 'reported', 'confirmed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_card_revisions_version` ON `answer_card_revisions` (`card_id`,`version_number`);--> statement-breakpoint
CREATE INDEX `idx_card_revisions_card_created` ON `answer_card_revisions` (`card_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_card_revisions_review_due` ON `answer_card_revisions` (`review_due_at`);--> statement-breakpoint
CREATE TABLE `answer_card_sentence_citations` (
	`card_revision_id` text NOT NULL,
	`sentence_key` text NOT NULL,
	`ordinal` integer NOT NULL,
	`evidence_span_id` text,
	`link_citation_id` text,
	PRIMARY KEY(`card_revision_id`, `sentence_key`, `ordinal`),
	FOREIGN KEY (`evidence_span_id`) REFERENCES `evidence_spans`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`link_citation_id`) REFERENCES `link_citations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`card_revision_id`,`sentence_key`) REFERENCES `answer_card_revision_sentences`(`card_revision_id`,`sentence_key`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "answer_card_sentence_citations_exactly_one_source_check" CHECK((("answer_card_sentence_citations"."evidence_span_id" IS NOT NULL AND "answer_card_sentence_citations"."link_citation_id" IS NULL) OR ("answer_card_sentence_citations"."evidence_span_id" IS NULL AND "answer_card_sentence_citations"."link_citation_id" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE `answer_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`topic_id` text NOT NULL,
	`publication_status` text DEFAULT 'unpublished' NOT NULL,
	`risk_level` text DEFAULT 'low' NOT NULL,
	`current_public_revision_id` text,
	`lock_version` integer DEFAULT 0 NOT NULL,
	`last_publish_operation_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "answer_cards_publication_status_check" CHECK("answer_cards"."publication_status" IN ('unpublished', 'published', 'hidden', 'tombstoned')),
	CONSTRAINT "answer_cards_risk_level_check" CHECK("answer_cards"."risk_level" IN ('low', 'high'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_answer_cards_slug` ON `answer_cards` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_answer_cards_topic_status` ON `answer_cards` (`topic_id`,`publication_status`);--> statement-breakpoint
CREATE INDEX `idx_answer_cards_current_revision` ON `answer_cards` (`current_public_revision_id`);--> statement-breakpoint
CREATE TABLE `applicability_scopes` (
	`id` text PRIMARY KEY NOT NULL,
	`dimension` text NOT NULL,
	`code` text NOT NULL,
	`label_zh` text NOT NULL,
	`label_en` text,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_scopes_dimension_code` ON `applicability_scopes` (`dimension`,`code`);--> statement-breakpoint
CREATE INDEX `idx_scopes_dimension_sort` ON `applicability_scopes` (`dimension`,`sort_order`);--> statement-breakpoint
CREATE TABLE `artifact_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_id` text NOT NULL,
	`published_at` integer,
	`captured_at` integer NOT NULL,
	`recorded_at` integer NOT NULL,
	`visibility` text DEFAULT 'public' NOT NULL,
	`rights_mode` text NOT NULL,
	`rights_expires_at` integer,
	`content_hash` text,
	`archived_text` text,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "artifact_revisions_visibility_check" CHECK("artifact_revisions"."visibility" IN ('public', 'restricted', 'withdrawn')),
	CONSTRAINT "artifact_revisions_rights_mode_check" CHECK("artifact_revisions"."rights_mode" IN ('link_only', 'quote_allowed', 'snapshot_allowed')),
	CONSTRAINT "artifact_revisions_link_only_storage_check" CHECK("artifact_revisions"."rights_mode" != 'link_only' OR ("artifact_revisions"."content_hash" IS NULL AND "artifact_revisions"."archived_text" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `idx_artifact_revisions_artifact` ON `artifact_revisions` (`artifact_id`,`captured_at`);--> statement-breakpoint
CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`publisher_id` text NOT NULL,
	`type` text NOT NULL,
	`canonical_url` text NOT NULL,
	`moderation_status` text DEFAULT 'approved' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`publisher_id`) REFERENCES `publishers`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_artifacts_canonical_url` ON `artifacts` (`canonical_url`);--> statement-breakpoint
CREATE INDEX `idx_artifacts_publisher` ON `artifacts` (`publisher_id`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`reason` text NOT NULL,
	`request_id` text NOT NULL,
	`metadata_json` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_events_created` ON `audit_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_events_target` ON `audit_events` (`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `evidence_spans` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_revision_id` text NOT NULL,
	`locator_kind` text NOT NULL,
	`locator_value` text NOT NULL,
	`quote` text NOT NULL,
	`span_hash` text NOT NULL,
	`visibility` text DEFAULT 'public' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`artifact_revision_id`) REFERENCES `artifact_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "evidence_spans_visibility_check" CHECK("evidence_spans"."visibility" IN ('public', 'restricted', 'withdrawn'))
);
--> statement-breakpoint
CREATE INDEX `idx_evidence_spans_revision` ON `evidence_spans` (`artifact_revision_id`);--> statement-breakpoint
CREATE TABLE `feedback_events` (
	`id` text PRIMARY KEY NOT NULL,
	`card_revision_id` text NOT NULL,
	`outcome` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`card_revision_id`) REFERENCES `answer_card_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "feedback_outcome_check" CHECK("feedback_events"."outcome" IN ('resolved', 'unclear'))
);
--> statement-breakpoint
CREATE INDEX `idx_feedback_revision_created` ON `feedback_events` (`card_revision_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `idempotency_records` (
	`actor_scope` text NOT NULL,
	`route` text NOT NULL,
	`key_hash` text NOT NULL,
	`request_hash` text NOT NULL,
	`status_code` integer NOT NULL,
	`response_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`actor_scope`, `route`, `key_hash`)
);
--> statement-breakpoint
CREATE INDEX `idx_idempotency_records_expires` ON `idempotency_records` (`expires_at`);--> statement-breakpoint
CREATE TABLE `link_citations` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_revision_id` text NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`published_at` integer,
	`accessed_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`artifact_revision_id`) REFERENCES `artifact_revisions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_link_citations_revision` ON `link_citations` (`artifact_revision_id`);--> statement-breakpoint
CREATE TABLE `publish_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`card_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`expected_card_version` integer NOT NULL,
	`reviewer_id` text NOT NULL,
	`reason` text NOT NULL,
	`request_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`applied_at` integer,
	FOREIGN KEY (`card_id`) REFERENCES `answer_cards`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`revision_id`) REFERENCES `answer_card_revisions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_publish_operations_card` ON `publish_operations` (`card_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_publish_operations_request` ON `publish_operations` (`request_id`);--> statement-breakpoint
CREATE TABLE `publishers` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name_zh` text NOT NULL,
	`name_en` text,
	`canonical_url` text,
	`verification_status` text DEFAULT 'unverified' NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "publishers_verification_status_check" CHECK("publishers"."verification_status" IN ('unverified', 'platform_owned', 'source_verified'))
);
--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`public_code` text NOT NULL,
	`target_card_id` text,
	`type` text NOT NULL,
	`status` text DEFAULT 'received' NOT NULL,
	`public_response` text,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`target_card_id`) REFERENCES `answer_cards`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "reports_type_check" CHECK("reports"."type" IN ('stale', 'scope_error', 'source_mismatch', 'privacy')),
	CONSTRAINT "reports_status_check" CHECK("reports"."status" IN ('received', 'reviewing', 'resolved', 'closed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_reports_public_code` ON `reports` (`public_code`);--> statement-breakpoint
CREATE INDEX `idx_reports_status_created` ON `reports` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `research_intakes` (
	`id` text PRIMARY KEY NOT NULL,
	`participant_ref_hash` text NOT NULL,
	`kind` text NOT NULL,
	`context_scope` text NOT NULL,
	`body` text,
	`source_url` text,
	`provenance_role` text,
	`status` text DEFAULT 'submitted' NOT NULL,
	`submitted_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`purged_at` integer,
	CONSTRAINT "research_intakes_kind_check" CHECK("research_intakes"."kind" IN ('question', 'material')),
	CONSTRAINT "research_intakes_status_check" CHECK("research_intakes"."status" IN ('submitted', 'screening', 'actioned', 'rejected', 'expired'))
);
--> statement-breakpoint
CREATE INDEX `idx_research_intakes_status_expires` ON `research_intakes` (`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `topic_aliases` (
	`topic_id` text NOT NULL,
	`language` text NOT NULL,
	`normalized_alias` text NOT NULL,
	PRIMARY KEY(`topic_id`, `language`, `normalized_alias`),
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_topic_aliases_alias` ON `topic_aliases` (`normalized_alias`);--> statement-breakpoint
CREATE TABLE `topics` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title_zh` text NOT NULL,
	`title_en` text,
	`description` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "topics_status_check" CHECK("topics"."status" IN ('active', 'hidden'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_topics_slug` ON `topics` (`slug`);