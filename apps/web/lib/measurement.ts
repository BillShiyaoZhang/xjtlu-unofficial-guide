import { ensureDatabase } from '@/db/bootstrap';
import { getD1 } from '@/db/index';

import { normalizeSearchText } from './domain';
import { AppError } from './errors';
import { isQueryEventFrozen } from './pilot-metrics';
import { isUuid } from './pilot-crypto';
import type { PilotSessionIdentity } from './pilot';
import { getPilotMetricWindow } from './pilot-window';
import type { AnswerCardSummary } from './types';

export type QueryPrincipal =
  | { kind: 'public_anonymous'; sessionId: null; qualified: false }
  | { kind: 'editor'; sessionId: null; qualified: false }
  | {
      kind: 'research_participant';
      sessionId: string;
      qualified: boolean;
    };

export function queryPrincipal(
  session: PilotSessionIdentity | null,
  isEditor: boolean,
): QueryPrincipal {
  if (isEditor) return { kind: 'editor', sessionId: null, qualified: false };
  if (session) {
    return {
      kind: 'research_participant',
      sessionId: session.id,
      qualified: !session.isTest,
    };
  }
  return { kind: 'public_anonymous', sessionId: null, qualified: false };
}

export async function recordMeasuredSearch(input: {
  query: string;
  topic: string;
  scopeIds: string[];
  cards: AnswerCardSummary[];
  principal: QueryPrincipal;
  existingQueryEventId?: string | null;
}): Promise<string> {
  await ensureDatabase();
  const existingId = input.existingQueryEventId?.trim() ?? '';
  if (
    existingId &&
    isUuid(existingId) &&
    (await canReuseQueryEvent(existingId, input.principal))
  ) {
    await updateMeasuredSearch(existingId, input);
    return existingId;
  }

  const id = crypto.randomUUID();
  const now = nowSeconds();
  const lengthBucket = queryLengthBucket(input.query);
  const d1 = getD1();
  await d1.batch([
    d1
      .prepare(
        `INSERT INTO query_events
          (id, principal_kind, pilot_session_id, qualified,
           qualification_rule_version, retrieval_status, query_length_bucket,
           has_topic_filter, scope_filter_count, result_count,
           retrieval_version, created_at)
         VALUES (?, ?, ?, ?, 'stage1-explicit-submit-v2', 'completed', ?, ?, ?, ?,
                 'ranker-v1', ?)`,
      )
      .bind(
        id,
        input.principal.kind,
        input.principal.sessionId,
        input.principal.qualified ? 1 : 0,
        lengthBucket,
        input.topic ? 1 : 0,
        input.scopeIds.length,
        input.cards.length,
        now,
      ),
    ...impressionStatements(d1, id, input.cards, now),
  ]);
  return id;
}

export async function recordMeasuredSearchError(input: {
  query: string;
  topic: string;
  scopeIds: string[];
  principal: QueryPrincipal;
  existingQueryEventId?: string | null;
}): Promise<string | null> {
  await ensureDatabase();
  const existingId = input.existingQueryEventId?.trim() ?? '';
  if (
    existingId &&
    isUuid(existingId) &&
    (await canReuseQueryEvent(existingId, input.principal))
  ) {
    await getD1()
      .prepare(
        `UPDATE query_events
         SET retrieval_status = 'error', query_length_bucket = ?,
             has_topic_filter = ?, scope_filter_count = ?, result_count = NULL
         WHERE id = ?`,
      )
      .bind(
        queryLengthBucket(input.query),
        input.topic ? 1 : 0,
        input.scopeIds.length,
        existingId,
      )
      .run();
    return existingId;
  }

  const id = crypto.randomUUID();
  await getD1()
    .prepare(
      `INSERT INTO query_events
        (id, principal_kind, pilot_session_id, qualified,
         qualification_rule_version, retrieval_status, query_length_bucket,
         has_topic_filter, scope_filter_count, result_count,
         retrieval_version, created_at)
       VALUES (?, ?, ?, ?, 'stage1-explicit-submit-v2', 'error', ?, ?, ?, NULL,
               'ranker-v1', ?)`,
    )
    .bind(
      id,
      input.principal.kind,
      input.principal.sessionId,
      input.principal.qualified ? 1 : 0,
      queryLengthBucket(input.query),
      input.topic ? 1 : 0,
      input.scopeIds.length,
      nowSeconds(),
    )
    .run();
  return id;
}

export async function recordAnswerOpen(input: {
  queryEventId: string;
  cardRevisionId: string;
  session: PilotSessionIdentity | null;
}): Promise<boolean> {
  await ensureDatabase();
  if (!isUuid(input.queryEventId)) return false;
  const event = await authorizedQueryEvent(input.queryEventId, input.session);
  if (!event) return false;
  const d1 = getD1();
  const impression = await d1
    .prepare(
      `SELECT 1 AS present FROM query_result_impressions
       WHERE query_event_id = ? AND card_revision_id = ? LIMIT 1`,
    )
    .bind(input.queryEventId, input.cardRevisionId)
    .first<{ present: number }>();
  if (!impression) return false;
  await d1
    .prepare(
      `INSERT INTO answer_open_events
        (query_event_id, card_revision_id, opened_at)
       VALUES (?, ?, ?)
       ON CONFLICT(query_event_id, card_revision_id) DO NOTHING`,
    )
    .bind(input.queryEventId, input.cardRevisionId, nowSeconds())
    .run();
  return true;
}

export async function recordAnswerShare(input: {
  queryEventId: string;
  cardRevisionId: string;
  session: PilotSessionIdentity | null;
}): Promise<boolean> {
  const opened = await recordAnswerOpen(input);
  if (!opened) return false;
  await getD1()
    .prepare(
      `INSERT INTO answer_share_events
        (query_event_id, card_revision_id, shared_at)
       VALUES (?, ?, ?)
       ON CONFLICT(query_event_id, card_revision_id) DO NOTHING`,
    )
    .bind(input.queryEventId, input.cardRevisionId, nowSeconds())
    .run();
  return true;
}

export async function authorizeFeedbackQuery(input: {
  queryEventId: string | null;
  cardRevisionId: string;
  session: PilotSessionIdentity | null;
}): Promise<{ queryEventId: string | null; actorScope: string }> {
  const queryEventId = input.queryEventId?.trim() ?? '';
  if (!queryEventId) {
    return { queryEventId: null, actorScope: 'anonymous' };
  }
  if (!isUuid(queryEventId)) {
    throw new AppError(400, 'invalid_query_context', '查询上下文无效。');
  }
  await ensureDatabase();
  const event = await authorizedQueryEvent(queryEventId, input.session);
  if (!event) {
    throw new AppError(
      403,
      'query_context_unavailable',
      '该查询上下文已失效，请重新搜索后再反馈。',
    );
  }
  const opened = await getD1()
    .prepare(
      `SELECT 1 AS present FROM answer_open_events
       WHERE query_event_id = ? AND card_revision_id = ? LIMIT 1`,
    )
    .bind(queryEventId, input.cardRevisionId)
    .first<{ present: number }>();
  if (!opened) {
    throw new AppError(
      409,
      'answer_not_opened_from_query',
      '这张答案不属于当前已打开的查询结果。',
    );
  }
  return { queryEventId, actorScope: `query:${queryEventId}` };
}

export async function isOwnedPilotQuery(
  queryEventId: string,
  session: PilotSessionIdentity,
) {
  if (!isUuid(queryEventId)) return false;
  await ensureDatabase();
  const row = await getD1()
    .prepare(
      `SELECT 1 AS present FROM query_events
       WHERE id = ? AND principal_kind = 'research_participant'
         AND pilot_session_id = ? LIMIT 1`,
    )
    .bind(queryEventId, session.id)
    .first<{ present: number }>();
  return Boolean(row);
}

type QueryEventRow = {
  principal_kind: string;
  pilot_session_id: string | null;
  created_at: number;
};

async function canReuseQueryEvent(id: string, principal: QueryPrincipal) {
  const row = await getD1()
    .prepare(
      `SELECT principal_kind, pilot_session_id, created_at FROM query_events
       WHERE id = ? LIMIT 1`,
    )
    .bind(id)
    .first<QueryEventRow>();
  if (!row || row.principal_kind !== principal.kind) return false;
  const metricWindow = getPilotMetricWindow();
  if (isQueryEventFrozen(row.created_at, nowSeconds(), metricWindow.endAt)) {
    return false;
  }
  return row.principal_kind === 'research_participant'
    ? row.pilot_session_id === principal.sessionId
    : row.pilot_session_id === null;
}

async function authorizedQueryEvent(
  id: string,
  session: PilotSessionIdentity | null,
) {
  const row = await getD1()
    .prepare(
      `SELECT principal_kind, pilot_session_id, created_at FROM query_events
       WHERE id = ? LIMIT 1`,
    )
    .bind(id)
    .first<QueryEventRow>();
  if (!row || row.principal_kind === 'withdrawn') return null;
  if (row.principal_kind === 'research_participant') {
    return session && row.pilot_session_id === session.id ? row : null;
  }
  return row.pilot_session_id === null ? row : null;
}

async function updateMeasuredSearch(
  queryEventId: string,
  input: {
    query: string;
    topic: string;
    scopeIds: string[];
    cards: AnswerCardSummary[];
  },
) {
  const d1 = getD1();
  await d1.batch([
    d1
      .prepare(
        `UPDATE query_events
         SET retrieval_status = 'completed', query_length_bucket = ?,
             has_topic_filter = ?, scope_filter_count = ?, result_count = ?
         WHERE id = ?`,
      )
      .bind(
        queryLengthBucket(input.query),
        input.topic ? 1 : 0,
        input.scopeIds.length,
        input.cards.length,
        queryEventId,
      ),
    ...impressionStatements(d1, queryEventId, input.cards, nowSeconds()),
  ]);
}

function impressionStatements(
  d1: D1Database,
  queryEventId: string,
  cards: AnswerCardSummary[],
  now: number,
) {
  return cards.map((card, index) =>
    d1
      .prepare(
        `INSERT INTO query_result_impressions
          (query_event_id, card_id, card_revision_id, rank, recorded_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(query_event_id, card_revision_id) DO UPDATE SET
           recorded_at = CASE
             WHEN excluded.rank < query_result_impressions.rank
             THEN excluded.recorded_at
             ELSE query_result_impressions.recorded_at
           END,
           rank = MIN(query_result_impressions.rank, excluded.rank)`,
      )
      .bind(queryEventId, card.id, card.revisionId, index + 1, now),
  );
}

function queryLengthBucket(query: string) {
  const normalizedLength = [...normalizeSearchText(query)].length;
  return normalizedLength <= 8
    ? 'short'
    : normalizedLength <= 40
      ? 'medium'
      : 'long';
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}
