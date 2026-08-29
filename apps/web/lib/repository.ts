import { ensureDatabase } from '@/db/bootstrap';
import { getD1 } from '@/db/index';

import {
  deriveRevisionStatus,
  rankSearchCandidate,
  type DisputeStatus,
  type EvidenceCoverage,
  type ScopeMode,
} from './domain';
import type {
  AnswerCardDetail,
  AnswerCardSummary,
  AnswerSentence,
  CitationDetail,
  EditorDashboard,
  Scope,
  TopicSummary,
} from './types';

type CardRow = {
  id: string;
  slug: string;
  topic_slug: string;
  topic_title: string;
  topic_aliases: string | null;
  title: string;
  summary: string;
  search_text: string;
  revision_id: string;
  version_number: number;
  lock_version: number;
  scope_mode: ScopeMode;
  as_of: string;
  verified_at: number;
  review_due_at: number;
  review_owner_label: string;
  evidence_coverage: EvidenceCoverage;
  dispute_status: DisputeStatus;
  evidence_note: string | null;
  risk_level: 'low' | 'high';
  source_issue: number;
};

type ScopeRow = {
  card_revision_id: string;
  id: string;
  dimension: string;
  code: string;
  label_zh: string;
  label_en: string | null;
};

export async function listTopics(): Promise<TopicSummary[]> {
  await ensureDatabase();
  const result = await getD1()
    .prepare(
      `SELECT t.id, t.slug, t.title_zh, t.title_en, t.description,
              COUNT(c.id) AS card_count
       FROM topics t
       LEFT JOIN answer_cards c
         ON c.topic_id = t.id AND c.publication_status = 'published'
       WHERE t.status = 'active'
       GROUP BY t.id, t.slug, t.title_zh, t.title_en, t.description
       ORDER BY card_count DESC, t.title_zh ASC`,
    )
    .all<{
      id: string;
      slug: string;
      title_zh: string;
      title_en: string | null;
      description: string;
      card_count: number;
    }>();

  return result.results.map((row) => ({
    id: row.id,
    slug: row.slug,
    titleZh: row.title_zh,
    titleEn: row.title_en,
    description: row.description,
    cardCount: Number(row.card_count),
  }));
}

export async function listScopes(): Promise<Scope[]> {
  await ensureDatabase();
  const result = await getD1()
    .prepare(
      `SELECT id, dimension, code, label_zh, label_en
       FROM applicability_scopes
       ORDER BY dimension ASC, sort_order ASC, label_zh ASC`,
    )
    .all<Omit<ScopeRow, 'card_revision_id'>>();
  return result.results.map(mapScope);
}

export async function searchAnswerCards(options?: {
  query?: string;
  topicSlug?: string;
  scopeIds?: string[];
  limit?: number;
}): Promise<AnswerCardSummary[]> {
  await ensureDatabase();
  const now = Math.floor(Date.now() / 1000);
  const result = await getD1()
    .prepare(
      `SELECT c.id, c.slug, c.lock_version, c.risk_level,
              t.slug AS topic_slug, t.title_zh AS topic_title,
              GROUP_CONCAT(DISTINCT ta.normalized_alias) AS topic_aliases,
              r.id AS revision_id, r.version_number, r.title,
              COALESCE((
                SELECT s.text FROM answer_card_revision_sentences s
                WHERE s.card_revision_id = r.id
                ORDER BY s.ordinal ASC LIMIT 1
              ), r.summary) AS summary,
              r.search_text, r.scope_mode, r.as_of, r.verified_at,
              r.review_due_at, r.review_owner_label, r.evidence_coverage,
              r.dispute_status, r.evidence_note,
              CASE WHEN EXISTS (
                SELECT 1
                FROM answer_card_sentence_citations sc
                LEFT JOIN evidence_spans es ON es.id = sc.evidence_span_id
                LEFT JOIN artifact_revisions ear ON ear.id = es.artifact_revision_id
                LEFT JOIN link_citations lc ON lc.id = sc.link_citation_id
                LEFT JOIN artifact_revisions lar ON lar.id = lc.artifact_revision_id
                WHERE sc.card_revision_id = r.id
                  AND (
                    (sc.evidence_span_id IS NOT NULL AND (
                      es.visibility != 'public' OR ear.visibility != 'public'
                      OR (ear.rights_expires_at IS NOT NULL AND ear.rights_expires_at <= ?)
                    ))
                    OR (sc.link_citation_id IS NOT NULL AND lar.visibility != 'public')
                  )
              ) THEN 1 ELSE 0 END AS source_issue
       FROM answer_cards c
       JOIN answer_card_revisions r ON r.id = c.current_public_revision_id
       JOIN topics t ON t.id = c.topic_id
       LEFT JOIN topic_aliases ta ON ta.topic_id = t.id
       WHERE c.publication_status = 'published' AND t.status = 'active'
       GROUP BY c.id, c.slug, c.lock_version, c.risk_level, t.slug, t.title_zh,
                r.id, r.version_number, r.title, r.summary, r.search_text,
                r.scope_mode, r.as_of, r.verified_at, r.review_due_at,
                r.review_owner_label, r.evidence_coverage, r.dispute_status,
                r.evidence_note`,
    )
    .bind(now)
    .all<CardRow>();

  const revisionIds = result.results.map((row) => row.revision_id);
  const scopesByRevision = await loadScopesForRevisions(revisionIds);
  const query = options?.query?.trim() ?? '';
  const requiredScopes = new Set(options?.scopeIds ?? []);
  const requestedTopic = options?.topicSlug?.trim();

  return result.results
    .map((row) => {
      const scopes = scopesByRevision.get(row.revision_id) ?? [];
      const effectiveDispute = row.source_issue
        ? 'confirmed'
        : row.dispute_status;
      const card = mapCardRow(row, scopes, effectiveDispute, query);
      return card;
    })
    .filter((card) => !requestedTopic || card.topicSlug === requestedTopic)
    .filter((card) => {
      if (requiredScopes.size === 0) return true;
      const present = new Set(card.scopes.map((scope) => scope.id));
      return [...requiredScopes].every((scopeId) => present.has(scopeId));
    })
    .filter((card) => !query || card.searchScore > 0)
    .sort((left, right) => {
      if (left.status.isOverdue !== right.status.isOverdue) {
        return left.status.isOverdue ? 1 : -1;
      }
      if (query && left.searchScore !== right.searchScore) {
        return right.searchScore - left.searchScore;
      }
      return (
        right.verifiedAt - left.verifiedAt ||
        left.title.localeCompare(right.title, 'zh-CN')
      );
    })
    .slice(0, Math.min(Math.max(options?.limit ?? 50, 1), 100));
}

export async function getAnswerBySlug(
  slug: string,
): Promise<AnswerCardDetail | null> {
  return getAnswerRevision(slug);
}

export async function getAnswerVersion(
  slug: string,
  versionNumber: number,
): Promise<AnswerCardDetail | null> {
  return getAnswerRevision(slug, versionNumber);
}

async function getAnswerRevision(
  slug: string,
  versionNumber?: number,
): Promise<AnswerCardDetail | null> {
  await ensureDatabase();
  const now = Math.floor(Date.now() / 1000);
  const d1 = getD1();
  const versionFilter = versionNumber === undefined;
  const row = versionFilter
    ? await d1
        .prepare(
          `SELECT c.id, c.slug, c.lock_version, c.risk_level,
                  t.slug AS topic_slug, t.title_zh AS topic_title,
                  GROUP_CONCAT(DISTINCT ta.normalized_alias) AS topic_aliases,
                  r.id AS revision_id, r.version_number, r.title,
                  COALESCE((
                    SELECT s.text FROM answer_card_revision_sentences s
                    WHERE s.card_revision_id = r.id
                    ORDER BY s.ordinal ASC LIMIT 1
                  ), r.summary) AS summary,
                  r.search_text, r.scope_mode, r.as_of, r.verified_at,
                  r.review_due_at, r.review_owner_label, r.evidence_coverage,
                  r.dispute_status, r.evidence_note, 0 AS source_issue
           FROM answer_cards c
           JOIN answer_card_revisions r ON r.id = c.current_public_revision_id
           JOIN topics t ON t.id = c.topic_id
           LEFT JOIN topic_aliases ta ON ta.topic_id = t.id
           WHERE c.slug = ? AND c.publication_status = 'published'
           GROUP BY c.id, c.slug, c.lock_version, c.risk_level, t.slug, t.title_zh,
                    r.id, r.version_number, r.title, r.summary, r.search_text,
                    r.scope_mode, r.as_of, r.verified_at, r.review_due_at,
                    r.review_owner_label, r.evidence_coverage, r.dispute_status,
                    r.evidence_note
           LIMIT 1`,
        )
        .bind(slug)
        .first<CardRow>()
    : await d1
        .prepare(
          `SELECT c.id, c.slug, c.lock_version, c.risk_level,
                  t.slug AS topic_slug, t.title_zh AS topic_title,
                  GROUP_CONCAT(DISTINCT ta.normalized_alias) AS topic_aliases,
                  r.id AS revision_id, r.version_number, r.title,
                  COALESCE((
                    SELECT s.text FROM answer_card_revision_sentences s
                    WHERE s.card_revision_id = r.id
                    ORDER BY s.ordinal ASC LIMIT 1
                  ), r.summary) AS summary,
                  r.search_text, r.scope_mode, r.as_of, r.verified_at,
                  r.review_due_at, r.review_owner_label, r.evidence_coverage,
                  r.dispute_status, r.evidence_note, 0 AS source_issue
           FROM answer_cards c
           JOIN answer_card_revisions r ON r.card_id = c.id
           JOIN topics t ON t.id = c.topic_id
           LEFT JOIN topic_aliases ta ON ta.topic_id = t.id
           WHERE c.slug = ? AND c.publication_status = 'published'
             AND r.version_number = ?
             AND EXISTS (
               SELECT 1 FROM publish_operations po
               WHERE po.revision_id = r.id AND po.applied_at IS NOT NULL
             )
           GROUP BY c.id, c.slug, c.lock_version, c.risk_level, t.slug, t.title_zh,
                    r.id, r.version_number, r.title, r.summary, r.search_text,
                    r.scope_mode, r.as_of, r.verified_at, r.review_due_at,
                    r.review_owner_label, r.evidence_coverage, r.dispute_status,
                    r.evidence_note
           LIMIT 1`,
        )
        .bind(slug, versionNumber)
        .first<CardRow>();
  if (!row) return null;

  const [scopesByRevision, sentenceResult, historyResult, feedbackResult] =
    await Promise.all([
      loadScopesForRevisions([row.revision_id]),
      d1
        .prepare(
          `SELECT s.sentence_key, s.ordinal AS sentence_ordinal, s.text,
                  s.is_factual, sc.ordinal AS citation_ordinal,
                  es.id AS evidence_id, es.locator_kind, es.locator_value,
                  es.quote, lc.id AS link_id, lc.title AS link_title,
                  lc.url AS link_url, lc.accessed_at,
                  COALESCE(lc.published_at, ar.published_at) AS published_at,
                  ar.captured_at, a.canonical_url, p.name_zh AS publisher_name,
                  ar.visibility AS artifact_visibility,
                  es.visibility AS evidence_visibility,
                  ar.rights_expires_at
           FROM answer_card_revision_sentences s
           LEFT JOIN answer_card_sentence_citations sc
             ON sc.card_revision_id = s.card_revision_id
            AND sc.sentence_key = s.sentence_key
           LEFT JOIN evidence_spans es ON es.id = sc.evidence_span_id
           LEFT JOIN link_citations lc ON lc.id = sc.link_citation_id
           LEFT JOIN artifact_revisions ar
             ON ar.id = COALESCE(es.artifact_revision_id, lc.artifact_revision_id)
           LEFT JOIN artifacts a ON a.id = ar.artifact_id
           LEFT JOIN publishers p ON p.id = a.publisher_id
           WHERE s.card_revision_id = ?
           ORDER BY s.ordinal ASC, sc.ordinal ASC`,
        )
        .bind(row.revision_id)
        .all<SentenceCitationRow>(),
      d1
        .prepare(
          `SELECT r.id, r.version_number, r.title,
                  COALESCE((
                    SELECT s.text FROM answer_card_revision_sentences s
                    WHERE s.card_revision_id = r.id
                    ORDER BY s.ordinal ASC LIMIT 1
                  ), r.summary) AS summary,
                  r.as_of,
                  MAX(po.applied_at) AS published_at,
                  CASE WHEN c.current_public_revision_id = r.id THEN 1 ELSE 0 END AS is_current
           FROM answer_card_revisions r
           JOIN answer_cards c ON c.id = r.card_id
           JOIN publish_operations po ON po.revision_id = r.id AND po.applied_at IS NOT NULL
           WHERE r.card_id = ?
           GROUP BY r.id, r.version_number, r.title, r.summary, r.as_of,
                    c.current_public_revision_id
           ORDER BY r.version_number DESC`,
        )
        .bind(row.id)
        .all<{
          id: string;
          version_number: number;
          title: string;
          summary: string;
          as_of: string;
          published_at: number;
          is_current: number;
        }>(),
      d1
        .prepare(
          `SELECT outcome, COUNT(*) AS total
           FROM feedback_events
           WHERE card_revision_id = ?
           GROUP BY outcome`,
        )
        .bind(row.revision_id)
        .all<{ outcome: 'resolved' | 'unclear'; total: number }>(),
    ]);

  const sentences = mapSentences(sentenceResult.results, now);
  const sourceIssue = sentences.some(
    (sentence) => sentence.isFactual && sentence.citations.length === 0,
  );
  const effectiveDispute: DisputeStatus = sourceIssue
    ? 'confirmed'
    : row.dispute_status;
  const base = mapCardRow(
    row,
    scopesByRevision.get(row.revision_id) ?? [],
    effectiveDispute,
    '',
  );
  const feedback = { resolved: 0, unclear: 0 };
  for (const item of feedbackResult.results)
    feedback[item.outcome] = Number(item.total);

  return {
    ...base,
    sentences,
    history: historyResult.results.map((item) => ({
      id: item.id,
      versionNumber: Number(item.version_number),
      title: item.title,
      summary: item.summary,
      asOf: item.as_of,
      publishedAt: Number(item.published_at),
      isCurrent: Boolean(item.is_current),
    })),
    feedback,
  };
}

export async function getReportByCode(code: string) {
  await ensureDatabase();
  const normalized = code.toLocaleUpperCase();
  if (!/^XG-[A-F0-9]{32}$/u.test(normalized)) return null;
  return getD1()
    .prepare(
      `SELECT r.public_code, r.type, r.status, r.public_response,
              r.created_at, r.resolved_at, c.slug AS card_slug,
              cr.title AS card_title
       FROM reports r
       LEFT JOIN answer_cards c ON c.id = r.target_card_id
       LEFT JOIN answer_card_revisions cr ON cr.id = c.current_public_revision_id
       WHERE r.public_code = ?
       LIMIT 1`,
    )
    .bind(normalized)
    .first<{
      public_code: string;
      type: string;
      status: string;
      public_response: string | null;
      created_at: number;
      resolved_at: number | null;
      card_slug: string | null;
      card_title: string | null;
    }>();
}

export async function getEditorDashboard(
  actorId: string,
): Promise<EditorDashboard> {
  await ensureDatabase();
  const d1 = getD1();
  const now = Math.floor(Date.now() / 1000);
  const requestId = crypto.randomUUID();

  await d1
    .prepare(
      `INSERT INTO audit_events
        (id, actor_id, action, target_type, target_id, reason, request_id,
         metadata_json, created_at)
       VALUES (?, ?, 'editor.dashboard.read', 'editor_dashboard', 'stage1',
               '查看待复核、报告与私有线索队列', ?, NULL, ?)`,
    )
    .bind(`audit-${requestId}`, actorId, requestId, now)
    .run();

  const [cards, reports, intakes, audit] = await Promise.all([
    d1
      .prepare(
        `SELECT c.id, c.slug, c.publication_status, c.risk_level,
                c.lock_version, c.current_public_revision_id,
                current_r.title AS current_title,
                current_r.review_due_at AS current_review_due_at,
                latest_r.id AS latest_revision_id,
                latest_r.version_number AS latest_version_number,
                latest_r.title AS latest_title,
                t.title_zh AS topic_title
         FROM answer_cards c
         JOIN topics t ON t.id = c.topic_id
         LEFT JOIN answer_card_revisions current_r
           ON current_r.id = c.current_public_revision_id
         LEFT JOIN answer_card_revisions latest_r
           ON latest_r.card_id = c.id
          AND latest_r.version_number = (
            SELECT MAX(r2.version_number)
            FROM answer_card_revisions r2
            WHERE r2.card_id = c.id
          )
         ORDER BY
           CASE WHEN current_r.review_due_at IS NOT NULL
                     AND current_r.review_due_at <= ? THEN 0 ELSE 1 END,
           latest_r.created_at DESC`,
      )
      .bind(now)
      .all<{
        id: string;
        slug: string;
        publication_status: string;
        risk_level: string;
        lock_version: number;
        current_public_revision_id: string | null;
        current_title: string | null;
        current_review_due_at: number | null;
        latest_revision_id: string | null;
        latest_version_number: number | null;
        latest_title: string | null;
        topic_title: string;
      }>(),
    d1
      .prepare(
        `SELECT r.public_code, r.type, r.status, r.lock_version, r.created_at,
                cr.title AS card_title
         FROM reports r
         LEFT JOIN answer_cards c ON c.id = r.target_card_id
         LEFT JOIN answer_card_revisions cr ON cr.id = c.current_public_revision_id
         WHERE r.status IN ('received', 'reviewing')
         ORDER BY CASE r.type WHEN 'privacy' THEN 0 ELSE 1 END, r.created_at ASC
         LIMIT 50`,
      )
      .all<{
        public_code: string;
        type: string;
        status: string;
        lock_version: number;
        created_at: number;
        card_title: string | null;
      }>(),
    d1
      .prepare(
        `SELECT id, kind, context_scope, body, source_url, provenance_role,
                status, lock_version, submitted_at, expires_at
         FROM research_intakes
         WHERE status IN ('submitted', 'screening') AND purged_at IS NULL
         ORDER BY submitted_at ASC
         LIMIT 50`,
      )
      .all<{
        id: string;
        kind: string;
        context_scope: string;
        body: string | null;
        source_url: string | null;
        provenance_role: string | null;
        status: string;
        lock_version: number;
        submitted_at: number;
        expires_at: number;
      }>(),
    d1
      .prepare(
        `SELECT id, actor_id, action, target_type, target_id, reason, created_at
         FROM audit_events
         ORDER BY created_at DESC
         LIMIT 25`,
      )
      .all<{
        id: string;
        actor_id: string;
        action: string;
        target_type: string;
        target_id: string;
        reason: string;
        created_at: number;
      }>(),
  ]);

  return {
    cards: cards.results.map((row) => ({
      id: row.id,
      slug: row.slug,
      topicTitle: row.topic_title,
      publicationStatus: row.publication_status,
      riskLevel: row.risk_level,
      lockVersion: Number(row.lock_version),
      currentRevisionId: row.current_public_revision_id,
      currentTitle: row.current_title,
      currentReviewDueAt:
        row.current_review_due_at === null
          ? null
          : Number(row.current_review_due_at),
      latestRevisionId: row.latest_revision_id,
      latestVersionNumber:
        row.latest_version_number === null
          ? null
          : Number(row.latest_version_number),
      latestTitle: row.latest_title,
      hasUnpublishedDraft:
        row.latest_revision_id !== null &&
        row.latest_revision_id !== row.current_public_revision_id,
      isOverdue:
        row.current_review_due_at !== null &&
        Number(row.current_review_due_at) <= now,
    })),
    reports: reports.results.map((row) => ({
      publicCode: row.public_code,
      type: row.type,
      status: row.status,
      lockVersion: Number(row.lock_version),
      cardTitle: row.card_title,
      createdAt: Number(row.created_at),
    })),
    intakes: intakes.results.map((row) => ({
      id: row.id,
      kind: row.kind,
      contextScope: row.context_scope,
      body: row.body,
      sourceUrl: row.source_url,
      provenanceRole: row.provenance_role,
      status: row.status,
      lockVersion: Number(row.lock_version),
      submittedAt: Number(row.submitted_at),
      expiresAt: Number(row.expires_at),
    })),
    auditEvents: audit.results.map((row) => ({
      id: row.id,
      actorId: row.actor_id,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      reason: row.reason,
      createdAt: Number(row.created_at),
    })),
  };
}

export async function getEditorCard(cardId: string) {
  await ensureDatabase();
  const d1 = getD1();
  const card = await d1
    .prepare(
      `SELECT c.id, c.slug, c.topic_id, c.publication_status, c.risk_level,
              c.current_public_revision_id, c.lock_version, t.title_zh AS topic_title
       FROM answer_cards c
       JOIN topics t ON t.id = c.topic_id
       WHERE c.id = ?
       LIMIT 1`,
    )
    .bind(cardId)
    .first<{
      id: string;
      slug: string;
      topic_id: string;
      publication_status: string;
      risk_level: 'low' | 'high';
      current_public_revision_id: string | null;
      lock_version: number;
      topic_title: string;
    }>();
  if (!card) return null;

  const revisions = await d1
    .prepare(
      `SELECT r.id, r.parent_revision_id, r.version_number, r.title, r.summary,
              r.scope_mode, r.as_of, r.verified_at, r.review_due_at,
              r.review_owner_label, r.generation_type, r.evidence_coverage,
              r.dispute_status, r.evidence_note, r.created_at,
              po.applied_at AS published_at
       FROM answer_card_revisions r
       LEFT JOIN publish_operations po
         ON po.revision_id = r.id AND po.applied_at IS NOT NULL
       WHERE r.card_id = ?
       ORDER BY r.version_number DESC`,
    )
    .bind(cardId)
    .all<{
      id: string;
      parent_revision_id: string | null;
      version_number: number;
      title: string;
      summary: string;
      scope_mode: ScopeMode;
      as_of: string;
      verified_at: number;
      review_due_at: number;
      review_owner_label: string;
      generation_type: 'human' | 'ai_draft';
      evidence_coverage: EvidenceCoverage;
      dispute_status: DisputeStatus;
      evidence_note: string | null;
      created_at: number;
      published_at: number | null;
    }>();
  const latest = revisions.results[0] ?? null;
  const latestScopes = latest
    ? ((await loadScopesForRevisions([latest.id])).get(latest.id) ?? [])
    : [];
  const latestSentences = latest
    ? await getEditorRevisionSentences(latest.id)
    : [];

  return {
    card: {
      id: card.id,
      slug: card.slug,
      topicId: card.topic_id,
      topicTitle: card.topic_title,
      publicationStatus: card.publication_status,
      riskLevel: card.risk_level,
      currentPublicRevisionId: card.current_public_revision_id,
      lockVersion: Number(card.lock_version),
    },
    revisions: revisions.results.map((row) => ({
      id: row.id,
      parentRevisionId: row.parent_revision_id,
      versionNumber: Number(row.version_number),
      title: row.title,
      summary: row.summary,
      scopeMode: row.scope_mode,
      asOf: row.as_of,
      verifiedAt: Number(row.verified_at),
      reviewDueAt: Number(row.review_due_at),
      reviewOwnerLabel: row.review_owner_label,
      generationType: row.generation_type,
      evidenceCoverage: row.evidence_coverage,
      disputeStatus: row.dispute_status,
      evidenceNote: row.evidence_note,
      createdAt: Number(row.created_at),
      publishedAt: row.published_at === null ? null : Number(row.published_at),
      isCurrent: row.id === card.current_public_revision_id,
    })),
    latestDraft: latest
      ? {
          id: latest.id,
          title: latest.title,
          summary: latest.summary,
          scopeMode: latest.scope_mode,
          scopeIds: latestScopes.map((scope) => scope.id),
          asOf: latest.as_of,
          reviewDueAt: Number(latest.review_due_at),
          reviewOwnerLabel: latest.review_owner_label,
          disputeStatus: latest.dispute_status,
          evidenceNote: latest.evidence_note,
          generationType: latest.generation_type,
          sentences: latestSentences,
        }
      : null,
  };
}

async function getEditorRevisionSentences(revisionId: string) {
  const result = await getD1()
    .prepare(
      `SELECT s.sentence_key, s.ordinal, s.text,
              CASE WHEN sc.evidence_span_id IS NOT NULL THEN 'evidence' ELSE 'link' END AS kind,
              COALESCE(lc.title, p.name_zh || ' · 可定位证据') AS source_title,
              COALESCE(lc.url, a.canonical_url) AS source_url,
              p.name_zh AS publisher_name, es.quote, es.locator_value
       FROM answer_card_revision_sentences s
       JOIN answer_card_sentence_citations sc
         ON sc.card_revision_id = s.card_revision_id
        AND sc.sentence_key = s.sentence_key
       LEFT JOIN evidence_spans es ON es.id = sc.evidence_span_id
       LEFT JOIN link_citations lc ON lc.id = sc.link_citation_id
       JOIN artifact_revisions ar
         ON ar.id = COALESCE(es.artifact_revision_id, lc.artifact_revision_id)
       JOIN artifacts a ON a.id = ar.artifact_id
       JOIN publishers p ON p.id = a.publisher_id
       WHERE s.card_revision_id = ?
       ORDER BY s.ordinal ASC, sc.ordinal ASC`,
    )
    .bind(revisionId)
    .all<{
      sentence_key: string;
      ordinal: number;
      text: string;
      kind: 'link' | 'evidence';
      source_title: string;
      source_url: string;
      publisher_name: string;
      quote: string | null;
      locator_value: string | null;
    }>();
  return result.results.map((row) => ({
    text: row.text,
    citation: {
      kind: row.kind,
      sourceTitle: row.source_title,
      sourceUrl: row.source_url.startsWith('/')
        ? `https://xjtlu-guide.example${row.source_url}`
        : row.source_url,
      publisherName: row.publisher_name,
      quote: row.quote,
      locator: row.locator_value,
      rightsConfirmed: row.kind === 'evidence',
    },
  }));
}

function mapCardRow(
  row: CardRow,
  scopes: Scope[],
  disputeStatus: DisputeStatus,
  query: string,
): AnswerCardSummary {
  return {
    id: row.id,
    slug: row.slug,
    topicSlug: row.topic_slug,
    topicTitle: row.topic_title,
    title: row.title,
    summary: row.summary,
    revisionId: row.revision_id,
    versionNumber: Number(row.version_number),
    lockVersion: Number(row.lock_version),
    scopeMode: row.scope_mode,
    scopes,
    asOf: row.as_of,
    verifiedAt: Number(row.verified_at),
    reviewDueAt: Number(row.review_due_at),
    reviewOwnerLabel: row.review_owner_label,
    evidenceCoverage: row.evidence_coverage,
    disputeStatus,
    evidenceNote: row.evidence_note,
    riskLevel: row.risk_level,
    status: deriveRevisionStatus(Number(row.review_due_at), disputeStatus),
    searchScore: rankSearchCandidate(
      {
        id: row.id,
        title: row.title,
        summary: row.summary,
        searchText: row.search_text,
        topicTitle: row.topic_title,
        topicAliases: row.topic_aliases ?? undefined,
      },
      query,
    ),
  };
}

async function loadScopesForRevisions(
  revisionIds: string[],
): Promise<Map<string, Scope[]>> {
  const byRevision = new Map<string, Scope[]>();
  if (revisionIds.length === 0) return byRevision;
  const placeholders = revisionIds.map(() => '?').join(', ');
  const result = await getD1()
    .prepare(
      `SELECT rs.card_revision_id, s.id, s.dimension, s.code, s.label_zh, s.label_en
       FROM answer_card_revision_scopes rs
       JOIN applicability_scopes s ON s.id = rs.scope_id
       WHERE rs.card_revision_id IN (${placeholders})
       ORDER BY s.sort_order ASC, s.label_zh ASC`,
    )
    .bind(...revisionIds)
    .all<ScopeRow>();
  for (const row of result.results) {
    const values = byRevision.get(row.card_revision_id) ?? [];
    values.push(mapScope(row));
    byRevision.set(row.card_revision_id, values);
  }
  return byRevision;
}

function mapScope(row: Omit<ScopeRow, 'card_revision_id'>): Scope {
  return {
    id: row.id,
    dimension: row.dimension,
    code: row.code,
    labelZh: row.label_zh,
    labelEn: row.label_en,
  };
}

type SentenceCitationRow = {
  sentence_key: string;
  sentence_ordinal: number;
  text: string;
  is_factual: number;
  citation_ordinal: number | null;
  evidence_id: string | null;
  locator_kind: string | null;
  locator_value: string | null;
  quote: string | null;
  link_id: string | null;
  link_title: string | null;
  link_url: string | null;
  accessed_at: number | null;
  published_at: number | null;
  captured_at: number | null;
  canonical_url: string | null;
  publisher_name: string | null;
  artifact_visibility: string | null;
  evidence_visibility: string | null;
  rights_expires_at: number | null;
};

function mapSentences(
  rows: SentenceCitationRow[],
  now: number,
): AnswerSentence[] {
  const byKey = new Map<string, AnswerSentence>();
  for (const row of rows) {
    const sentence = byKey.get(row.sentence_key) ?? {
      key: row.sentence_key,
      ordinal: Number(row.sentence_ordinal),
      text: row.text,
      isFactual: Boolean(row.is_factual),
      citations: [],
    };

    const citation = mapCitation(row, now);
    if (citation) sentence.citations.push(citation);
    byKey.set(row.sentence_key, sentence);
  }
  return [...byKey.values()].sort(
    (left, right) => left.ordinal - right.ordinal,
  );
}

function mapCitation(
  row: SentenceCitationRow,
  now: number,
): CitationDetail | null {
  const sourceIsPublic =
    row.artifact_visibility === 'public' &&
    (row.rights_expires_at === null || Number(row.rights_expires_at) > now);
  if (!sourceIsPublic || row.citation_ordinal === null || !row.publisher_name)
    return null;

  if (row.evidence_id) {
    if (row.evidence_visibility !== 'public' || !row.canonical_url) return null;
    return {
      id: row.evidence_id,
      ordinal: Number(row.citation_ordinal),
      kind: 'evidence',
      title: `${row.publisher_name} · 可定位证据`,
      url: row.canonical_url,
      publisher: row.publisher_name,
      publishedAt: row.published_at === null ? null : Number(row.published_at),
      capturedAt: Number(row.captured_at ?? 0),
      accessedAt: null,
      locatorKind: row.locator_kind,
      locatorValue: row.locator_value,
      quote: row.quote,
      isArchived: true,
    };
  }
  if (row.link_id && row.link_url && row.link_title) {
    return {
      id: row.link_id,
      ordinal: Number(row.citation_ordinal),
      kind: 'link',
      title: row.link_title,
      url: row.link_url,
      publisher: row.publisher_name,
      publishedAt: row.published_at === null ? null : Number(row.published_at),
      capturedAt: Number(row.captured_at ?? 0),
      accessedAt: row.accessed_at === null ? null : Number(row.accessed_at),
      locatorKind: null,
      locatorValue: null,
      quote: null,
      isArchived: false,
    };
  }
  return null;
}
