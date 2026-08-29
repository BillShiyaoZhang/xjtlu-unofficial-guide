export const PURGE_WITHDRAWN_QUERY_IDEMPOTENCY_SQL = `DELETE FROM idempotency_records
 WHERE actor_scope IN (
   SELECT 'query:' || q.id
   FROM query_events q
   JOIN pilot_sessions s ON s.id = q.pilot_session_id
   WHERE s.participant_id = ?
 )`;

export const DETACH_WITHDRAWN_QUERY_EVENTS_SQL = `UPDATE query_events
 SET principal_kind = 'withdrawn', pilot_session_id = NULL, qualified = 0
 WHERE pilot_session_id IN (
   SELECT id FROM pilot_sessions WHERE participant_id = ?
 )`;

export const PURGE_WITHDRAWN_SESSION_IDEMPOTENCY_SQL = `DELETE FROM idempotency_records
 WHERE actor_scope IN (
   SELECT 'pilot-session:' || id FROM pilot_sessions
   WHERE participant_id = ?
 )`;
