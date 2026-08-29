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
    status: text('status').notNull().default('active'),
  },
  (table) => [
    uniqueIndex('idx_scopes_dimension_code').on(table.dimension, table.code),
    index('idx_scopes_dimension_sort').on(table.dimension, table.sortOrder),
    check(
      'applicability_scopes_status_check',
      sql`${table.status} IN ('active', 'hidden')`,
    ),
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

export const pilotParticipants = sqliteTable(
  'pilot_participants',
  {
    id: text('id').primaryKey(),
    participantRefHmac: text('participant_ref_hmac'),
    participantHint: text('participant_hint').notNull(),
    recruitmentChannel: text('recruitment_channel').notNull(),
    isTest: integer('is_test', { mode: 'boolean' }).notNull().default(false),
    adultVerifiedAt: integer('adult_verified_at').notNull(),
    adultVerifiedBy: text('adult_verified_by').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    withdrawnAt: integer('withdrawn_at'),
  },
  (table) => [
    uniqueIndex('idx_pilot_participants_ref_hmac').on(table.participantRefHmac),
    index('idx_pilot_participants_status_created').on(
      table.status,
      table.createdAt,
    ),
    check(
      'pilot_participants_channel_check',
      sql`${table.recruitmentChannel} IN ('campus', 'student_group', 'referral', 'other')`,
    ),
    check(
      'pilot_participants_status_check',
      sql`${table.status} IN ('active', 'withdrawn')`,
    ),
  ],
);

export const pilotInvitations = sqliteTable(
  'pilot_invitations',
  {
    id: text('id').primaryKey(),
    participantId: text('participant_id')
      .notNull()
      .references(() => pilotParticipants.id, { onDelete: 'restrict' }),
    tokenHash: text('token_hash').notNull(),
    issuedBy: text('issued_by').notNull(),
    issuedAt: integer('issued_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    redeemedAt: integer('redeemed_at'),
    revokedAt: integer('revoked_at'),
    revokedBy: text('revoked_by'),
    lockVersion: integer('lock_version').notNull().default(0),
  },
  (table) => [
    uniqueIndex('idx_pilot_invitations_token_hash').on(table.tokenHash),
    index('idx_pilot_invitations_participant').on(
      table.participantId,
      table.issuedAt,
    ),
    index('idx_pilot_invitations_expiry').on(table.expiresAt),
    check(
      'pilot_invitations_expiry_check',
      sql`${table.expiresAt} > ${table.issuedAt}`,
    ),
  ],
);

export const pilotConsentRecords = sqliteTable(
  'pilot_consent_records',
  {
    id: text('id').primaryKey(),
    participantId: text('participant_id')
      .notNull()
      .references(() => pilotParticipants.id, { onDelete: 'restrict' }),
    invitationId: text('invitation_id')
      .notNull()
      .references(() => pilotInvitations.id, { onDelete: 'restrict' }),
    noticeVersion: text('notice_version').notNull(),
    purpose: text('purpose').notNull(),
    separateConsent: integer('separate_consent', { mode: 'boolean' })
      .notNull()
      .default(true),
    grantedAt: integer('granted_at').notNull(),
    withdrawnAt: integer('withdrawn_at'),
  },
  (table) => [
    uniqueIndex('idx_pilot_consent_invitation').on(table.invitationId),
    index('idx_pilot_consent_participant').on(
      table.participantId,
      table.grantedAt,
    ),
    check(
      'pilot_consent_purpose_check',
      sql`${table.purpose} = 'stage1_product_research'`,
    ),
    check('pilot_consent_separate_check', sql`${table.separateConsent} = 1`),
  ],
);

export const pilotSessions = sqliteTable(
  'pilot_sessions',
  {
    id: text('id').primaryKey(),
    participantId: text('participant_id')
      .notNull()
      .references(() => pilotParticipants.id, { onDelete: 'restrict' }),
    consentId: text('consent_id')
      .notNull()
      .references(() => pilotConsentRecords.id, { onDelete: 'restrict' }),
    invitationId: text('invitation_id')
      .notNull()
      .references(() => pilotInvitations.id, { onDelete: 'restrict' }),
    tokenHash: text('token_hash').notNull(),
    issuedAt: integer('issued_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    revokedAt: integer('revoked_at'),
  },
  (table) => [
    uniqueIndex('idx_pilot_sessions_invitation').on(table.invitationId),
    uniqueIndex('idx_pilot_sessions_token_hash').on(table.tokenHash),
    index('idx_pilot_sessions_participant').on(
      table.participantId,
      table.expiresAt,
    ),
    check(
      'pilot_sessions_expiry_check',
      sql`${table.expiresAt} > ${table.issuedAt}`,
    ),
  ],
);

export const queryEvents = sqliteTable(
  'query_events',
  {
    id: text('id').primaryKey(),
    principalKind: text('principal_kind').notNull(),
    pilotSessionId: text('pilot_session_id').references(
      () => pilotSessions.id,
      { onDelete: 'set null' },
    ),
    qualified: integer('qualified', { mode: 'boolean' })
      .notNull()
      .default(false),
    qualificationRuleVersion: text('qualification_rule_version').notNull(),
    retrievalStatus: text('retrieval_status').notNull(),
    queryLengthBucket: text('query_length_bucket').notNull(),
    hasTopicFilter: integer('has_topic_filter', { mode: 'boolean' })
      .notNull()
      .default(false),
    scopeFilterCount: integer('scope_filter_count').notNull().default(0),
    resultCount: integer('result_count'),
    retrievalVersion: text('retrieval_version').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('idx_query_events_principal_created').on(
      table.principalKind,
      table.createdAt,
    ),
    index('idx_query_events_session_created').on(
      table.pilotSessionId,
      table.createdAt,
    ),
    check(
      'query_events_principal_check',
      sql`${table.principalKind} IN ('public_anonymous', 'research_participant', 'editor', 'withdrawn')`,
    ),
    check(
      'query_events_retrieval_status_check',
      sql`${table.retrievalStatus} IN ('completed', 'error')`,
    ),
    check(
      'query_events_length_bucket_check',
      sql`${table.queryLengthBucket} IN ('short', 'medium', 'long')`,
    ),
    check(
      'query_events_scope_count_check',
      sql`${table.scopeFilterCount} >= 0 AND ${table.scopeFilterCount} <= 8`,
    ),
    check(
      'query_events_result_count_check',
      sql`(${table.retrievalStatus} = 'completed' AND ${table.resultCount} IS NOT NULL AND ${table.resultCount} >= 0) OR (${table.retrievalStatus} = 'error' AND ${table.resultCount} IS NULL)`,
    ),
    check(
      'query_events_participant_check',
      sql`(${table.principalKind} = 'research_participant' AND ${table.pilotSessionId} IS NOT NULL) OR (${table.principalKind} != 'research_participant' AND ${table.pilotSessionId} IS NULL)`,
    ),
    check(
      'query_events_qualification_check',
      sql`${table.qualified} = 0 OR (${table.principalKind} = 'research_participant' AND ${table.pilotSessionId} IS NOT NULL)`,
    ),
  ],
);

export const queryResultImpressions = sqliteTable(
  'query_result_impressions',
  {
    queryEventId: text('query_event_id')
      .notNull()
      .references(() => queryEvents.id, { onDelete: 'cascade' }),
    cardId: text('card_id')
      .notNull()
      .references(() => answerCards.id, { onDelete: 'restrict' }),
    cardRevisionId: text('card_revision_id')
      .notNull()
      .references(() => answerCardRevisions.id, { onDelete: 'restrict' }),
    rank: integer('rank').notNull(),
    recordedAt: integer('recorded_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.queryEventId, table.cardRevisionId] }),
    index('idx_query_impressions_event_rank').on(
      table.queryEventId,
      table.rank,
    ),
    check('query_impressions_rank_check', sql`${table.rank} > 0`),
  ],
);

export const answerOpenEvents = sqliteTable(
  'answer_open_events',
  {
    queryEventId: text('query_event_id')
      .notNull()
      .references(() => queryEvents.id, { onDelete: 'cascade' }),
    cardRevisionId: text('card_revision_id')
      .notNull()
      .references(() => answerCardRevisions.id, { onDelete: 'restrict' }),
    openedAt: integer('opened_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.queryEventId, table.cardRevisionId] }),
    index('idx_answer_open_events_event').on(
      table.queryEventId,
      table.openedAt,
    ),
  ],
);

export const answerShareEvents = sqliteTable(
  'answer_share_events',
  {
    queryEventId: text('query_event_id')
      .notNull()
      .references(() => queryEvents.id, { onDelete: 'cascade' }),
    cardRevisionId: text('card_revision_id')
      .notNull()
      .references(() => answerCardRevisions.id, { onDelete: 'restrict' }),
    sharedAt: integer('shared_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.queryEventId, table.cardRevisionId] }),
    index('idx_answer_share_events_event').on(
      table.queryEventId,
      table.sharedAt,
    ),
  ],
);

export const feedbackEvents = sqliteTable(
  'feedback_events',
  {
    id: text('id').primaryKey(),
    cardRevisionId: text('card_revision_id')
      .notNull()
      .references(() => answerCardRevisions.id, { onDelete: 'restrict' }),
    queryEventId: text('query_event_id').references(() => queryEvents.id, {
      onDelete: 'set null',
    }),
    outcome: text('outcome').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('idx_feedback_revision_created').on(
      table.cardRevisionId,
      table.createdAt,
    ),
    index('idx_feedback_query_created').on(table.queryEventId, table.createdAt),
    uniqueIndex('idx_feedback_query_revision_unique')
      .on(table.queryEventId, table.cardRevisionId)
      .where(sql`${table.queryEventId} IS NOT NULL`),
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
    pilotParticipantId: text('pilot_participant_id').references(
      () => pilotParticipants.id,
      { onDelete: 'set null' },
    ),
    affectedArea: text('affected_area'),
    type: text('type').notNull(),
    priority: text('priority').notNull().default('standard'),
    status: text('status').notNull().default('received'),
    assigneeEditorId: text('assignee_editor_id'),
    assignedAt: integer('assigned_at'),
    slaDueAt: integer('sla_due_at'),
    decisionCode: text('decision_code'),
    resolutionCardId: text('resolution_card_id').references(
      () => answerCards.id,
      { onDelete: 'set null' },
    ),
    resolutionRevisionId: text('resolution_revision_id').references(
      () => answerCardRevisions.id,
      { onDelete: 'set null' },
    ),
    publicResponse: text('public_response'),
    lockVersion: integer('lock_version').notNull().default(0),
    lastWorkflowOperationId: text('last_workflow_operation_id'),
    createdAt: integer('created_at').notNull(),
    reviewingAt: integer('reviewing_at'),
    updatedAt: integer('updated_at').notNull().default(0),
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
      'reports_priority_check',
      sql`${table.priority} IN ('critical', 'high', 'standard')`,
    ),
    check(
      'reports_decision_check',
      sql`${table.decisionCode} IS NULL OR ${table.decisionCode} IN ('corrected', 'hidden', 'no_change', 'duplicate', 'invalid')`,
    ),
    check(
      'reports_status_check',
      sql`${table.status} IN ('received', 'reviewing', 'resolved', 'closed')`,
    ),
    check(
      'reports_affected_area_check',
      sql`${table.affectedArea} IS NULL OR ${table.affectedArea} IN ('home', 'search', 'topics', 'pilot', 'intake', 'reporting', 'other')`,
    ),
  ],
);

export const researchIntakes = sqliteTable(
  'research_intakes',
  {
    id: text('id').primaryKey(),
    participantRefHash: text('participant_ref_hash').notNull(),
    pilotParticipantId: text('pilot_participant_id').references(
      () => pilotParticipants.id,
      { onDelete: 'set null' },
    ),
    originQueryEventId: text('origin_query_event_id').references(
      () => queryEvents.id,
      { onDelete: 'set null' },
    ),
    kind: text('kind').notNull(),
    contextScope: text('context_scope').notNull(),
    body: text('body'),
    sourceUrl: text('source_url'),
    provenanceRole: text('provenance_role'),
    payloadCiphertext: text('payload_ciphertext'),
    payloadKeyVersion: integer('payload_key_version'),
    status: text('status').notNull().default('submitted'),
    assigneeEditorId: text('assignee_editor_id'),
    assignedAt: integer('assigned_at'),
    decisionCode: text('decision_code'),
    outcomeReason: text('outcome_reason'),
    linkedCardId: text('linked_card_id').references(() => answerCards.id, {
      onDelete: 'set null',
    }),
    linkedRevisionId: text('linked_revision_id').references(
      () => answerCardRevisions.id,
      { onDelete: 'set null' },
    ),
    actionedAt: integer('actioned_at'),
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
    check(
      'research_intakes_decision_check',
      sql`${table.decisionCode} IS NULL OR ${table.decisionCode} IN ('draft_created', 'linked_existing', 'rejected_out_of_scope', 'rejected_insufficient', 'duplicate')`,
    ),
  ],
);

export const caseNotes = sqliteTable(
  'case_notes',
  {
    id: text('id').primaryKey(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    authorEditorId: text('author_editor_id').notNull(),
    body: text('body').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('idx_case_notes_target').on(
      table.targetType,
      table.targetId,
      table.createdAt,
    ),
    check(
      'case_notes_target_check',
      sql`${table.targetType} IN ('report', 'research_intake')`,
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

export const editorAccounts = sqliteTable(
  'editor_accounts',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    passwordSalt: text('password_salt').notNull(),
    passwordHash: text('password_hash').notNull(),
    passwordIterations: integer('password_iterations').notNull(),
    status: text('status').notNull().default('active'),
    sessionVersion: integer('session_version').notNull().default(1),
    mustChangePassword: integer('must_change_password', { mode: 'boolean' })
      .notNull()
      .default(false),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: integer('locked_until'),
    lastLoginAt: integer('last_login_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_editor_accounts_email').on(table.email),
    index('idx_editor_accounts_status').on(table.status),
    check(
      'editor_accounts_status_check',
      sql`${table.status} IN ('active', 'disabled')`,
    ),
    check(
      'editor_accounts_iterations_check',
      sql`${table.passwordIterations} >= 600000`,
    ),
  ],
);

export const editorRoleGrants = sqliteTable(
  'editor_role_grants',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => editorAccounts.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    grantedBy: text('granted_by').notNull(),
    grantedAt: integer('granted_at').notNull(),
    revokedBy: text('revoked_by'),
    revokedAt: integer('revoked_at'),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.role] }),
    index('idx_editor_role_grants_role').on(table.role, table.revokedAt),
    check(
      'editor_role_grants_role_check',
      sql`${table.role} IN ('content_editor', 'content_reviewer', 'pilot_operator', 'safety_reviewer', 'account_admin', 'operations_admin')`,
    ),
  ],
);

export const editorTotpFactors = sqliteTable(
  'editor_totp_factors',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => editorAccounts.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    encryptedSecret: text('encrypted_secret').notNull(),
    keyVersion: integer('key_version').notNull().default(1),
    lastUsedCounter: integer('last_used_counter'),
    verifiedAt: integer('verified_at').notNull(),
    revokedAt: integer('revoked_at'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_editor_totp_account').on(table.accountId),
    index('idx_editor_totp_active').on(table.accountId, table.revokedAt),
  ],
);

export const editorRecoveryCodes = sqliteTable(
  'editor_recovery_codes',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => editorAccounts.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    createdAt: integer('created_at').notNull(),
    usedAt: integer('used_at'),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.codeHash] }),
    index('idx_editor_recovery_unused').on(table.accountId, table.usedAt),
  ],
);

export const editorSessions = sqliteTable(
  'editor_sessions',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => editorAccounts.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    sessionVersion: integer('session_version').notNull(),
    issuedAt: integer('issued_at').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
    idleExpiresAt: integer('idle_expires_at').notNull(),
    absoluteExpiresAt: integer('absolute_expires_at').notNull(),
    revokedAt: integer('revoked_at'),
    revokedBy: text('revoked_by'),
    revokeReason: text('revoke_reason'),
  },
  (table) => [
    uniqueIndex('idx_editor_sessions_token_hash').on(table.tokenHash),
    index('idx_editor_sessions_account').on(
      table.accountId,
      table.absoluteExpiresAt,
    ),
    index('idx_editor_sessions_expiry').on(
      table.idleExpiresAt,
      table.absoluteExpiresAt,
    ),
    check(
      'editor_sessions_expiry_check',
      sql`${table.absoluteExpiresAt} > ${table.issuedAt} AND ${table.idleExpiresAt} > ${table.issuedAt} AND ${table.idleExpiresAt} <= ${table.absoluteExpiresAt}`,
    ),
  ],
);

export const rateLimitWindows = sqliteTable(
  'rate_limit_windows',
  {
    scope: text('scope').notNull(),
    keyHash: text('key_hash').notNull(),
    windowStartedAt: integer('window_started_at').notNull(),
    count: integer('count').notNull().default(1),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scope, table.keyHash] }),
    index('idx_rate_limit_windows_expiry').on(table.expiresAt),
    check('rate_limit_windows_count_check', sql`${table.count} > 0`),
  ],
);

export const maintenanceRuns = sqliteTable(
  'maintenance_runs',
  {
    id: text('id').primaryKey(),
    job: text('job').notNull(),
    status: text('status').notNull(),
    startedAt: integer('started_at').notNull(),
    completedAt: integer('completed_at'),
    detailsJson: text('details_json'),
  },
  (table) => [
    index('idx_maintenance_runs_job_started').on(table.job, table.startedAt),
    check(
      'maintenance_runs_status_check',
      sql`${table.status} IN ('running', 'succeeded', 'failed')`,
    ),
  ],
);

export const artifactDispositionEvents = sqliteTable(
  'artifact_disposition_events',
  {
    id: text('id').primaryKey(),
    artifactId: text('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'restrict' }),
    previousStatus: text('previous_status').notNull(),
    newStatus: text('new_status').notNull(),
    reason: text('reason').notNull(),
    actorId: text('actor_id').notNull(),
    requestId: text('request_id').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('idx_artifact_disposition_artifact').on(
      table.artifactId,
      table.createdAt,
    ),
    uniqueIndex('idx_artifact_disposition_request').on(table.requestId),
    check(
      'artifact_disposition_previous_check',
      sql`${table.previousStatus} IN ('approved', 'under_review', 'withdrawn', 'unavailable')`,
    ),
    check(
      'artifact_disposition_new_check',
      sql`${table.newStatus} IN ('approved', 'under_review', 'withdrawn', 'unavailable')`,
    ),
  ],
);

export const backupRuns = sqliteTable(
  'backup_runs',
  {
    id: text('id').primaryKey(),
    status: text('status').notNull(),
    snapshotRefHash: text('snapshot_ref_hash'),
    checksumSha256: text('checksum_sha256'),
    startedAt: integer('started_at').notNull(),
    completedAt: integer('completed_at'),
    expiresAt: integer('expires_at'),
    verifiedAt: integer('verified_at'),
    detailsJson: text('details_json'),
  },
  (table) => [
    index('idx_backup_runs_started').on(table.startedAt),
    check(
      'backup_runs_status_check',
      sql`${table.status} IN ('running', 'succeeded', 'failed')`,
    ),
  ],
);

export const recoveryDrills = sqliteTable(
  'recovery_drills',
  {
    id: text('id').primaryKey(),
    backupRunId: text('backup_run_id').references(() => backupRuns.id, {
      onDelete: 'restrict',
    }),
    status: text('status').notNull(),
    startedAt: integer('started_at').notNull(),
    completedAt: integer('completed_at'),
    foreignKeyCheckPassed: integer('foreign_key_check_passed', {
      mode: 'boolean',
    }),
    smokeCheckPassed: integer('smoke_check_passed', { mode: 'boolean' }),
    detailsJson: text('details_json'),
  },
  (table) => [
    index('idx_recovery_drills_started').on(table.startedAt),
    check(
      'recovery_drills_status_check',
      sql`${table.status} IN ('running', 'succeeded', 'failed')`,
    ),
  ],
);
