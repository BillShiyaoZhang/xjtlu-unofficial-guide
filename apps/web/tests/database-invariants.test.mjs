import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const migrationFiles = [
  new URL('../drizzle/0000_flat_brood.sql', import.meta.url),
  new URL('../drizzle/0001_stage1-invariants.sql', import.meta.url),
  new URL('../drizzle/0002_breezy_cammi.sql', import.meta.url),
];

function createDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const file of migrationFiles) {
    const sql = readFileSync(file, 'utf8');
    for (const statement of sql
      .split('--> statement-breakpoint')
      .map((item) => item.trim())
      .filter(Boolean)) {
      db.exec(statement);
    }
  }
  return db;
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
      (id, public_code, target_card_id, type, status, public_response, created_at, resolved_at)
    VALUES ('report', 'XG-0123456789ABCDEF0123456789ABCDEF', NULL, 'privacy',
            'received', NULL, 1800000000, NULL);
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

test('expired research intake purge removes linkable payload fields', () => {
  const db = createDatabase();
  db.exec(`
    INSERT INTO research_intakes
      (id, participant_ref_hash, kind, context_scope, body, source_url,
       provenance_role, status, submitted_at, expires_at, purged_at)
    VALUES ('intake', 'participant-hash', 'material', '苏州校区', '私有正文',
            'https://example.com/material', 'lead_only', 'submitted', 1, 2, NULL);
    UPDATE research_intakes
    SET participant_ref_hash = 'purged', context_scope = '已按保留期限清理',
        body = NULL, source_url = NULL, provenance_role = NULL,
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
