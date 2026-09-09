import assert from 'node:assert/strict';
import { createHash, createCipheriv } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  RuntimeStore, authModule, contentModule, lifecycleModule, participantsModule,
  reportsModule, projectPublic, readPublicRevision,
  decryptPrivatePayload, legacyIntakeKey,
  lifecyclePublicResults,
} from '@information-community/runtime';
import { readLegacySnapshot, writeLegacyMigration } from '../scripts/legacy-migration.mjs';

const now = '2026-09-09T10:00:00.000Z';
const expiry = 4070908800;
const profile = {
  id: 'legacy-guide-test',
  entityTypes: [{ id: 'answer', role: 'content' }, { id: 'artifact', role: 'source' }],
  evidence: { factualSentenceKinds: ['fact'], allowedModes: ['link-only', 'excerpt'], excerptRights: ['permission'], requireCitationsOnWrite: true },
  publication: { blockedValues: { impact: ['high'], origin: ['ai_draft'] } },
  scope: { dimensions: ['campus'], universal: 'universal', unknown: 'unknown' },
  search: { aliases: {} }, warnings: { reviewOverdue: 'Review overdue' },
};
const options = { profile, communityId: 'legacy-guide-test', now };
const lifecycleConfig = JSON.parse(readFileSync(new URL('../community/lifecycle.json', import.meta.url), 'utf8'));
const participantsConfig = JSON.parse(readFileSync(new URL('../community/business.json', import.meta.url), 'utf8')).participants;
const targetKeyring = { activeVersion: 'migration-v1', keys: { 'migration-v1': '22'.repeat(32) } };
const legacySecret = 'synthetic-legacy-secret-not-used-outside-this-test';
const legacyKeyring = { keys: { 1: legacyIntakeKey(legacySecret) } };
const privateOptions = { ...options, includePrivate: true, lifecycleConfig, participantsConfig,
  targetKeyring, legacyKeyring, reencryptLegacy: true, withdrawnSubjectIds: [], revokedSubjectIds: [] };
const migrations = new URL('./fixtures/legacy-schema/', import.meta.url);

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'guide-legacy-migration-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = join(directory, 'legacy.sqlite');
  const db = new DatabaseSync(source);
  db.exec('PRAGMA foreign_keys = ON');
  for (const name of readdirSync(migrations).filter(name => /^\d{4}.*\.sql$/.test(name)).sort()) {
    for (const statement of readFileSync(new URL(name, migrations), 'utf8').split('--> statement-breakpoint').map(value => value.trim()).filter(Boolean)) db.exec(statement);
  }
  return { directory, source, db };
}

function seed(db, { relative = false, sourceVisibility = 'public', draft = false } = {}) {
  db.exec(`
    INSERT INTO topics (id, slug, title_zh, title_en, description, status, created_at)
      VALUES ('topic', 'systems', 'Systems', 'Systems', 'Official entry points', 'active', 1788000000);
    INSERT INTO topic_aliases (topic_id, language, normalized_alias) VALUES ('topic', 'en', 'accounts');
    INSERT INTO applicability_scopes (id, dimension, code, label_zh, label_en, sort_order)
      VALUES ('scope-campus', 'campus', 'suzhou', 'Suzhou', 'Suzhou', 10);
    INSERT INTO publishers (id, type, name_zh, name_en, canonical_url, verification_status, created_at)
      VALUES ('publisher', 'platform', 'Guide', 'Guide', 'https://example.org', 'platform_owned', 1788000000);
    INSERT INTO artifacts (id, publisher_id, type, canonical_url, moderation_status, created_at)
      VALUES ('artifact-link', 'publisher', 'webpage', 'https://example.org/source', 'approved', 1788000000);
    INSERT INTO artifact_revisions
      (id, artifact_id, published_at, captured_at, recorded_at, visibility, rights_mode, rights_expires_at, content_hash, archived_text)
      VALUES ('source-v1', 'artifact-link', NULL, 1788000000, 1788000000, '${sourceVisibility}', 'link_only', ${expiry}, NULL, NULL);
    INSERT INTO link_citations (id, artifact_revision_id, url, title, published_at, accessed_at, created_at)
      VALUES ('link-id', 'source-v1', 'https://example.org/source', 'Official source', NULL, 1788000000, 1788000000);
    INSERT INTO artifacts (id, publisher_id, type, canonical_url, moderation_status, created_at)
      VALUES ('artifact-excerpt', 'publisher', 'platform_policy', '${relative ? '/about#method' : 'https://example.org/about#method'}', 'approved', 1788000000);
    INSERT INTO artifact_revisions
      (id, artifact_id, published_at, captured_at, recorded_at, visibility, rights_mode, rights_expires_at, content_hash, archived_text)
      VALUES ('source-archive-v1', 'artifact-excerpt', 1788000000, 1788000000, 1788000000, 'public', 'snapshot_allowed', NULL, 'original-content-hash', 'Exact retained policy statement.');
    INSERT INTO evidence_spans
      (id, artifact_revision_id, locator_kind, locator_value, quote, span_hash, visibility, created_at)
      VALUES ('span-id', 'source-archive-v1', 'section', 'method', 'retained policy', 'original-span-hash', 'public', 1788000000);
    INSERT INTO answer_cards
      (id, slug, topic_id, publication_status, risk_level, current_public_revision_id, lock_version, last_publish_operation_id, created_at)
      VALUES ('card', 'where-to-find', 'topic', 'unpublished', 'low', NULL, 0, NULL, 1788000000);
  `);
  revision(db, 'answer-v1', 1, null, 0);
  if (!draft) {
    publish(db, 'answer-v1', 0);
    revision(db, 'answer-v2', 2, 'answer-v1', 1);
    publish(db, 'answer-v2', 1);
  }
}

function revision(db, id, version, parent, expected) {
  db.prepare(`INSERT INTO answer_card_revisions
    (id, card_id, parent_revision_id, version_number, expected_card_version, locale,
     title, summary, search_text, scope_mode, as_of, verified_at, review_due_at,
     review_owner_id, review_owner_label, generation_type, evidence_coverage,
     dispute_status, evidence_note, editor_id, created_at)
    VALUES (?, 'card', ?, ?, ?, 'zh-CN', ?, 'Check the original source.', 'official entry',
      'constrained', '2026-08-29', 1788000000, 4102444800, 'original-editor', 'Original editor',
      'human', 'partial_archived', 'none', 'Two source formats', 'original-editor', 1788000000)`)
    .run(id, parent, version, expected, `Answer ${version}`);
  db.prepare('INSERT INTO answer_card_revision_scopes (card_revision_id, scope_id) VALUES (?, ?)').run(id, 'scope-campus');
  db.prepare('INSERT INTO answer_card_revision_sentences (card_revision_id, sentence_key, ordinal, text, is_factual) VALUES (?, ?, ?, ?, ?)')
    .run(id, 's-first', 1, 'Consult the official source.', 1);
  db.prepare('INSERT INTO answer_card_revision_sentences (card_revision_id, sentence_key, ordinal, text, is_factual) VALUES (?, ?, ?, ?, ?)')
    .run(id, 's-second', 2, 'Consider your circumstances.', 0);
  db.prepare('INSERT INTO answer_card_sentence_citations (card_revision_id, sentence_key, ordinal, evidence_span_id, link_citation_id) VALUES (?, ?, ?, ?, ?)')
    .run(id, 's-first', 3, 'span-id', null);
  db.prepare('INSERT INTO answer_card_sentence_citations (card_revision_id, sentence_key, ordinal, evidence_span_id, link_citation_id) VALUES (?, ?, ?, ?, ?)')
    .run(id, 's-first', 1, null, 'link-id');
}

function publish(db, revisionId, expected) {
  db.prepare(`INSERT INTO publish_operations
    (id, card_id, revision_id, expected_card_version, reviewer_id, reason, request_id, created_at, applied_at)
    VALUES (?, 'card', ?, ?, 'original-reviewer', 'Reviewed source and policy', ?, 1788000000, NULL)`)
    .run(`publish-${revisionId}`, revisionId, expected, `request-${revisionId}`);
  db.prepare(`UPDATE answer_cards SET publication_status = 'published', current_public_revision_id = ?,
    lock_version = lock_version + 1, last_publish_operation_id = ? WHERE id = 'card'`)
    .run(revisionId, `publish-${revisionId}`);
}

function seedPrivate(db, { expired = false } = {}) {
  db.exec(`
    INSERT INTO pilot_participants
      (id, participant_ref_hmac, participant_hint, recruitment_channel, is_test, adult_verified_at, adult_verified_by, status, created_at)
      VALUES ('pilot-1', 'PRIVATE_REF_MARKER', 'TEST', 'campus', 1, 1788000000, 'operator', 'active', 1788000000);
    INSERT INTO pilot_invitations
      (id, participant_id, token_hash, issued_by, issued_at, expires_at, redeemed_at, revoked_at, revoked_by, lock_version)
      VALUES ('invite-1', 'pilot-1', 'OLD_INVITE_TOKEN_HASH', 'operator', 1788000000, 4070908800, 1788000001, NULL, NULL, 1);
    INSERT INTO pilot_consent_records
      (id, participant_id, invitation_id, notice_version, purpose, separate_consent, granted_at, withdrawn_at)
      VALUES ('consent-1', 'pilot-1', 'invite-1', 'legacy-notice-v1', 'stage1_product_research', 1, 1788000001, NULL);
    INSERT INTO pilot_sessions
      (id, participant_id, consent_id, invitation_id, token_hash, issued_at, expires_at, revoked_at)
      VALUES ('session-1', 'pilot-1', 'consent-1', 'invite-1', 'OLD_SESSION_TOKEN_HASH', 1788000001, 4070908800, NULL);
    INSERT INTO query_events
      (id, principal_kind, pilot_session_id, qualified, qualification_rule_version, retrieval_status,
       query_length_bucket, has_topic_filter, scope_filter_count, result_count, retrieval_version, created_at)
      VALUES ('query-1', 'research_participant', 'session-1', 0, 'old-rule', 'completed', 'short', 0, 0, 1, 'old-search', 1788000010);
    INSERT INTO query_result_impressions (query_event_id, card_id, card_revision_id, rank, recorded_at)
      VALUES ('query-1', 'card', 'answer-v2', 1, 1788000010);
    INSERT INTO answer_open_events (query_event_id, card_revision_id, opened_at) VALUES ('query-1', 'answer-v2', 1788000011);
    INSERT INTO answer_share_events (query_event_id, card_revision_id, shared_at) VALUES ('query-1', 'answer-v2', 1788000012);
    INSERT INTO feedback_events (id, card_revision_id, query_event_id, outcome, created_at)
      VALUES ('feedback-1', 'answer-v2', 'query-1', 'resolved', 1788000013);
    INSERT INTO reports (id, public_code, target_card_id, pilot_participant_id, affected_area, type, status, lock_version, created_at, updated_at)
      VALUES ('report-1', 'OLD_PUBLIC_CODE', 'card', NULL, NULL, 'privacy', 'received', 0, 1788000010, 1788000010);
    INSERT INTO case_notes (id, target_type, target_id, author_editor_id, body, created_at)
      VALUES ('note-report', 'report', 'report-1', 'reviewer', 'PRIVATE_REPORT_NOTE', 1788000011);
    INSERT INTO editor_accounts
      (id, email, display_name, password_salt, password_hash, password_iterations, status, session_version,
       must_change_password, failed_login_count, created_at, updated_at)
      VALUES ('legacy-editor', 'synthetic@example.org', 'Legacy Editor', 'OLD_PASSWORD_SALT', 'OLD_PASSWORD_HASH', 600000, 'active', 1, 0, 0, 1788000000, 1788000000);
    INSERT INTO editor_role_grants (account_id, role, granted_by, granted_at)
      VALUES ('legacy-editor', 'content_editor', 'operator', 1788000000);
    INSERT INTO editor_totp_factors (id, account_id, label, encrypted_secret, key_version, verified_at, created_at)
      VALUES ('legacy-factor', 'legacy-editor', 'Legacy factor', 'OLD_TOTP_SECRET', 1, 1788000000, 1788000000);
    INSERT INTO editor_recovery_codes (account_id, code_hash, created_at)
      VALUES ('legacy-editor', 'OLD_RECOVERY_HASH', 1788000000);
    INSERT INTO editor_sessions (id, account_id, token_hash, session_version, issued_at, last_seen_at, idle_expires_at, absolute_expires_at)
      VALUES ('legacy-editor-session', 'legacy-editor', 'OLD_EDITOR_SESSION', 1, 1788000000, 1788000000, 4070908700, 4070908800);
  `);
  const id = 'intake-1', iv = Buffer.alloc(12, 7);
  const cipher = createCipheriv('aes-256-gcm', legacyIntakeKey(legacySecret), iv);
  cipher.setAAD(Buffer.from(`research-intake:v1:${id}`));
  const plaintext = JSON.stringify({ contextScope: 'campus', body: 'PRIVATE_BODY_MARKER', sourceUrl: null, provenanceRole: null });
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  const ciphertext = `v1.${iv.toString('base64url')}.${encrypted.toString('base64url')}`;
  db.prepare(`INSERT INTO research_intakes
    (id, participant_ref_hash, pilot_participant_id, origin_query_event_id, kind, context_scope,
     body, source_url, provenance_role, payload_ciphertext, payload_key_version, status, lock_version, submitted_at, expires_at, purged_at)
    VALUES (?, 'managed', 'pilot-1', 'query-1', 'question', 'Restricted payload', NULL, NULL, NULL, ?, 1, 'submitted', 0, 1788000010, ?, NULL)`)
    .run(id, ciphertext, expired ? Math.floor(Date.parse(now) / 1000) - 10 : 1790000010);
  db.exec(`INSERT INTO case_notes (id, target_type, target_id, author_editor_id, body, created_at)
    VALUES ('note-intake', 'research_intake', 'intake-1', 'reviewer', 'PRIVATE_INTAKE_NOTE', 1788000011);
    INSERT INTO audit_events (id, actor_id, action, target_type, target_id, reason, request_id, metadata_json, created_at)
      VALUES ('audit-private-intake', 'reviewer', 'research_intake.review', 'research_intake', 'intake-1',
        'PRIVATE_AUDIT_DETAILS', 'request-private-intake', '{"note":"PRIVATE_AUDIT_DETAILS"}', 1788000011);
    INSERT INTO audit_events (id, actor_id, action, target_type, target_id, reason, request_id, metadata_json, created_at)
      VALUES ('audit-private-invite', 'operator', 'pilot.invitation.issue', 'pilot_invitation', 'invite-1',
        'PRIVATE_SUBJECT_AUDIT', 'request-private-invite', NULL, 1788000011)`);
  return ciphertext;
}

function restore(backup) {
  const modules = [{ ...contentModule, initialState: () => contentModule.initialState({ profile }) }, authModule, lifecycleModule, participantsModule, reportsModule];
  const store = new RuntimeStore(':memory:', { communityId: options.communityId, modules });
  store.restore(backup, { now: Date.parse(now), withdrawnSubjectIds: [], revokedSubjectIds: [] });
  return store;
}

test('real legacy SQL schema maps immutable public history, exact evidence and business catalog without source writes', t => {
  const { source, db } = fixture(t);
  seed(db);
  db.close();
  const original = readFileSync(source);
  const result = readLegacySnapshot(source, options);
  assert.deepEqual(readFileSync(source), original);
  assert.equal(result.report.sourceSha256, createHash('sha256').update(original).digest('hex'));
  const entity = result.backup.state.modules.content.entities.find(row => row.id === 'card');
  assert.equal(entity.version, 2);
  assert.equal(entity.publicRevisionId, 'answer-v2');
  assert.deepEqual(entity.publishedRevisionIds, ['answer-v1', 'answer-v2']);
  assert.equal(entity.extensions.slug, 'where-to-find');
  const old = result.backup.state.modules.content.revisions.find(row => row.id === 'answer-v2');
  assert.equal(old.parentRevisionId, 'answer-v1');
  assert.deepEqual(old.data.sentences.map(row => row.id), ['s-first', 's-second']);
  assert.deepEqual(old.data.scope, { campus: ['suzhou'] });
  assert.deepEqual(old.data.scopeIds, ['scope-campus']);
  assert.deepEqual(result.catalog.topics[0].aliases, ['accounts']);
  assert.equal(result.catalog.publishers[0].nameZh, 'Guide');
  assert.equal(result.report.legacyTables.evidence_spans[0].locator_value, 'method');
  assert.ok(result.backup.state.audit.some(row => row.actorId === 'original-reviewer'));
  assert.deepEqual(result.backup.state.modules.auth.sessions, []);
  const store = restore(result.backup);
  try {
    const content = store.read().modules.content;
    const current = readPublicRevision(content, 'answer-v2', { now });
    assert.equal(current.revisionNumber, 2);
    assert.deepEqual(current.citations.map(row => row.order), [0, 2]);
    assert.equal(current.citations[1].excerpt, 'retained policy');
    assert.equal(readPublicRevision(content, 'answer-v1', { now }).revisionNumber, 1);
    assert.equal(projectPublic(content, { now }).nodes.length, 1);
    assert.equal(projectPublic(content, { now: '2099-01-01T00:00:00.000Z' }).nodes.length, 0);
    assert.equal(readPublicRevision(content, 'answer-v1', { now: '2099-01-01T00:00:00.000Z' }), null);
  } finally { store.close(); }
  const consumerProfile = JSON.parse(readFileSync(new URL('../community/content-profile.json', import.meta.url), 'utf8'));
  assert.doesNotThrow(() => readLegacySnapshot(source, { ...options, profile: consumerProfile }));
});

test('restricted sources and unpublished revisions remain unavailable after migration', t => {
  const { source, db } = fixture(t);
  seed(db, { draft: true });
  db.exec(`INSERT INTO artifact_revisions
    (id, artifact_id, published_at, captured_at, recorded_at, visibility, rights_mode, rights_expires_at, content_hash, archived_text)
    VALUES ('restricted-source', 'artifact-link', NULL, 1788000000, 1788000000, 'restricted', 'link_only', NULL, NULL, NULL)`);
  db.exec(`INSERT INTO artifact_revisions
    (id, artifact_id, published_at, captured_at, recorded_at, visibility, rights_mode, rights_expires_at, content_hash, archived_text)
    VALUES ('quote-only-source', 'artifact-excerpt', NULL, 1788000000, 1788000000, 'public', 'quote_allowed', NULL, NULL, NULL);
    INSERT INTO evidence_spans
      (id, artifact_revision_id, locator_kind, locator_value, quote, span_hash, visibility, created_at)
      VALUES ('restricted-span', 'quote-only-source', 'section', 'private', 'Restricted retained quotation.', 'original-quote-hash', 'restricted', 1788000000)`);
  db.close();
  const { backup, report } = readLegacySnapshot(source, options);
  const mapped = report.sourceMappings.filter(row => row.artifactRevisionId === 'restricted-source');
  assert.equal(mapped.length, 1);
  for (const mapping of mapped) assert.equal(backup.state.modules.content.entities.find(row => row.id === mapping.entityId).hidden, true);
  const quoteMapping = report.sourceMappings.find(row => row.legacyId === 'restricted-span');
  assert.equal(quoteMapping.revisionId, 'quote-only-source');
  assert.equal(backup.state.modules.content.entities.find(row => row.id === quoteMapping.entityId).hidden, true);
  assert.equal(backup.state.modules.content.revisions.find(row => row.id === 'quote-only-source').data.text, 'Restricted retained quotation.');
  assert.equal(projectPublic(backup.state.modules.content, { now }).nodes.length, 0);
});

test('withdrawn sources suppress both current content and old published revisions', t => {
  const { source, db } = fixture(t);
  seed(db);
  db.exec("UPDATE artifacts SET moderation_status = 'withdrawn' WHERE id = 'artifact-link'");
  db.close();
  const { backup, report } = readLegacySnapshot(source, options);
  const content = backup.state.modules.content;
  for (const mapping of report.sourceMappings.filter(row => row.artifactId === 'artifact-link')) {
    assert.equal(content.entities.find(row => row.id === mapping.entityId).disposition, 'withdrawn');
  }
  assert.equal(projectPublic(content, { now }).nodes.length, 0);
  assert.equal(readPublicRevision(content, 'answer-v1', { now }), null);
});

test('hidden cards keep their publication history without becoming public', t => {
  const { source, db } = fixture(t);
  seed(db);
  db.exec(`INSERT INTO workflow_operations
    (id, target_type, target_id, expected_version, target_status, actor_id, reason, request_id, created_at, applied_at)
    VALUES ('hide-card', 'answer_card', 'card', 2, 'hidden', 'reviewer', 'Review needed', 'request-hide', 1788000000, NULL);
    UPDATE answer_cards SET publication_status = 'hidden', lock_version = 3,
      last_workflow_operation_id = 'hide-card' WHERE id = 'card'`);
  db.close();
  const { backup } = readLegacySnapshot(source, options);
  const card = backup.state.modules.content.entities.find(row => row.id === 'card');
  assert.equal(card.hidden, true);
  assert.equal(card.version, 3);
  assert.deepEqual(card.publishedRevisionIds, ['answer-v1', 'answer-v2']);
  assert.equal(projectPublic(backup.state.modules.content, { now }).nodes.length, 0);
});

test('private or unknown nonempty tables fail closed and never produce an output', t => {
  const { source, directory, db } = fixture(t);
  seed(db);
  db.exec(`INSERT INTO pilot_participants
    (id, participant_ref_hmac, participant_hint, recruitment_channel, is_test, adult_verified_at, adult_verified_by, status, created_at)
    VALUES ('synthetic-participant', 'synthetic-ref', 'TEST', 'campus', 1, 1788000000, 'operator', 'active', 1788000000)`);
  db.exec('CREATE TABLE unknown_business_data (id TEXT)');
  db.exec("INSERT INTO unknown_business_data VALUES ('synthetic')");
  db.close();
  const output = join(directory, 'private-output.json');
  assert.throws(() => writeLegacyMigration(source, output, options), error => {
    assert.equal(error.code, 'UNSUPPORTED_LEGACY_DATA');
    assert.deepEqual(error.details.tables.map(row => row.table), ['pilot_participants', 'unknown_business_data']);
    return true;
  });
  assert.ok(!readdirSync(directory).includes('private-output.json'));
});

test('relative policy URLs require an explicit public origin, and existing output is never overwritten', t => {
  const { source, directory, db } = fixture(t);
  seed(db, { relative: true });
  db.close();
  assert.throws(() => readLegacySnapshot(source, options), { code: 'PUBLIC_ORIGIN_REQUIRED' });
  const output = join(directory, 'private-output.json');
  const result = writeLegacyMigration(source, output, { ...options, publicOrigin: 'https://guide.example.org' });
  const sourceRevision = result.backup.state.modules.content.revisions.find(row => row.id === 'source-archive-v1');
  assert.equal(sourceRevision.data.url, 'https://guide.example.org/about#method');
  const bytes = readFileSync(output);
  assert.throws(() => writeLegacyMigration(source, output, options), { code: 'OUTPUT_EXISTS' });
  assert.deepEqual(readFileSync(output), bytes);
});

test('migration refuses journal sidecars instead of reading a potentially live database', t => {
  const { source, db } = fixture(t);
  seed(db);
  db.close();
  writeFileSync(source + '-wal', 'synthetic marker');
  assert.throws(() => readLegacySnapshot(source, options), { code: 'LIVE_DATABASE' });
});

test('CLI requires explicit paths and does not touch any implicit database', () => {
  const run = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/legacy-migration.mjs', import.meta.url))], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.equal(JSON.parse(run.stderr.split('\n').find(line => line.startsWith('{'))).code, 'USAGE');
});

test('private opt-in authenticates legacy AAD, preserves IDs and notes, and invalidates credentials without granting current consent', t => {
  const { source, db } = fixture(t);
  seed(db);
  seedPrivate(db);
  db.close();
  const original = readFileSync(source);
  const result = readLegacySnapshot(source, privateOptions);
  assert.deepEqual(readFileSync(source), original);
  assert.equal(result.report.scope, 'content-and-private');
  const modules = result.backup.state.modules;
  const record = modules.lifecycle.records['intake-1'];
  assert.equal(record.id, 'intake-1');
  assert.equal(record.subjectId, 'participant:pilot-1');
  assert.equal(record.expiresAt, 1790000010000);
  assert.equal(record.payload.aad, 'information-community:lifecycle:v1:intake-1');
  const payload = decryptPrivatePayload(record.id, record.payload, targetKeyring);
  assert.equal(payload.data.body, 'PRIVATE_BODY_MARKER');
  assert.equal(payload.legacy.originalEnvelope.aad, 'research-intake:v1:intake-1');
  assert.equal(decryptPrivatePayload(record.id, payload.legacy.originalEnvelope, legacyKeyring).body, 'PRIVATE_BODY_MARKER');
  assert.equal(payload.internalNotes[0].text, 'PRIVATE_INTAKE_NOTE');
  const query = decryptPrivatePayload('query-1', modules.lifecycle.records['query-1'].payload, targetKeyring);
  assert.equal(query.data.query_result_impressions[0].card_revision_id, 'answer-v2');
  assert.equal(query.data.answer_open_events.length, 1);
  assert.equal(query.data.answer_share_events.length, 1);
  assert.equal(query.data.feedback_events[0].id, 'feedback-1');
  assert.equal(modules.lifecycle.subjects['participant:pilot-1'].consents.stage1_product_research.version, 'legacy-notice-v1');
  assert.equal(modules.lifecycle.subjects['participant:pilot-1'].consents.stage1_research, undefined);
  assert.deepEqual(modules.lifecycle.subjects['participant:pilot-1'].eligibility, {});
  assert.deepEqual(modules.participants.subjects[0].eligibility, {});
  for (const credentials of [modules.auth.accounts, modules.auth.sessions, modules.participants.sessions, modules.participants.invitations]) assert.deepEqual(credentials, []);
  assert.deepEqual(modules.reports.receipts, {});
  assert.deepEqual(result.report.private.requiresEditorBootstrap, ['legacy-editor']);
  const identities = decryptPrivatePayload('legacy-editor-identities', result.report.private.identityArchive, targetKeyring);
  assert.equal(identities.identities[0].email, 'synthetic@example.org');
  assert.equal(identities.identities[0].roles[0].role, 'content_editor');
  const serialized = JSON.stringify(result);
  for (const marker of ['PRIVATE_BODY_MARKER', 'PRIVATE_INTAKE_NOTE', 'PRIVATE_REPORT_NOTE', 'PRIVATE_REF_MARKER', 'OLD_PASSWORD_HASH', 'OLD_PASSWORD_SALT', 'OLD_SESSION_TOKEN_HASH', 'OLD_INVITE_TOKEN_HASH', 'OLD_PUBLIC_CODE', 'OLD_TOTP_SECRET', 'OLD_RECOVERY_HASH', 'OLD_EDITOR_SESSION', 'PRIVATE_AUDIT_DETAILS', 'PRIVATE_SUBJECT_AUDIT']) {
    assert.equal(serialized.includes(marker), false, marker);
  }
});

test('private migration requires explicit keys, reencryption and independent revocation registers', t => {
  const { source, db } = fixture(t);
  seed(db); seedPrivate(db); db.close();
  assert.throws(() => readLegacySnapshot(source, { ...options, includePrivate: true }), { code: 'PRIVATE_CONFIG_REQUIRED' });
  assert.throws(() => readLegacySnapshot(source, { ...privateOptions, withdrawnSubjectIds: undefined }), { code: 'REVOCATION_REGISTERS_REQUIRED' });
  assert.throws(() => readLegacySnapshot(source, { ...privateOptions, reencryptLegacy: false }), { code: 'REENCRYPTION_CONFIRMATION_REQUIRED' });
  assert.throws(() => readLegacySnapshot(source, { ...privateOptions, legacyKeyring: undefined }), { code: 'LEGACY_KEYRING_REQUIRED' });
  assert.throws(() => readLegacySnapshot(source, { ...privateOptions, legacyKeyring: { keys: { 1: '33'.repeat(32) } } }), { code: 'DECRYPTION_FAILED' });
});

test('expired and independently withdrawn payloads become tombstones without reading legacy keys or retaining report copies', t => {
  const { source, db } = fixture(t);
  seed(db); const oldCiphertext = seedPrivate(db, { expired: true }); db.close();
  const expired = readLegacySnapshot(source, { ...privateOptions, legacyKeyring: undefined, reencryptLegacy: false });
  assert.equal(expired.backup.state.modules.lifecycle.records['intake-1'].payload, null);
  assert.ok(!expired.backup.state.audit.some(entry => entry.id === 'audit-private-intake'));
  assert.equal(expired.report.legacyTables.research_intakes, undefined);
  assert.equal(JSON.stringify(expired).includes(oldCiphertext), false);
  const withdrawn = readLegacySnapshot(source, { ...privateOptions, legacyKeyring: undefined, reencryptLegacy: false, withdrawnSubjectIds: ['pilot-1'] });
  for (const id of ['intake-1', 'query-1']) {
    assert.equal(withdrawn.backup.state.modules.lifecycle.records[id].payload, null);
    assert.equal(withdrawn.backup.state.modules.lifecycle.records[id].subjectId, null);
  }
  assert.ok(withdrawn.backup.state.modules.participants.subjects.find(row => row.id === 'participant:pilot-1').revokedAt !== null);
  assert.equal(JSON.stringify(withdrawn).includes('PRIVATE_INTAKE_NOTE'), false);
  assert.equal(withdrawn.report.private.requiresCurrentConsent.includes('participant:pilot-1'), false);
  assert.ok(!withdrawn.backup.state.audit.some(entry => entry.id === 'audit-private-invite'));
});

test('unknown retained research ownership fails closed until a reviewed subject mapping is supplied', t => {
  const { source, db } = fixture(t);
  seed(db); seedPrivate(db);
  db.exec("UPDATE research_intakes SET pilot_participant_id = NULL WHERE id = 'intake-1'");
  db.close();
  assert.throws(() => readLegacySnapshot(source, privateOptions), { code: 'UNRESOLVED_LEGACY_SUBJECT' });
  const result = readLegacySnapshot(source, { ...privateOptions, subjectMappings: { 'research_intakes:intake-1': 'pilot-1' } });
  assert.equal(result.backup.state.modules.lifecycle.records['intake-1'].subjectId, 'participant:pilot-1');
});

test('private CLI reads explicit environment key names and config files without printing or persisting secrets', t => {
  const { source, directory, db } = fixture(t);
  seed(db); seedPrivate(db); db.close();
  const profilePath = join(directory, 'profile.json'), registers = join(directory, 'registers.json');
  const output = join(directory, 'private-artifact.json');
  writeFileSync(profilePath, JSON.stringify(profile));
  writeFileSync(registers, '[]');
  const run = spawnSync(process.execPath, [
    fileURLToPath(new URL('../scripts/legacy-migration.mjs', import.meta.url)),
    '--source', source, '--output', output, '--profile', profilePath, '--community-id', options.communityId,
    '--include-private', '--reencrypt-legacy',
    '--lifecycle-file', fileURLToPath(new URL('../community/lifecycle.json', import.meta.url)),
    '--participants-file', fileURLToPath(new URL('../community/business.json', import.meta.url)),
    '--target-keyring-env', 'GUIDE_TEST_TARGET_KEYRING', '--legacy-secret-env', 'GUIDE_TEST_LEGACY_SECRET',
    '--withdrawn-register', registers, '--revoked-register', registers,
  ], { encoding: 'utf8', env: { ...process.env, GUIDE_TEST_TARGET_KEYRING: JSON.stringify(targetKeyring), GUIDE_TEST_LEGACY_SECRET: legacySecret } });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).scope, 'content-and-private');
  const artifact = JSON.parse(readFileSync(output, 'utf8'));
  assert.equal(artifact.report.private.reencrypted.length, 1);
  assert.ok(!JSON.stringify(artifact).includes(legacySecret));
  assert.ok(!run.stdout.includes(legacySecret));
  assert.ok(!run.stderr.includes(legacySecret));
  assert.ok(!JSON.stringify(artifact).includes(targetKeyring.keys['migration-v1']));
});

test('old report outcomes and verified links stay encrypted until explicit publication review', t => {
  const { source, db } = fixture(t);
  seed(db); seedPrivate(db);
  db.exec(`
    INSERT INTO workflow_operations
      (id, target_type, target_id, expected_version, target_status, actor_id, reason, request_id, created_at, applied_at)
      VALUES ('report-review', 'report', 'report-1', 0, 'reviewing', 'reviewer', 'Begin review', 'request-report-review', 1788000020, NULL);
    UPDATE reports SET status = 'reviewing', lock_version = 1, reviewing_at = 1788000020,
      updated_at = 1788000020, last_workflow_operation_id = 'report-review' WHERE id = 'report-1';
    INSERT INTO workflow_operations
      (id, target_type, target_id, expected_version, target_status, actor_id, reason, request_id, created_at, applied_at)
      VALUES ('report-resolve', 'report', 'report-1', 1, 'resolved', 'reviewer', 'Complete review', 'request-report-resolve', 1788000030, NULL);
    UPDATE reports SET status = 'resolved', lock_version = 2, resolved_at = 1788000030,
      updated_at = 1788000030, decision_code = 'corrected', public_response = 'PRIVATE_LEGACY_RESPONSE',
      resolution_card_id = 'card', resolution_revision_id = 'answer-v2', last_workflow_operation_id = 'report-resolve'
      WHERE id = 'report-1';
  `);
  db.close();
  const result = readLegacySnapshot(source, privateOptions);
  const record = result.backup.state.modules.lifecycle.records['report-1'];
  assert.equal(record.status, 'resolved');
  assert.equal(record.decisionCode, 'corrected');
  assert.equal(record.version, 2);
  assert.equal(record.entityId, null);
  assert.equal(record.revisionId, null);
  const payload = decryptPrivatePayload('report-1', record.payload, targetKeyring);
  assert.deepEqual(payload.legacy.references, { entityId: 'card', revisionId: 'answer-v2' });
  assert.equal(payload.data.legacyPublicResponse, 'PRIVATE_LEGACY_RESPONSE');
  assert.equal(payload.legacy.workflowHistory.length, 2);
  assert.equal(JSON.stringify(result).includes('PRIVATE_LEGACY_RESPONSE'), false);
  assert.deepEqual(lifecyclePublicResults(result.backup.state, { config: lifecycleConfig, now: Date.parse(now) }), []);
});
