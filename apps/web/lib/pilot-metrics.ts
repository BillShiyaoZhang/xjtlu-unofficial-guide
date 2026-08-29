export const FORMAL_PILOT_METRIC_WHERE =
  "q.principal_kind = 'research_participant' AND q.qualified = 1";
export const ANONYMOUS_METRIC_WHERE = "q.principal_kind = 'public_anonymous'";

export function isQueryEventFrozen(
  eventCreatedAt: number,
  now: number,
  windowEndAt: number | null,
) {
  return (
    windowEndAt !== null && now >= windowEndAt && eventCreatedAt < windowEndAt
  );
}

export function pilotMetricSql(where: string, windowed = false) {
  return `${metricWindowCte(windowed)}SELECT
    COUNT(*) AS queries,
    SUM(CASE WHEN q.retrieval_status = 'completed' THEN 1 ELSE 0 END) AS completed,
    SUM(CASE WHEN q.retrieval_status = 'completed' AND q.result_count = 0 THEN 1 ELSE 0 END) AS zero_results,
    SUM(CASE WHEN EXISTS (
      SELECT 1 FROM feedback_events f WHERE f.query_event_id = q.id
        ${metricWindowClause('f', windowed)}
    ) THEN 1 ELSE 0 END) AS responded,
    SUM(CASE WHEN EXISTS (
      SELECT 1 FROM feedback_events f
      WHERE f.query_event_id = q.id AND f.outcome = 'resolved'
        ${metricWindowClause('f', windowed)}
    ) THEN 1 ELSE 0 END) AS resolved,
    SUM(CASE WHEN EXISTS (
      SELECT 1 FROM answer_open_events o WHERE o.query_event_id = q.id
        ${metricWindowClause('o', windowed, 'opened_at')}
    ) THEN 1 ELSE 0 END) AS opened,
    SUM(CASE WHEN EXISTS (
      SELECT 1 FROM answer_share_events s WHERE s.query_event_id = q.id
        ${metricWindowClause('s', windowed, 'shared_at')}
    ) THEN 1 ELSE 0 END) AS shared,
    SUM(CASE WHEN EXISTS (
      SELECT 1 FROM feedback_events f
      JOIN query_result_impressions i
        ON i.query_event_id = f.query_event_id
       AND i.card_revision_id = f.card_revision_id
      WHERE f.query_event_id = q.id AND f.outcome = 'resolved'
        AND i.rank <= 3
        ${metricWindowClause('f', windowed)}
        ${metricWindowClause('i', windowed, 'recorded_at')}
    ) THEN 1 ELSE 0 END) AS top_three_resolved,
    SUM(CASE WHEN q.retrieval_status = 'error' THEN 1 ELSE 0 END) AS retrieval_errors
  FROM query_events q WHERE ${where}${metricWindowClause('q', windowed)}`;
}

export function pilotParticipantSql(windowed = false) {
  return `${metricWindowCte(windowed)}SELECT COUNT(DISTINCT p.id) AS total
    FROM pilot_participants p
    JOIN pilot_sessions s ON s.participant_id = p.id
    JOIN pilot_consent_records c ON c.id = s.consent_id
    JOIN query_events q ON q.pilot_session_id = s.id
    WHERE p.is_test = 0 AND p.adult_verified_at IS NOT NULL
      AND p.status = 'active' AND c.withdrawn_at IS NULL
      AND q.principal_kind = 'research_participant' AND q.qualified = 1
      ${metricWindowClause('q', windowed)}`;
}

export function pilotSharingParticipantSql(windowed = false) {
  return `${metricWindowCte(windowed)}SELECT COUNT(DISTINCT p.id) AS total
    FROM pilot_participants p
    JOIN pilot_sessions s ON s.participant_id = p.id
    JOIN pilot_consent_records c ON c.id = s.consent_id
    JOIN query_events q ON q.pilot_session_id = s.id
    JOIN answer_share_events sh ON sh.query_event_id = q.id
    WHERE p.is_test = 0 AND p.status = 'active'
      AND c.withdrawn_at IS NULL AND q.qualified = 1
      ${metricWindowClause('q', windowed)}
      ${metricWindowClause('sh', windowed, 'shared_at')}`;
}

function metricWindowClause(
  alias: string,
  windowed: boolean,
  column = 'created_at',
) {
  return windowed
    ? ` AND ${alias}.${column} >= (SELECT start_at FROM metric_window)
        AND ${alias}.${column} < (SELECT end_at FROM metric_window)`
    : '';
}

function metricWindowCte(windowed: boolean) {
  return windowed
    ? 'WITH metric_window(start_at, end_at) AS (VALUES (?, ?)) '
    : '';
}
