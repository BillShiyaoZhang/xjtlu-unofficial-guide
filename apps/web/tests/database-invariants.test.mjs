import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  FORMAL_PILOT_METRIC_WHERE,
  isQueryEventFrozen,
  pilotMetricSql,
  pilotParticipantSql,
  pilotSharingParticipantSql,
} from '../lib/pilot-metrics.ts';
import { PILOT_NOTICE_VERSION } from '../lib/pilot-contract.ts';
import { RESEARCH_EVENT_RETENTION_SQL } from '../db/retention.ts';
import {
  DETACH_WITHDRAWN_QUERY_EVENTS_SQL,
  PURGE_WITHDRAWN_QUERY_IDEMPOTENCY_SQL,
  PURGE_WITHDRAWN_SESSION_IDEMPOTENCY_SQL,
} from '../lib/pilot-withdrawal.ts';

const migrationFiles = [
  new URL('../drizzle/0000_flat_brood.sql', import.meta.url),
  new URL('../drizzle/0001_stage1-invariants.sql', import.meta.url),
  new URL('../drizzle/0002_breezy_cammi.sql', import.meta.url),
  new URL('../drizzle/0003_report_workflow_integrity.sql', import.meta.url),
  new URL('../drizzle/0004_report_initial_state.sql', import.meta.url),
  new URL('../drizzle/0005_pilot_query_measurement.sql', import.meta.url),
  new URL('../drizzle/0006_intake_query_origin.sql', import.meta.url),
  new URL('../drizzle/0007_pilot_security_hardening.sql', import.meta.url),
  new URL('../drizzle/0008_ordinary_champions.sql', import.meta.url),
];

function createDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  applyMigrations(db, migrationFiles);
  return db;
}

function applyMigrations(db, files) {
  for (const file of files) {
    const sql = readFileSync(file, 'utf8');
    for (const statement of sql
      .split('--> statement-breakpoint')
      .map((item) => item.trim())
      .filter(Boolean)) {
      db.exec(statement);
    }
  }
}

function insertBase(
  db,
  { risk = 'low', generation = 'human', citation = true } = {},
) {
  db.exec(`
    INSERT INTO topics (id, slug, title_zh, title_en, description, status, created_at)
    VALUES ('topic', 'topic', '话题', NULL, '说明', 'active', 1800000000);
    INSERT INTO publishers (id, type, name_zh, name_en, canonical_url, verification_status, created_at)
    VALUES ('publisher', 'organization', '来源', NULL, 'https://example.com', 'unverified', 1800000000);
    INSERT INTO artifacts (id, publisher_id, type, canonical_url, moderation_status, created_at)
    VALUES ('artifact', 'publisher', 'webpage', 'https://example.com/source', 'approved', 1800000000);
    INSERT INTO artifact_revisions
      (id, artifact_id, published_at, captured_at, recorded_at, visibility, rights_mode,
       rights_expires_at, content_hash, archived_text)
    VALUES ('artifact-link-v1', 'artifact', NULL, 1800000000, 1800000000, 'public',
            'link_only', NULL, NULL, NULL);
    INSERT INTO link_citations
      (id, artifact_revision_id, url, title, published_at, accessed_at, created_at)
    VALUES ('link', 'artifact-link-v1', 'https://example.com/source', '来源页', NULL,
            1800000000, 1800000000);
    INSERT INTO answer_cards
      (id, slug, topic_id, publication_status, risk_level, current_public_revision_id,
       lock_version, last_publish_operation_id, created_at)
    VALUES ('card', 'card', 'topic', 'unpublished', '${risk}', NULL, 0, NULL, 1800000000);
    INSERT INTO answer_card_revisions
      (id, card_id, parent_revision_id, version_number, expected_card_version, locale,
       title, summary, search_text, scope_mode, as_of, verified_at, review_due_at,
       review_owner_id, review_owner_label, generation_type, evidence_coverage,
       dispute_status, evidence_note, editor_id, created_at)
    VALUES ('revision', 'card', NULL, 1, 0, 'zh-CN', '测试答案标题',
            '这是用于数据库不变量测试的简答。', '测试答案', 'universal', '2026-08-29',
            1800000000, 2000000000, 'editor', '内容编辑组', '${generation}',
            'linked_only', 'none', NULL, 'editor', 1800000000);
    INSERT INTO answer_card_revision_sentences
      (card_revision_id, sentence_key, ordinal, text, is_factual)
    VALUES ('revision', 's1', 1, '这是一个需要来源的事实句。', 1);
  `);
  if (citation) {
    db.exec(`
      INSERT INTO answer_card_sentence_citations
        (card_revision_id, sentence_key, ordinal, evidence_span_id, link_citation_id)
      VALUES ('revision', 's1', 1, NULL, 'link');
    `);
  }
}

function insertPilot(
  db,
  { isTest = false, suffix = '', sessionExpired = false } = {},
) {
  const participant = `participant${suffix}`;
  const invitation = `invitation${suffix}`;
  const consent = `consent${suffix}`;
  const session = `session${suffix}`;
  const token = `token-hash${suffix}`;
  db.prepare(`
    INSERT INTO pilot_participants
      (id, participant_ref_hmac, participant_hint, recruitment_channel,
       is_test, adult_verified_at, adult_verified_by, status, created_at,
       withdrawn_at)
    VALUES (?, ?, 'ABC123', 'campus', ?, unixepoch() - 20, 'editor',
            'active', unixepoch() - 20, NULL)
  `).run(participant, `participant-hmac${suffix}`, isTest ? 1 : 0);
  db.prepare(`
    INSERT INTO pilot_invitations
      (id, participant_id, token_hash, issued_by, issued_at, expires_at,
       redeemed_at, revoked_at, revoked_by, lock_version)
    VALUES (?, ?, ?, 'editor', unixepoch() - 20, unixepoch() + 3600,
            unixepoch() - 10, NULL, NULL, 1)
  `).run(invitation, participant, `invite-hash${suffix}`);
  db.prepare(`
    INSERT INTO pilot_consent_records
      (id, participant_id, invitation_id, notice_version, purpose,
       separate_consent, granted_at, withdrawn_at)
    VALUES (?, ?, ?, ?, 'stage1_product_research', 1,
            unixepoch() - 10, NULL)
  `).run(consent, participant, invitation, PILOT_NOTICE_VERSION);
  db.prepare(`
    INSERT INTO pilot_sessions
      (id, participant_id, consent_id, invitation_id, token_hash,
       issued_at, expires_at, revoked_at)
    VALUES (?, ?, ?, ?, ?, unixepoch() - 10,
            ${sessionExpired ? 'unixepoch() - 1' : 'unixepoch() + 3600'}, NULL)
  `).run(session, participant, consent, invitation, token);
  return { participant, invitation, consent, session };
}

function attemptPublish(db, operationId = 'operation', expectedVersion = 0) {
  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO publish_operations
        (id, card_id, revision_id, expected_card_version, reviewer_id, reason,
         request_id, created_at, applied_at)
      VALUES (?, 'card', 'revision', ?, 'reviewer', '完成逐项审核并批准', ?, 1800000000, NULL)
    `).run(operationId, expectedVersion, `request-${operationId}`);
    db.prepare(`
      UPDATE answer_cards
      SET publication_status = 'published', current_public_revision_id = 'revision',
          lock_version = lock_version + 1, last_publish_operation_id = ?
      WHERE id = 'card'
    `).run(operationId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

test('link-only revisions cannot store content or create evidence spans', () => {
  const db = createDatabase();
  insertBase(db);
  assert.throws(
    () =>
      db.exec(`
    INSERT INTO artifact_revisions
      (id, artifact_id, published_at, captured_at, recorded_at, visibility, rights_mode,
       rights_expires_at, content_hash, archived_text)
    VALUES ('bad', 'artifact', NULL, 1800000000, 1800000000, 'public', 'link_only',
            NULL, 'hash', 'secret text');
  `),
    /artifact_revisions_link_only_storage_check/u,
  );
  assert.throws(
    () =>
      db.exec(`
    INSERT INTO evidence_spans
      (id, artifact_revision_id, locator_kind, locator_value, quote, span_hash,
       visibility, created_at)
    VALUES ('span', 'artifact-link-v1', 'section', 'one', 'quote', 'hash', 'public', 1800000000);
  `),
    /evidence_requires_public_quote_rights/u,
  );
  db.close();
});

test('sentence citations enforce an exact-one source constraint', () => {
  const db = createDatabase();
  insertBase(db, { citation: false });
  assert.throws(
    () =>
      db.exec(`
    INSERT INTO answer_card_sentence_citations
      (card_revision_id, sentence_key, ordinal, evidence_span_id, link_citation_id)
    VALUES ('revision', 's1', 1, NULL, NULL);
  `),
    /answer_card_sentence_citations_exactly_one_source_check/u,
  );
  db.close();
});

test('publish is atomic, advances the pointer, and appends an audit event', () => {
  const db = createDatabase();
  insertBase(db);
  attemptPublish(db);
  const card = db
    .prepare(
      "SELECT current_public_revision_id, lock_version FROM answer_cards WHERE id = 'card'",
    )
    .get();
  assert.deepEqual(
    { ...card },
    { current_public_revision_id: 'revision', lock_version: 1 },
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS total FROM audit_events WHERE action = 'answer_card.publish'",
      )
      .get().total,
    1,
  );
  assert.ok(
    db
      .prepare(
        "SELECT applied_at FROM publish_operations WHERE id = 'operation'",
      )
      .get().applied_at,
  );
  db.close();
});

test('failed publish rolls back the review operation and keeps the pointer unchanged', () => {
  const db = createDatabase();
  insertBase(db, { citation: false });
  assert.throws(() => attemptPublish(db), /factual_sentence_missing_citation/u);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS total FROM publish_operations').get().total,
    0,
  );
  assert.deepEqual(
    {
      ...db
        .prepare(
          "SELECT current_public_revision_id, lock_version FROM answer_cards WHERE id = 'card'",
        )
        .get(),
    },
    { current_public_revision_id: null, lock_version: 0 },
  );
  db.close();
});

test('high-risk link-only and AI drafts are blocked at publish time', () => {
  const highRisk = createDatabase();
  insertBase(highRisk, { risk: 'high' });
  assert.throws(
    () => attemptPublish(highRisk),
    /high_risk_publishing_disabled/u,
  );
  highRisk.close();

  const aiDraft = createDatabase();
  insertBase(aiDraft, { generation: 'ai_draft' });
  assert.throws(() => attemptPublish(aiDraft), /revision_not_publishable/u);
  aiDraft.close();
});

test('answer-card hiding is versioned, atomic, and audited', () => {
  const db = createDatabase();
  insertBase(db);
  attemptPublish(db);
  db.exec('BEGIN');
  try {
    db.exec(`
      INSERT INTO workflow_operations
        (id, target_type, target_id, expected_version, target_status, actor_id,
         reason, request_id, created_at, applied_at)
      VALUES ('hide-op', 'answer_card', 'card', 1, 'hidden', 'editor',
              '确认隐私风险后紧急隐藏', 'hide-request', 1800000001, NULL);
      UPDATE answer_cards
      SET publication_status = 'hidden', lock_version = lock_version + 1,
          last_workflow_operation_id = 'hide-op'
      WHERE id = 'card';
    `);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  assert.deepEqual(
    {
      ...db
        .prepare(
          "SELECT publication_status, lock_version FROM answer_cards WHERE id = 'card'",
        )
        .get(),
    },
    { publication_status: 'hidden', lock_version: 2 },
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS total FROM audit_events WHERE action = 'answer_card.hide'",
      )
      .get().total,
    1,
  );
  assert.throws(
    () =>
      db.exec(
        "UPDATE answer_cards SET publication_status = 'published' WHERE id = 'card'",
      ),
    /invalid_answer_card_visibility_version|missing_or_stale_answer_card_workflow/u,
  );
  db.close();
});

test('report workflow rejects unaudited or stale status changes', () => {
  const db = createDatabase();
  insertBase(db);
  db.exec(`
    INSERT INTO reports
      (id, public_code, target_card_id, affected_area, type, status, public_response,
       created_at, updated_at, resolved_at)
    VALUES ('report', 'XG-0123456789ABCDEF0123456789ABCDEF', NULL, 'other', 'privacy',
            'received', NULL, 1800000000, 1800000000, NULL);
  `);
  assert.throws(
    () =>
      db.exec("UPDATE reports SET status = 'reviewing' WHERE id = 'report'"),
    /invalid_report_workflow_version|missing_or_stale_report_workflow/u,
  );
  assert.equal(
    db.prepare("SELECT status FROM reports WHERE id = 'report'").get().status,
    'received',
  );
  assert.equal(
    db.prepare('SELECT COUNT(*) AS total FROM audit_events').get().total,
    0,
  );
  db.close();
});

test('report public response cannot change without a status transition', () => {
  const db = createDatabase();
  insertBase(db);
  db.exec(`
    INSERT INTO reports
      (id, public_code, target_card_id, affected_area, type, status, public_response,
       created_at, updated_at, resolved_at)
    VALUES ('report', 'XG-1123456789ABCDEF0123456789ABCDEF', NULL, 'other', 'privacy',
            'received', NULL, 1800000000, 1800000000, NULL);
  `);
  assert.throws(
    () =>
      db.exec(`
        UPDATE reports
        SET public_response = '绕过状态机写入的公开说明',
            lock_version = lock_version + 1
        WHERE id = 'report';
      `),
    /report_update_requires_status_change/u,
  );
  assert.deepEqual(
    {
      ...db
        .prepare(
          "SELECT status, public_response, lock_version FROM reports WHERE id = 'report'",
        )
        .get(),
    },
    { status: 'received', public_response: null, lock_version: 0 },
  );
  assert.equal(
    db.prepare('SELECT COUNT(*) AS total FROM audit_events').get().total,
    0,
  );
  db.close();
});

test('reports must be inserted in the received state', () => {
  const db = createDatabase();
  assert.throws(
    () =>
      db.exec(`
        INSERT INTO reports
          (id, public_code, target_card_id, affected_area, type, status, public_response,
           created_at, updated_at, resolved_at)
        VALUES ('report', 'XG-3123456789ABCDEF0123456789ABCDEF', NULL,
                'other', 'privacy', 'resolved', '不应直接插入终态报告',
                1800000000, 1800000000, 1800000000);
      `),
    /invalid_report_initial_state/u,
  );
  db.close();
});

test('report workflow records reviewing and a public resolution atomically', () => {
  const db = createDatabase();
  insertBase(db);
  db.exec(`
    INSERT INTO reports
      (id, public_code, target_card_id, affected_area, type, status, public_response,
       created_at, updated_at, resolved_at)
    VALUES ('report', 'XG-2123456789ABCDEF0123456789ABCDEF', NULL, 'other', 'privacy',
            'received', NULL, 1800000000, 1800000000, NULL);
  `);

  applyReportTransition(db, {
    operationId: 'report-reviewing',
    fromVersion: 0,
    status: 'reviewing',
    at: 1800000010,
  });
  applyReportTransition(db, {
    operationId: 'report-resolved',
    fromVersion: 1,
    status: 'resolved',
    publicResponse: '已核对公开来源并修正答案中的适用范围。',
    at: 1800000020,
  });

  assert.deepEqual(
    {
      ...db
        .prepare(
          `SELECT status, public_response, reviewing_at, resolved_at,
                  updated_at, lock_version
           FROM reports WHERE id = 'report'`,
        )
        .get(),
    },
    {
      status: 'resolved',
      public_response: '已核对公开来源并修正答案中的适用范围。',
      reviewing_at: 1800000010,
      resolved_at: 1800000020,
      updated_at: 1800000020,
      lock_version: 2,
    },
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS total FROM audit_events WHERE action = 'report.update'",
      )
      .get().total,
    2,
  );
  assert.equal(
    db
      .prepare(
        'SELECT COUNT(*) AS total FROM workflow_operations WHERE applied_at IS NOT NULL',
      )
      .get().total,
    2,
  );
  db.close();
});

test('legacy terminal reports are backfilled before strict workflow triggers', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  applyMigrations(db, migrationFiles.slice(0, 3));
  db.exec(`
    INSERT INTO reports
      (id, public_code, target_card_id, type, status, public_response,
       created_at, resolved_at, lock_version, last_workflow_operation_id)
    VALUES ('legacy-report', 'XG-LEGACY', NULL, 'privacy', 'resolved', NULL,
            1700000000, NULL, 0, NULL)
  `);
  applyMigrations(db, migrationFiles.slice(3));
  const row = db
    .prepare(`
      SELECT reviewing_at, resolved_at, public_response, updated_at
      FROM reports WHERE id = 'legacy-report'
    `)
    .get();
  assert.equal(row.reviewing_at, 1700000000);
  assert.equal(row.resolved_at, 1700000000);
  assert.equal(row.updated_at, 1700000000);
  assert.match(row.public_response, /历史处理记录/u);
  db.close();
});

function applyReportTransition(
  db,
  { operationId, fromVersion, status, publicResponse = null, at },
) {
  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO workflow_operations
        (id, target_type, target_id, expected_version, target_status, actor_id,
         reason, request_id, created_at, applied_at)
      VALUES (?, 'report', 'report', ?, ?, 'editor', '处理报告', ?, ?, NULL)
    `).run(operationId, fromVersion, status, `request-${operationId}`, at);
    db.prepare(`
      UPDATE reports
      SET status = ?, public_response = ?,
          reviewing_at = CASE WHEN ? = 'reviewing' THEN ? ELSE reviewing_at END,
          resolved_at = CASE WHEN ? IN ('resolved', 'closed') THEN ? ELSE NULL END,
          updated_at = ?, lock_version = lock_version + 1,
          last_workflow_operation_id = ?
      WHERE id = 'report'
    `).run(status, publicResponse, status, at, status, at, at, operationId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

test('expired research intake purge removes linkable payload fields', () => {
  const db = createDatabase();
  const pilot = insertPilot(db);
  db.prepare(`
    INSERT INTO research_intakes
      (id, participant_ref_hash, pilot_participant_id, kind, context_scope,
       body, source_url, provenance_role, status, submitted_at, expires_at,
       purged_at)
    VALUES ('intake', 'managed', ?, 'material', '苏州校区', '私有正文',
            'https://example.com/material', 'lead_only', 'submitted', 1, 2,
            NULL)
  `).run(pilot.participant);
  db.exec(`
    UPDATE research_intakes
    SET participant_ref_hash = 'purged', pilot_participant_id = NULL,
        context_scope = '已按保留期限清理', body = NULL, source_url = NULL,
        provenance_role = NULL,
        status = 'expired', purged_at = unixepoch()
    WHERE id = 'intake';
  `);
  assert.deepEqual(
    {
      ...db
        .prepare(
          `SELECT participant_ref_hash, context_scope, body, source_url,
                  provenance_role, status
           FROM research_intakes WHERE id = 'intake'`,
        )
        .get(),
    },
    {
      participant_ref_hash: 'purged',
      context_scope: '已按保留期限清理',
      body: null,
      source_url: null,
      provenance_role: null,
      status: 'expired',
    },
  );
  db.close();
});

test('pilot consent and session require one redeemed adult invitation', () => {
  const db = createDatabase();
  insertPilot(db);
  assert.throws(
    () =>
      db.exec(`
        INSERT INTO pilot_sessions
          (id, participant_id, consent_id, invitation_id, token_hash,
           issued_at, expires_at, revoked_at)
        VALUES ('second-session', 'participant', 'consent', 'invitation',
                'second-token', unixepoch(), unixepoch() + 3600, NULL)
      `),
    /idx_pilot_sessions_invitation|UNIQUE constraint failed/u,
  );
  assert.throws(
    () =>
      db.exec(`
        UPDATE pilot_sessions SET expires_at = unixepoch() + 7200
        WHERE id = 'session'
      `),
    /pilot_session_core_fields_immutable/u,
  );
  db.close();
});

test('query measurement excludes test traffic and never needs raw query text', () => {
  const db = createDatabase();
  insertBase(db);
  attemptPublish(db);
  const formal = insertPilot(db);
  const testPilot = insertPilot(db, { isTest: true, suffix: '-test' });
  db.prepare(`
    INSERT INTO query_events
      (id, principal_kind, pilot_session_id, qualified,
       qualification_rule_version, retrieval_status, query_length_bucket,
       has_topic_filter, scope_filter_count, result_count, retrieval_version,
       created_at)
    VALUES ('11111111-1111-4111-8111-111111111111',
            'research_participant', ?, 1, 'stage1-v1', 'completed', 'short',
            0, 0, 1, 'ranker-v1', unixepoch())
  `).run(formal.session);
  assert.throws(
    () =>
      db
        .prepare(`
        INSERT INTO query_events
          (id, principal_kind, pilot_session_id, qualified,
           qualification_rule_version, retrieval_status, query_length_bucket,
           has_topic_filter, scope_filter_count, result_count,
           retrieval_version, created_at)
        VALUES ('22222222-2222-4222-8222-222222222222',
                'research_participant', ?, 1, 'stage1-v1', 'completed',
                'short', 0, 0, 0, 'ranker-v1', unixepoch())
      `)
        .run(testPilot.session),
    /test_participant_query_cannot_be_qualified/u,
  );
  const columns = db
    .prepare("PRAGMA table_info('query_events')")
    .all()
    .map((row) => row.name);
  assert.equal(columns.includes('query'), false);
  assert.equal(columns.includes('query_hash'), false);
  db.close();
});

test('feedback linked to a query requires an impressed and opened revision', () => {
  const db = createDatabase();
  insertBase(db);
  attemptPublish(db);
  const pilot = insertPilot(db);
  const queryId = '33333333-3333-4333-8333-333333333333';
  db.prepare(`
    INSERT INTO query_events
      (id, principal_kind, pilot_session_id, qualified,
       qualification_rule_version, retrieval_status, query_length_bucket,
       has_topic_filter, scope_filter_count, result_count, retrieval_version,
       created_at)
    VALUES (?, 'research_participant', ?, 1, 'stage1-v1', 'completed',
            'medium', 0, 0, 1, 'ranker-v1', unixepoch())
  `).run(queryId, pilot.session);
  db.prepare(`
    INSERT INTO query_result_impressions
      (query_event_id, card_id, card_revision_id, rank, recorded_at)
    VALUES (?, 'card', 'revision', 1, unixepoch())
  `).run(queryId);
  assert.throws(
    () =>
      db
        .prepare(`
        INSERT INTO feedback_events
          (id, card_revision_id, query_event_id, outcome, created_at)
        VALUES ('feedback-before-open', 'revision', ?, 'resolved', unixepoch())
      `)
        .run(queryId),
    /feedback_requires_answer_open/u,
  );
  db.prepare(`
    INSERT INTO answer_open_events
      (query_event_id, card_revision_id, opened_at)
    VALUES (?, 'revision', unixepoch())
  `).run(queryId);
  db.prepare(`
    INSERT INTO feedback_events
      (id, card_revision_id, query_event_id, outcome, created_at)
    VALUES ('feedback', 'revision', ?, 'resolved', unixepoch())
  `).run(queryId);
  assert.throws(
    () =>
      db
        .prepare(`
        INSERT INTO feedback_events
          (id, card_revision_id, query_event_id, outcome, created_at)
        VALUES ('feedback-again', 'revision', ?, 'unclear', unixepoch())
      `)
        .run(queryId),
    /idx_feedback_query_revision_unique|UNIQUE constraint failed/u,
  );
  db.close();
});

test('withdrawing a participant revokes invitations and sessions monotonically', () => {
  const db = createDatabase();
  const pilot = insertPilot(db);
  db.prepare(`
    UPDATE pilot_participants
    SET participant_ref_hmac = NULL, participant_hint = 'withdrawn',
        status = 'withdrawn', withdrawn_at = unixepoch()
    WHERE id = ?
  `).run(pilot.participant);
  assert.ok(
    db
      .prepare('SELECT revoked_at FROM pilot_sessions WHERE id = ?')
      .get(pilot.session).revoked_at,
  );
  db.prepare(`
    UPDATE pilot_invitations
    SET token_hash = 'withdrawn:' || id
    WHERE id = ?
  `).run(pilot.invitation);
  assert.equal(
    db
      .prepare('SELECT token_hash FROM pilot_invitations WHERE id = ?')
      .get(pilot.invitation).token_hash,
    `withdrawn:${pilot.invitation}`,
  );
  assert.throws(
    () =>
      db
        .prepare('UPDATE pilot_invitations SET token_hash = ? WHERE id = ?')
        .run('relinked-token', pilot.invitation),
    /pilot_invitation_token_is_immutable/u,
  );
  assert.ok(
    db
      .prepare('SELECT revoked_at FROM pilot_invitations WHERE id = ?')
      .get(pilot.invitation).revoked_at,
  );
  assert.throws(
    () =>
      db
        .prepare(`
        UPDATE pilot_sessions SET revoked_at = NULL WHERE id = ?
      `)
        .run(pilot.session),
    /pilot_session_revocation_is_monotonic/u,
  );
  db.close();
});

test('withdrawal clears only the participant query and session idempotency scopes', () => {
  const db = createDatabase();
  const owner = insertPilot(db, { suffix: '-owner' });
  const other = insertPilot(db, { suffix: '-other' });
  for (const [queryId, sessionId] of [
    ['withdraw-owner-query', owner.session],
    ['withdraw-other-query', other.session],
  ]) {
    db.prepare(`
      INSERT INTO query_events
        (id, principal_kind, pilot_session_id, qualified,
         qualification_rule_version, retrieval_status, query_length_bucket,
         has_topic_filter, scope_filter_count, result_count, retrieval_version,
         created_at)
      VALUES (?, 'research_participant', ?, 1, 'stage1-explicit-submit-v2',
              'completed', 'short', 0, 0, 0, 'ranker-v1', unixepoch())
    `).run(queryId, sessionId);
  }
  for (const actorScope of [
    'query:withdraw-owner-query',
    'pilot-session:session-owner',
    'query:withdraw-other-query',
    'pilot-session:session-other',
    'anonymous:unrelated',
  ]) {
    db.prepare(`
      INSERT INTO idempotency_records
        (actor_scope, route, key_hash, request_hash, status_code,
         response_json, created_at, expires_at)
      VALUES (?, '/test', 'key', 'request', 201, '{}', unixepoch(),
              unixepoch() + 3600)
    `).run(actorScope);
  }

  db.prepare(PURGE_WITHDRAWN_QUERY_IDEMPOTENCY_SQL).run(owner.participant);
  db.prepare(DETACH_WITHDRAWN_QUERY_EVENTS_SQL).run(owner.participant);
  db.prepare(PURGE_WITHDRAWN_SESSION_IDEMPOTENCY_SQL).run(owner.participant);

  const remainingScopes = db
    .prepare('SELECT actor_scope FROM idempotency_records ORDER BY actor_scope')
    .all()
    .map((row) => row.actor_scope);
  assert.deepEqual(remainingScopes, [
    'anonymous:unrelated',
    'pilot-session:session-other',
    'query:withdraw-other-query',
  ]);
  assert.deepEqual(
    {
      ...db
        .prepare(
          'SELECT principal_kind, pilot_session_id, qualified FROM query_events WHERE id = ?',
        )
        .get('withdraw-owner-query'),
    },
    {
      principal_kind: 'withdrawn',
      pilot_session_id: null,
      qualified: 0,
    },
  );
  assert.equal(
    db
      .prepare('SELECT pilot_session_id FROM query_events WHERE id = ?')
      .get('withdraw-other-query').pilot_session_id,
    other.session,
  );
  db.close();
});

test('withdrawn queries reject in-flight impressions, opens, feedback, and shares', () => {
  const db = createDatabase();
  insertBase(db);
  attemptPublish(db);
  const pilot = insertPilot(db);
  for (const id of [
    'withdraw-q1',
    'withdraw-q2',
    'withdraw-q3',
    'withdraw-q4',
  ]) {
    db.prepare(`
      INSERT INTO query_events
        (id, principal_kind, pilot_session_id, qualified,
         qualification_rule_version, retrieval_status, query_length_bucket,
         has_topic_filter, scope_filter_count, result_count, retrieval_version,
         created_at)
      VALUES (?, 'research_participant', ?, 1, 'stage1-explicit-submit-v2',
              'completed', 'short', 0, 0, 1, 'ranker-v1', unixepoch())
    `).run(id, pilot.session);
  }
  for (const id of ['withdraw-q2', 'withdraw-q3', 'withdraw-q4']) {
    db.prepare(`
      INSERT INTO query_result_impressions
        (query_event_id, card_id, card_revision_id, rank, recorded_at)
      VALUES (?, 'card', 'revision', 1, unixepoch())
    `).run(id);
  }
  for (const id of ['withdraw-q3', 'withdraw-q4']) {
    db.prepare(`
      INSERT INTO answer_open_events
        (query_event_id, card_revision_id, opened_at)
      VALUES (?, 'revision', unixepoch())
    `).run(id);
  }
  db.prepare(`
    UPDATE pilot_participants
    SET participant_ref_hmac = NULL, participant_hint = 'withdrawn',
        status = 'withdrawn', withdrawn_at = unixepoch()
    WHERE id = ?
  `).run(pilot.participant);
  db.prepare(`
    UPDATE query_events
    SET principal_kind = 'withdrawn', pilot_session_id = NULL, qualified = 0
    WHERE id LIKE 'withdraw-q%'
  `).run();

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO query_result_impressions
          (query_event_id, card_id, card_revision_id, rank, recorded_at)
        VALUES ('withdraw-q1', 'card', 'revision', 1, unixepoch())
      `),
    /withdrawn_query_rejects_new_events/u,
  );
  assert.throws(
    () =>
      db.exec(`
        INSERT INTO answer_open_events
          (query_event_id, card_revision_id, opened_at)
        VALUES ('withdraw-q2', 'revision', unixepoch())
      `),
    /withdrawn_query_rejects_new_events/u,
  );
  assert.throws(
    () =>
      db.exec(`
        INSERT INTO feedback_events
          (id, card_revision_id, query_event_id, outcome, created_at)
        VALUES ('withdraw-feedback', 'revision', 'withdraw-q3', 'resolved',
                unixepoch())
      `),
    /withdrawn_query_rejects_new_events/u,
  );
  assert.throws(
    () =>
      db.exec(`
        INSERT INTO answer_share_events
          (query_event_id, card_revision_id, shared_at)
        VALUES ('withdraw-q4', 'revision', unixepoch())
      `),
    /answer_share_requires_active_query_open/u,
  );
  db.close();
});

test('active pilot inserts succeed and privacy reports require a structured area', () => {
  const db = createDatabase();
  insertBase(db);
  attemptPublish(db);
  const pilot = insertPilot(db);
  db.prepare(`
    INSERT INTO reports
      (id, public_code, target_card_id, pilot_participant_id, affected_area,
       type, status, created_at, updated_at)
    VALUES ('active-report', 'XG-ACTIVE', 'card', ?, NULL, 'stale',
            'received', unixepoch(), unixepoch())
  `).run(pilot.participant);
  db.prepare(`
    INSERT INTO research_intakes
      (id, participant_ref_hash, pilot_participant_id, kind, context_scope,
       body, status, submitted_at, expires_at)
    VALUES ('active-intake', 'managed', ?, 'question', '苏州校区',
            '一个不包含个人信息的测试问题', 'submitted', unixepoch(),
            unixepoch() + 3600)
  `).run(pilot.participant);
  assert.throws(
    () =>
      db.exec(`
        INSERT INTO reports
          (id, public_code, target_card_id, affected_area, type, status,
           created_at, updated_at)
        VALUES ('privacy-no-area', 'XG-PRIVACY-NO-AREA', NULL, NULL,
                'privacy', 'received', unixepoch(), unixepoch())
      `),
    /privacy_report_requires_affected_area/u,
  );
  db.exec(`
    INSERT INTO reports
      (id, public_code, target_card_id, affected_area, type, status,
       created_at, updated_at)
    VALUES ('privacy-area', 'XG-PRIVACY-AREA', NULL, 'search', 'privacy',
            'received', unixepoch(), unixepoch())
  `);
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS total FROM reports WHERE id IN ('active-report', 'privacy-area')",
      )
      .get().total,
    2,
  );
  db.close();
});

test('reports and private intakes require an active pilot at insert time', () => {
  for (const scenario of [
    'withdrawn',
    'revoked-invitation',
    'revoked-session',
    'withdrawn-consent',
    'expired-session',
    'missing-session',
  ]) {
    const db = createDatabase();
    const pilot = insertPilot(db, {
      sessionExpired: scenario === 'expired-session',
    });
    if (scenario === 'withdrawn') {
      db.prepare(`
        UPDATE pilot_participants
        SET participant_ref_hmac = NULL, participant_hint = 'withdrawn',
            status = 'withdrawn', withdrawn_at = unixepoch()
        WHERE id = ?
      `).run(pilot.participant);
    }
    if (scenario === 'revoked-invitation') {
      db.prepare(`
        UPDATE pilot_invitations
        SET revoked_at = unixepoch(), revoked_by = 'editor',
            lock_version = lock_version + 1
        WHERE id = ?
      `).run(pilot.invitation);
    }
    if (scenario === 'revoked-session') {
      db.prepare(`
        UPDATE pilot_sessions
        SET token_hash = 'revoked:' || id, revoked_at = unixepoch()
        WHERE id = ?
      `).run(pilot.session);
    }
    if (scenario === 'withdrawn-consent') {
      db.prepare(`
        UPDATE pilot_consent_records
        SET withdrawn_at = unixepoch()
        WHERE id = ?
      `).run(pilot.consent);
    }
    if (scenario === 'missing-session') {
      db.prepare('DELETE FROM pilot_sessions WHERE id = ?').run(pilot.session);
    }
    assert.throws(
      () =>
        db
          .prepare(`
          INSERT INTO reports
            (id, public_code, target_card_id, pilot_participant_id, type,
             status, public_response, lock_version,
             last_workflow_operation_id, created_at, reviewing_at, updated_at,
             resolved_at)
          VALUES (?, ?, NULL, ?, 'stale', 'received', NULL, 0, NULL,
                  unixepoch(), NULL, unixepoch(), NULL)
        `)
          .run(`report-${scenario}`, `XG-${scenario}`, pilot.participant),
      /report_requires_active_pilot_session/u,
    );
    assert.throws(
      () =>
        db
          .prepare(`
          INSERT INTO research_intakes
            (id, participant_ref_hash, pilot_participant_id,
             origin_query_event_id, kind, context_scope, body, source_url,
             provenance_role, status, lock_version,
             last_workflow_operation_id, submitted_at, expires_at, purged_at)
          VALUES (?, 'managed', ?, NULL, 'question', '苏州校区',
                  '一个不包含个人信息的测试问题', NULL, NULL, 'submitted', 0,
                  NULL, unixepoch(), unixepoch() + 3600, NULL)
        `)
          .run(`intake-${scenario}`, pilot.participant),
      /research_intake_requires_active_pilot_session/u,
    );
    db.close();
  }
});

test('private intake query context must belong to the same participant', () => {
  const db = createDatabase();
  const first = insertPilot(db, { suffix: '-first' });
  const second = insertPilot(db, { suffix: '-second' });
  db.prepare(`
    INSERT INTO query_events
      (id, principal_kind, pilot_session_id, qualified,
       qualification_rule_version, retrieval_status, query_length_bucket,
       has_topic_filter, scope_filter_count, result_count, retrieval_version,
       created_at)
    VALUES ('44444444-4444-4444-8444-444444444444',
            'research_participant', ?, 1, 'stage1-v1', 'completed', 'short',
            0, 0, 0, 'ranker-v1', unixepoch())
  `).run(first.session);
  assert.throws(
    () =>
      db
        .prepare(`
        INSERT INTO research_intakes
          (id, participant_ref_hash, pilot_participant_id,
           origin_query_event_id, kind, context_scope, body, source_url,
           provenance_role, status, lock_version,
           last_workflow_operation_id, submitted_at, expires_at, purged_at)
        VALUES ('intake-mismatch', 'managed', ?,
                '44444444-4444-4444-8444-444444444444', 'question',
                '苏州校区', '一个不包含个人信息的测试问题', NULL, NULL,
                'submitted', 0, NULL, unixepoch(), unixepoch() + 3600, NULL)
      `)
        .run(second.participant),
    /research_intake_query_participant_mismatch/u,
  );
  db.close();
});

test('private intake rejects anonymous and withdrawn query origins', () => {
  const db = createDatabase();
  const pilot = insertPilot(db);
  for (const [id, principal] of [
    ['anonymous-origin', 'public_anonymous'],
    ['withdrawn-origin', 'withdrawn'],
  ]) {
    db.prepare(`
      INSERT INTO query_events
        (id, principal_kind, pilot_session_id, qualified,
         qualification_rule_version, retrieval_status, query_length_bucket,
         has_topic_filter, scope_filter_count, result_count, retrieval_version,
         created_at)
      VALUES (?, ?, NULL, 0, 'stage1-explicit-submit-v2', 'completed', 'short',
              0, 0, 0, 'ranker-v1', unixepoch())
    `).run(id, principal);
    assert.throws(
      () =>
        db
          .prepare(`
            INSERT INTO research_intakes
              (id, participant_ref_hash, pilot_participant_id,
               origin_query_event_id, kind, context_scope, body, status,
               submitted_at, expires_at)
            VALUES (?, 'managed', ?, ?, 'question', '苏州校区',
                    '一个不包含个人信息的测试问题', 'submitted', unixepoch(),
                    unixepoch() + 3600)
          `)
          .run(`intake-${id}`, pilot.participant, id),
      /research_intake_query_participant_mismatch/u,
    );
  }
  db.close();
});

test('formal pilot metrics use all qualified queries and exclude anonymous and editor traffic', () => {
  const db = createDatabase();
  insertBase(db);
  attemptPublish(db);
  const pilot = insertPilot(db);
  const rows = [
    ['q1', 'research_participant', pilot.session, 1, 4],
    ['q2', 'research_participant', pilot.session, 1, 0],
    ['q3', 'research_participant', pilot.session, 1, 2],
    ['q4', 'public_anonymous', null, 0, 1],
    ['q5', 'editor', null, 0, 1],
  ];
  for (const [id, kind, sessionId, qualified, resultCount] of rows) {
    db.prepare(`
      INSERT INTO query_events
        (id, principal_kind, pilot_session_id, qualified,
         qualification_rule_version, retrieval_status, query_length_bucket,
         has_topic_filter, scope_filter_count, result_count, retrieval_version,
         created_at)
      VALUES (?, ?, ?, ?, 'stage1-v1', 'completed', 'medium', 0, 0, ?,
              'ranker-v1', unixepoch())
    `).run(id, kind, sessionId, qualified, resultCount);
  }
  for (const [queryId, rank, outcome] of [
    ['q1', 2, 'resolved'],
    ['q3', 1, 'unclear'],
    ['q4', 1, 'resolved'],
  ]) {
    db.prepare(`
      INSERT INTO query_result_impressions
        (query_event_id, card_id, card_revision_id, rank, recorded_at)
      VALUES (?, 'card', 'revision', ?, unixepoch())
    `).run(queryId, rank);
    db.prepare(`
      INSERT INTO answer_open_events
        (query_event_id, card_revision_id, opened_at)
      VALUES (?, 'revision', unixepoch())
    `).run(queryId);
    db.prepare(`
      INSERT INTO feedback_events
        (id, card_revision_id, query_event_id, outcome, created_at)
      VALUES (?, 'revision', ?, ?, unixepoch())
    `).run(`feedback-${queryId}`, queryId, outcome);
    if (queryId === 'q1') {
      db.prepare(`
        INSERT INTO answer_share_events
          (query_event_id, card_revision_id, shared_at)
        VALUES (?, 'revision', unixepoch())
      `).run(queryId);
    }
  }
  const metrics = db.prepare(pilotMetricSql(FORMAL_PILOT_METRIC_WHERE)).get();
  assert.deepEqual(
    {
      queries: metrics.queries,
      completed: metrics.completed,
      zeroResults: metrics.zero_results,
      responded: metrics.responded,
      resolved: metrics.resolved,
      shared: metrics.shared,
      topThreeResolved: metrics.top_three_resolved,
    },
    {
      queries: 3,
      completed: 3,
      zeroResults: 1,
      responded: 2,
      resolved: 1,
      shared: 1,
      topThreeResolved: 1,
    },
  );
  db.close();
});

test('frozen pilot metrics exclude late interactions and survive device exit', () => {
  const db = createDatabase();
  insertBase(db);
  attemptPublish(db);
  const pilot = insertPilot(db);
  const windowStart = 1_800_000_000;
  const windowEnd = 1_800_000_200;

  for (const [id, eventAt] of [
    ['window-query', windowStart + 10],
    ['late-interaction-query', windowStart + 20],
  ]) {
    db.prepare(`
      INSERT INTO query_events
        (id, principal_kind, pilot_session_id, qualified,
         qualification_rule_version, retrieval_status, query_length_bucket,
         has_topic_filter, scope_filter_count, result_count, retrieval_version,
         created_at)
      VALUES (?, 'research_participant', ?, 1, 'stage1-explicit-submit-v2',
              'completed', 'medium', 0, 0, 1, 'ranker-v1', ?)
    `).run(id, pilot.session, eventAt);
  }
  for (const [id, interactionAt] of [
    ['window-query', windowStart + 30],
    ['late-interaction-query', windowEnd + 30],
  ]) {
    db.prepare(`
      INSERT INTO query_result_impressions
        (query_event_id, card_id, card_revision_id, rank, recorded_at)
      VALUES (?, 'card', 'revision', 1, ?)
    `).run(id, interactionAt);
    db.prepare(`
      INSERT INTO answer_open_events
        (query_event_id, card_revision_id, opened_at)
      VALUES (?, 'revision', ?)
    `).run(id, interactionAt);
    db.prepare(`
      INSERT INTO answer_share_events
        (query_event_id, card_revision_id, shared_at)
      VALUES (?, 'revision', ?)
    `).run(id, interactionAt);
    db.prepare(`
      INSERT INTO feedback_events
        (id, card_revision_id, query_event_id, outcome, created_at)
      VALUES (?, 'revision', ?, 'resolved', ?)
    `).run(`feedback-${id}`, id, interactionAt);
  }

  db.prepare(`
    UPDATE pilot_sessions
    SET token_hash = 'revoked:' || id, revoked_at = unixepoch()
    WHERE id = ?
  `).run(pilot.session);

  const formal = db
    .prepare(pilotMetricSql(FORMAL_PILOT_METRIC_WHERE, true))
    .get(windowStart, windowEnd);
  const participants = db
    .prepare(pilotParticipantSql(true))
    .get(windowStart, windowEnd);
  const sharingParticipants = db
    .prepare(pilotSharingParticipantSql(true))
    .get(windowStart, windowEnd);
  assert.deepEqual(
    {
      queries: formal.queries,
      opened: formal.opened,
      shared: formal.shared,
      responded: formal.responded,
      resolved: formal.resolved,
      participants: participants.total,
      sharingParticipants: sharingParticipants.total,
    },
    {
      queries: 2,
      opened: 1,
      shared: 1,
      responded: 1,
      resolved: 1,
      participants: 1,
      sharingParticipants: 1,
    },
  );
  db.close();
});

test('a query event cannot be refined after its frozen window closes', () => {
  assert.equal(isQueryEventFrozen(100, 199, 200), false);
  assert.equal(isQueryEventFrozen(100, 200, 200), true);
  assert.equal(isQueryEventFrozen(200, 250, 200), false);
  assert.equal(isQueryEventFrozen(100, 250, null), false);
});

test('120-day retention deletes the complete research interaction journey', () => {
  const db = createDatabase();
  insertBase(db);
  attemptPublish(db);
  const pilot = insertPilot(db);
  const expiredAt = 1_700_000_000;
  const retainedAt = 1_900_000_000;

  for (const [id, createdAt] of [
    ['expired-query', expiredAt],
    ['retained-query', retainedAt],
  ]) {
    db.prepare(`
      INSERT INTO query_events
        (id, principal_kind, pilot_session_id, qualified,
         qualification_rule_version, retrieval_status, query_length_bucket,
         has_topic_filter, scope_filter_count, result_count, retrieval_version,
         created_at)
      VALUES (?, 'research_participant', ?, 1, 'stage1-explicit-submit-v2',
              'completed', 'medium', 0, 0, 1, 'ranker-v1', ?)
    `).run(id, pilot.session, createdAt);
    db.prepare(`
      INSERT INTO query_result_impressions
        (query_event_id, card_id, card_revision_id, rank, recorded_at)
      VALUES (?, 'card', 'revision', 1, ?)
    `).run(id, createdAt);
    db.prepare(`
      INSERT INTO answer_open_events
        (query_event_id, card_revision_id, opened_at)
      VALUES (?, 'revision', ?)
    `).run(id, createdAt);
    db.prepare(`
      INSERT INTO answer_share_events
        (query_event_id, card_revision_id, shared_at)
      VALUES (?, 'revision', ?)
    `).run(id, createdAt);
    db.prepare(`
      INSERT INTO feedback_events
        (id, card_revision_id, query_event_id, outcome, created_at)
      VALUES (?, 'revision', ?, 'resolved', ?)
    `).run(`feedback-${id}`, id, createdAt);
  }

  for (const sql of RESEARCH_EVENT_RETENTION_SQL) {
    db.prepare(sql).run(expiredAt);
  }

  for (const table of [
    'query_events',
    'query_result_impressions',
    'answer_open_events',
    'answer_share_events',
    'feedback_events',
  ]) {
    assert.equal(
      db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
      1,
      `${table} should retain only the in-window journey`,
    );
  }
  assert.equal(
    db
      .prepare(
        "SELECT query_event_id FROM feedback_events WHERE id = 'feedback-retained-query'",
      )
      .get().query_event_id,
    'retained-query',
  );
  db.close();
});

test('answer revisions and citations are immutable after insertion', () => {
  const db = createDatabase();
  insertBase(db);
  assert.throws(
    () =>
      db.exec(
        "UPDATE answer_card_revisions SET title = '改写' WHERE id = 'revision'",
      ),
    /answer_card_revisions_are_immutable/u,
  );
  assert.throws(
    () =>
      db.exec(
        "DELETE FROM answer_card_sentence_citations WHERE card_revision_id = 'revision'",
      ),
    /answer_card_sentence_citations_are_immutable/u,
  );
  db.close();
});
