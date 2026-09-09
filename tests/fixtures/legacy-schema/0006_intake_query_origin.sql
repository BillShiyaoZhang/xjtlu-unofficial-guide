ALTER TABLE `research_intakes` ADD `origin_query_event_id` text REFERENCES query_events(id) ON DELETE set null;
