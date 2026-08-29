import { ensureDatabase } from '@/db/bootstrap';
import { getD1 } from '@/db';

const PAGE_SIZE = 24;

const PUBLICATION_STATUSES = ['draft', 'published', 'hidden'] as const;
const ATTENTION_FILTERS = ['drafts', 'overdue', 'source_issue'] as const;

type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];
type AttentionFilter = (typeof ATTENTION_FILTERS)[number];

export async function listEditorContent(input: {
  page: number;
  status?: string;
  attention?: string;
  topicId?: string;
}) {
  await ensureDatabase();
  const page = safePage(input.page);
  const status = PUBLICATION_STATUSES.includes(
    input.status as PublicationStatus,
  )
    ? (input.status as PublicationStatus)
    : null;
  const attention = ATTENTION_FILTERS.includes(
    input.attention as AttentionFilter,
  )
    ? (input.attention as AttentionFilter)
    : null;
  const topicId = input.topicId?.trim().slice(0, 100) || null;
  const now = Math.floor(Date.now() / 1_000);
  const conditions: string[] = [];
  const bindings: unknown[] = [];

  if (status) {
    conditions.push('c.publication_status = ?');
    bindings.push(status);
  }
  if (topicId) {
    conditions.push('c.topic_id = ?');
    bindings.push(topicId);
  }
  if (attention === 'drafts') {
    conditions.push(
      'latest_r.id IS NOT NULL AND latest_r.id IS NOT c.current_public_revision_id',
    );
  } else if (attention === 'overdue') {
    conditions.push(
      'current_r.review_due_at IS NOT NULL AND current_r.review_due_at <= ?',
    );
    bindings.push(now);
  } else if (attention === 'source_issue') {
    conditions.push('source_state.has_source_issue = 1');
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const d1 = getD1();
  const [rows, count, topics] = await Promise.all([
    d1
      .prepare(
        `${contentSelect()}
         ${where}
         ORDER BY
           source_state.has_source_issue DESC,
           CASE WHEN current_r.review_due_at IS NOT NULL
                     AND current_r.review_due_at <= ? THEN 0 ELSE 1 END,
           latest_r.created_at DESC, c.slug ASC
         LIMIT ? OFFSET ?`,
      )
      .bind(...bindings, now, PAGE_SIZE, (page - 1) * PAGE_SIZE)
      .all<ContentRow>(),
    d1
      .prepare(
        `SELECT COUNT(*) AS total FROM (${contentSelect()} ${where}) content_rows`,
      )
      .bind(...bindings)
      .first<{ total: number }>(),
    d1
      .prepare(
        `SELECT id, title_zh FROM topics
         ORDER BY status ASC, title_zh ASC`,
      )
      .all<{ id: string; title_zh: string }>(),
  ]);
  const total = Number(count?.total ?? 0);
  return {
    items: rows.results.map((row) => ({
      id: row.id,
      slug: row.slug,
      topicId: row.topic_id,
      topicTitle: row.topic_title,
      publicationStatus: row.publication_status,
      riskLevel: row.risk_level,
      lockVersion: Number(row.lock_version),
      currentTitle: row.current_title,
      latestTitle: row.latest_title,
      latestVersion: nullableNumber(row.latest_version_number),
      reviewDueAt: nullableNumber(row.review_due_at),
      hasDraft:
        row.latest_revision_id !== null &&
        row.latest_revision_id !== row.current_public_revision_id,
      hasSourceIssue: Boolean(row.has_source_issue),
      isOverdue: row.review_due_at !== null && Number(row.review_due_at) <= now,
    })),
    topics: topics.results.map((row) => ({
      id: row.id,
      title: row.title_zh,
    })),
    filters: { status, attention, topicId },
    page,
    pageSize: PAGE_SIZE,
    total,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

function contentSelect() {
  return `SELECT c.id, c.slug, c.topic_id, c.publication_status,
                 c.risk_level, c.lock_version, c.current_public_revision_id,
                 t.title_zh AS topic_title,
                 current_r.title AS current_title,
                 current_r.review_due_at AS review_due_at,
                 latest_r.id AS latest_revision_id,
                 latest_r.title AS latest_title,
                 latest_r.version_number AS latest_version_number,
                 COALESCE(source_state.has_source_issue, 0) AS has_source_issue
          FROM answer_cards c
          JOIN topics t ON t.id = c.topic_id
          LEFT JOIN answer_card_revisions current_r
            ON current_r.id = c.current_public_revision_id
          LEFT JOIN answer_card_revisions latest_r
            ON latest_r.card_id = c.id
           AND latest_r.version_number = (
             SELECT MAX(candidate.version_number)
             FROM answer_card_revisions candidate
             WHERE candidate.card_id = c.id
           )
          LEFT JOIN (
            SELECT sc.card_revision_id, 1 AS has_source_issue
            FROM answer_card_sentence_citations sc
            LEFT JOIN evidence_spans es ON es.id = sc.evidence_span_id
            LEFT JOIN link_citations lc ON lc.id = sc.link_citation_id
            JOIN artifact_revisions ar
              ON ar.id = COALESCE(es.artifact_revision_id, lc.artifact_revision_id)
            JOIN artifacts a ON a.id = ar.artifact_id
            WHERE a.moderation_status != 'approved'
               OR ar.visibility != 'public'
               OR (ar.rights_expires_at IS NOT NULL
                   AND ar.rights_expires_at <= unixepoch())
            GROUP BY sc.card_revision_id
          ) source_state ON source_state.card_revision_id = c.current_public_revision_id`;
}

function safePage(value: number) {
  return Number.isInteger(value) && value > 0 ? Math.min(value, 10_000) : 1;
}

function nullableNumber(value: number | null) {
  return value === null ? null : Number(value);
}

type ContentRow = {
  id: string;
  slug: string;
  topic_id: string;
  topic_title: string;
  publication_status: PublicationStatus;
  risk_level: 'low' | 'high';
  lock_version: number;
  current_public_revision_id: string | null;
  current_title: string | null;
  latest_revision_id: string | null;
  latest_title: string | null;
  latest_version_number: number | null;
  review_due_at: number | null;
  has_source_issue: number;
};
