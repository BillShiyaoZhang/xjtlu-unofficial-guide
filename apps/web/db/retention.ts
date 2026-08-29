export const RESEARCH_EVENT_RETENTION_DAYS = 120;

export const RESEARCH_EVENT_RETENTION_SQL = [
  `DELETE FROM feedback_events
   WHERE query_event_id IN (
     SELECT id FROM query_events WHERE created_at <= ?
   )`,
  `UPDATE research_intakes SET origin_query_event_id = NULL
   WHERE origin_query_event_id IN (
     SELECT id FROM query_events WHERE created_at <= ?
   )`,
  `DELETE FROM answer_share_events WHERE query_event_id IN (
     SELECT id FROM query_events WHERE created_at <= ?
   )`,
  `DELETE FROM answer_open_events WHERE query_event_id IN (
     SELECT id FROM query_events WHERE created_at <= ?
   )`,
  `DELETE FROM query_result_impressions WHERE query_event_id IN (
     SELECT id FROM query_events WHERE created_at <= ?
   )`,
  'DELETE FROM query_events WHERE created_at <= ?',
] as const;
