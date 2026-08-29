import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const topics = sqliteTable(
  'topics',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    titleZh: text('title_zh').notNull(),
    titleEn: text('title_en'),
    description: text('description').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_topics_slug').on(table.slug),
    check('topics_status_check', sql`${table.status} IN ('active', 'hidden')`),
  ],
);

export const topicAliases = sqliteTable(
  'topic_aliases',
  {
    topicId: text('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
    language: text('language').notNull(),
    normalizedAlias: text('normalized_alias').notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.topicId, table.language, table.normalizedAlias],
    }),
    index('idx_topic_aliases_alias').on(table.normalizedAlias),
  ],
);

export const applicabilityScopes = sqliteTable(
  'applicability_scopes',
  {
    id: text('id').primaryKey(),
    dimension: text('dimension').notNull(),
    code: text('code').notNull(),
    labelZh: text('label_zh').notNull(),
    labelEn: text('label_en'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [
    uniqueIndex('idx_scopes_dimension_code').on(table.dimension, table.code),
    index('idx_scopes_dimension_sort').on(table.dimension, table.sortOrder),
  ],
);

export const publishers = sqliteTable(
  'publishers',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    nameZh: text('name_zh').notNull(),
    nameEn: text('name_en'),
    canonicalUrl: text('canonical_url'),
    verificationStatus: text('verification_status')
      .notNull()
      .default('unverified'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    check(
      'publishers_verification_status_check',
      sql`${table.verificationStatus} IN ('unverified', 'platform_owned', 'source_verified')`,
    ),
  ],
);

export const artifacts = sqliteTable(
  'artifacts',
  {
    id: text('id').primaryKey(),
    publisherId: text('publisher_id')
      .notNull()
      .references(() => publishers.id, { onDelete: 'restrict' }),
    type: text('type').notNull(),
    canonicalUrl: text('canonical_url').notNull(),
    moderationStatus: text('moderation_status').notNull().default('approved'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_artifacts_canonical_url').on(table.canonicalUrl),
    index('idx_artifacts_publisher').on(table.publisherId),
  ],
);

export const artifactRevisions = sqliteTable(
  'artifact_revisions',
  {
    id: text('id').primaryKey(),
    artifactId: text('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'restrict' }),
    publishedAt: integer('published_at'),
    capturedAt: integer('captured_at').notNull(),
    recordedAt: integer('recorded_at').notNull(),
    visibility: text('visibility').notNull().default('public'),
    rightsMode: text('rights_mode').notNull(),
    rightsExpiresAt: integer('rights_expires_at'),
    contentHash: text('content_hash'),
    archivedText: text('archived_text'),
  },
  (table) => [
    index('idx_artifact_revisions_artifact').on(
      table.artifactId,
      table.capturedAt,
    ),
    check(
      'artifact_revisions_visibility_check',
      sql`${table.visibility} IN ('public', 'restricted', 'withdrawn')`,
    ),
    check(
      'artifact_revisions_rights_mode_check',
      sql`${table.rightsMode} IN ('link_only', 'quote_allowed', 'snapshot_allowed')`,
    ),
    check(
      'artifact_revisions_link_only_storage_check',
      sql`${table.rightsMode} != 'link_only' OR (${table.contentHash} IS NULL AND ${table.archivedText} IS NULL)`,
    ),
  ],
);

export const evidenceSpans = sqliteTable(
  'evidence_spans',
  {
    id: text('id').primaryKey(),
    artifactRevisionId: text('artifact_revision_id')
      .notNull()
      .references(() => artifactRevisions.id, { onDelete: 'restrict' }),
    locatorKind: text('locator_kind').notNull(),
    locatorValue: text('locator_value').notNull(),
    quote: text('quote').notNull(),
    spanHash: text('span_hash').notNull(),
    visibility: text('visibility').notNull().default('public'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('idx_evidence_spans_revision').on(table.artifactRevisionId),
    check(
      'evidence_spans_visibility_check',
      sql`${table.visibility} IN ('public', 'restricted', 'withdrawn')`,
    ),
  ],
);

export const linkCitations = sqliteTable(
  'link_citations',
  {
    id: text('id').primaryKey(),
    artifactRevisionId: text('artifact_revision_id')
      .notNull()
      .references(() => artifactRevisions.id, { onDelete: 'restrict' }),
    url: text('url').notNull(),
    title: text('title').notNull(),
    publishedAt: integer('published_at'),
    accessedAt: integer('accessed_at').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('idx_link_citations_revision').on(table.artifactRevisionId),
  ],
);

export const answerCards = sqliteTable(
  'answer_cards',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    topicId: text('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'restrict' }),
    publicationStatus: text('publication_status')
      .notNull()
      .default('unpublished'),
    riskLevel: text('risk_level').notNull().default('low'),
    currentPublicRevisionId: text('current_public_revision_id'),
    lockVersion: integer('lock_version').notNull().default(0),
    lastPublishOperationId: text('last_publish_operation_id'),
    lastWorkflowOperationId: text('last_workflow_operation_id'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_answer_cards_slug').on(table.slug),
    index('idx_answer_cards_topic_status').on(
      table.topicId,
      table.publicationStatus,
    ),
    index('idx_answer_cards_current_revision').on(
      table.currentPublicRevisionId,
    ),
    check(
      'answer_cards_publication_status_check',
      sql`${table.publicationStatus} IN ('unpublished', 'published', 'hidden', 'tombstoned')`,
    ),
    check(
      'answer_cards_risk_level_check',
      sql`${table.riskLevel} IN ('low', 'high')`,
    ),
  ],
);

export const answerCardRevisions = sqliteTable(
  'answer_card_revisions',
  {
    id: text('id').primaryKey(),
    cardId: text('card_id')
      .notNull()
      .references(() => answerCards.id, { onDelete: 'restrict' }),
    parentRevisionId: text('parent_revision_id'),
    versionNumber: integer('version_number').notNull(),
    expectedCardVersion: integer('expected_card_version').notNull(),
    locale: text('locale').notNull().default('zh-CN'),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    searchText: text('search_text').notNull(),
    scopeMode: text('scope_mode').notNull(),
    asOf: text('as_of').notNull(),
    verifiedAt: integer('verified_at').notNull(),
    reviewDueAt: integer('review_due_at').notNull(),
    reviewOwnerId: text('review_owner_id').notNull(),
    reviewOwnerLabel: text('review_owner_label').notNull(),
    generationType: text('generation_type').notNull().default('human'),
    evidenceCoverage: text('evidence_coverage').notNull(),
    disputeStatus: text('dispute_status').notNull().default('none'),
    evidenceNote: text('evidence_note'),
    editorId: text('editor_id').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_card_revisions_version').on(
      table.cardId,
      table.versionNumber,
    ),
    index('idx_card_revisions_card_created').on(table.cardId, table.createdAt),
    index('idx_card_revisions_review_due').on(table.reviewDueAt),
    check(
      'answer_card_revisions_scope_mode_check',
      sql`${table.scopeMode} IN ('universal', 'constrained', 'unknown')`,
    ),
    check(
      'answer_card_revisions_generation_type_check',
      sql`${table.generationType} IN ('human', 'ai_draft')`,
    ),
    check(
      'answer_card_revisions_evidence_coverage_check',
      sql`${table.evidenceCoverage} IN ('linked_only', 'partial_archived', 'fully_archived')`,
    ),
    check(
      'answer_card_revisions_dispute_status_check',
      sql`${table.disputeStatus} IN ('none', 'reported', 'confirmed')`,
    ),
  ],
);

export const answerCardRevisionScopes = sqliteTable(
  'answer_card_revision_scopes',
  {
    cardRevisionId: text('card_revision_id')
      .notNull()
      .references(() => answerCardRevisions.id, { onDelete: 'restrict' }),
    scopeId: text('scope_id')
      .notNull()
      .references(() => applicabilityScopes.id, { onDelete: 'restrict' }),
  },
  (table) => [
    primaryKey({ columns: [table.cardRevisionId, table.scopeId] }),
    index('idx_card_revision_scopes_scope').on(
      table.scopeId,
      table.cardRevisionId,
    ),
  ],
);

export const answerCardRevisionSentences = sqliteTable(
  'answer_card_revision_sentences',
  {
    cardRevisionId: text('card_revision_id')
      .notNull()
      .references(() => answerCardRevisions.id, { onDelete: 'restrict' }),
    sentenceKey: text('sentence_key').notNull(),
    ordinal: integer('ordinal').notNull(),
    text: text('text').notNull(),
    isFactual: integer('is_factual', { mode: 'boolean' })
      .notNull()
      .default(true),
  },
  (table) => [
    primaryKey({ columns: [table.cardRevisionId, table.sentenceKey] }),
    uniqueIndex('idx_card_revision_sentences_ordinal').on(
      table.cardRevisionId,
      table.ordinal,
    ),
  ],
);

export const answerCardSentenceCitations = sqliteTable(
  'answer_card_sentence_citations',
  {
    cardRevisionId: text('card_revision_id').notNull(),
    sentenceKey: text('sentence_key').notNull(),
    ordinal: integer('ordinal').notNull(),
    evidenceSpanId: text('evidence_span_id').references(
      () => evidenceSpans.id,
      {
        onDelete: 'restrict',
      },
    ),
    linkCitationId: text('link_citation_id').references(
      () => linkCitations.id,
      {
        onDelete: 'restrict',
      },
    ),
  },
  (table) => [
    primaryKey({
      columns: [table.cardRevisionId, table.sentenceKey, table.ordinal],
    }),
    foreignKey({
      columns: [table.cardRevisionId, table.sentenceKey],
      foreignColumns: [
        answerCardRevisionSentences.cardRevisionId,
        answerCardRevisionSentences.sentenceKey,
      ],
      name: 'fk_sentence_citation_sentence',
    }).onDelete('restrict'),
    check(
      'answer_card_sentence_citations_exactly_one_source_check',
      sql`((${table.evidenceSpanId} IS NOT NULL AND ${table.linkCitationId} IS NULL) OR (${table.evidenceSpanId} IS NULL AND ${table.linkCitationId} IS NOT NULL))`,
    ),
  ],
);

export const publishOperations = sqliteTable(
  'publish_operations',
  {
    id: text('id').primaryKey(),
    cardId: text('card_id')
      .notNull()
      .references(() => answerCards.id, { onDelete: 'restrict' }),
    revisionId: text('revision_id')
      .notNull()
      .references(() => answerCardRevisions.id, { onDelete: 'restrict' }),
    expectedCardVersion: integer('expected_card_version').notNull(),
    reviewerId: text('reviewer_id').notNull(),
    reason: text('reason').notNull(),
    requestId: text('request_id').notNull(),
    createdAt: integer('created_at').notNull(),
    appliedAt: integer('applied_at'),
  },
  (table) => [
    index('idx_publish_operations_card').on(table.cardId, table.createdAt),
    uniqueIndex('idx_publish_operations_request').on(table.requestId),
  ],
);

export const feedbackEvents = sqliteTable(
  'feedback_events',
  {
    id: text('id').primaryKey(),
    cardRevisionId: text('card_revision_id')
      .notNull()
      .references(() => answerCardRevisions.id, { onDelete: 'restrict' }),
    outcome: text('outcome').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('idx_feedback_revision_created').on(
      table.cardRevisionId,
      table.createdAt,
    ),
    check(
      'feedback_outcome_check',
      sql`${table.outcome} IN ('resolved', 'unclear')`,
    ),
  ],
);

export const reports = sqliteTable(
  'reports',
  {
    id: text('id').primaryKey(),
    publicCode: text('public_code').notNull(),
    targetCardId: text('target_card_id').references(() => answerCards.id, {
      onDelete: 'restrict',
    }),
    type: text('type').notNull(),
    status: text('status').notNull().default('received'),
    publicResponse: text('public_response'),
    lockVersion: integer('lock_version').notNull().default(0),
    lastWorkflowOperationId: text('last_workflow_operation_id'),
    createdAt: integer('created_at').notNull(),
    resolvedAt: integer('resolved_at'),
  },
  (table) => [
    uniqueIndex('idx_reports_public_code').on(table.publicCode),
    index('idx_reports_status_created').on(table.status, table.createdAt),
    check(
      'reports_type_check',
      sql`${table.type} IN ('stale', 'scope_error', 'source_mismatch', 'privacy')`,
    ),
    check(
      'reports_status_check',
      sql`${table.status} IN ('received', 'reviewing', 'resolved', 'closed')`,
    ),
  ],
);

export const researchIntakes = sqliteTable(
  'research_intakes',
  {
    id: text('id').primaryKey(),
    participantRefHash: text('participant_ref_hash').notNull(),
    kind: text('kind').notNull(),
    contextScope: text('context_scope').notNull(),
    body: text('body'),
    sourceUrl: text('source_url'),
    provenanceRole: text('provenance_role'),
    status: text('status').notNull().default('submitted'),
    lockVersion: integer('lock_version').notNull().default(0),
    lastWorkflowOperationId: text('last_workflow_operation_id'),
    submittedAt: integer('submitted_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    purgedAt: integer('purged_at'),
  },
  (table) => [
    index('idx_research_intakes_status_expires').on(
      table.status,
      table.expiresAt,
    ),
    check(
      'research_intakes_kind_check',
      sql`${table.kind} IN ('question', 'material')`,
    ),
    check(
      'research_intakes_status_check',
      sql`${table.status} IN ('submitted', 'screening', 'actioned', 'rejected', 'expired')`,
    ),
  ],
);

export const workflowOperations = sqliteTable(
  'workflow_operations',
  {
    id: text('id').primaryKey(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    expectedVersion: integer('expected_version').notNull(),
    targetStatus: text('target_status').notNull(),
    actorId: text('actor_id').notNull(),
    reason: text('reason').notNull(),
    requestId: text('request_id').notNull(),
    createdAt: integer('created_at').notNull(),
    appliedAt: integer('applied_at'),
  },
  (table) => [
    uniqueIndex('idx_workflow_operations_request').on(table.requestId),
    index('idx_workflow_operations_target').on(
      table.targetType,
      table.targetId,
      table.createdAt,
    ),
    check(
      'workflow_operations_target_type_check',
      sql`${table.targetType} IN ('answer_card', 'report', 'research_intake')`,
    ),
  ],
);

export const auditEvents = sqliteTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    actorId: text('actor_id').notNull(),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    reason: text('reason').notNull(),
    requestId: text('request_id').notNull(),
    metadataJson: text('metadata_json'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('idx_audit_events_created').on(table.createdAt),
    index('idx_audit_events_target').on(table.targetType, table.targetId),
  ],
);

export const idempotencyRecords = sqliteTable(
  'idempotency_records',
  {
    actorScope: text('actor_scope').notNull(),
    route: text('route').notNull(),
    keyHash: text('key_hash').notNull(),
    requestHash: text('request_hash').notNull(),
    statusCode: integer('status_code').notNull(),
    responseJson: text('response_json').notNull(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.actorScope, table.route, table.keyHash] }),
    index('idx_idempotency_records_expires').on(table.expiresAt),
  ],
);
