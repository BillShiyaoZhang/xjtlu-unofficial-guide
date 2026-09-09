import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import {
  RuntimeStore, authModule, contentModule, lifecycleModule, participantsModule,
  reportsModule, validateContent, validateContentProfile, validateParticipantConfig,
  encryptPrivatePayload, decryptPrivatePayload, importLegacyIntakeEnvelope,
  legacyIntakeKey, lifecycleCommand,
} from '@information-community/runtime';

const contentTables = [
  'topics', 'topic_aliases', 'applicability_scopes', 'publishers', 'artifacts',
  'artifact_revisions', 'evidence_spans', 'link_citations', 'answer_cards',
  'answer_card_revisions', 'answer_card_revision_scopes',
  'answer_card_revision_sentences', 'answer_card_sentence_citations',
  'publish_operations', 'audit_events',
];
const archiveTables = [
  'workflow_operations', 'artifact_disposition_events', 'maintenance_runs',
  'backup_runs', 'recovery_drills', '__app_migrations', '__app_seed_markers',
];
const supportedTables = new Set([...contentTables, ...archiveTables]);
const privateTables = new Set([
  'research_intakes', 'reports', 'case_notes', 'pilot_participants', 'pilot_invitations',
  'pilot_consent_records', 'pilot_sessions', 'query_events', 'query_result_impressions',
  'answer_open_events', 'answer_share_events', 'feedback_events', 'editor_accounts',
  'editor_role_grants', 'editor_totp_factors', 'editor_recovery_codes', 'editor_sessions',
  'idempotency_records', 'rate_limit_windows',
]);
const identifier = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/;

export class LegacyMigrationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'LegacyMigrationError';
    this.code = code;
    this.details = details;
  }
}

function reject(code, message, details) { throw new LegacyMigrationError(code, message, details); }
function required(value, label) {
  if (value === undefined || value === null) reject('LEGACY_REFERENCE', `Missing ${label}`);
  return value;
}
function iso(seconds, label) {
  if (!Number.isSafeInteger(seconds) || seconds < 0 || !Number.isFinite(new Date(seconds * 1000).valueOf())) {
    reject('LEGACY_TIME', `Invalid timestamp: ${label}`);
  }
  return new Date(seconds * 1000).toISOString();
}
function stableId(kind, value) {
  return `legacy-${kind}-${createHash('sha256').update(String(value)).digest('hex').slice(0, 40)}`;
}
function sourceUrl(value, origin) {
  if (typeof value !== 'string' || !value.trim()) reject('LEGACY_URL', 'Source URL is missing');
  let parsed;
  try { parsed = new URL(value); }
  catch {
    if (!origin) reject('PUBLIC_ORIGIN_REQUIRED', 'Relative legacy source URLs require --public-origin');
    parsed = new URL(value, origin);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    reject('LEGACY_URL', 'Sources require HTTP(S) URLs without credentials');
  }
  return parsed.href;
}

function readTables(sourcePath, includePrivate = false) {
  const source = realpathSync(resolve(sourcePath));
  if (!statSync(source).isFile()) reject('LEGACY_SOURCE', 'Source must be an existing SQLite file');
  const sourceSha256 = createHash('sha256').update(readFileSync(source)).digest('hex');
  for (const suffix of ['-wal', '-shm', '-journal']) {
    if (existsSync(source + suffix)) reject('LIVE_DATABASE', 'Use a closed, checkpointed SQLite copy without journal sidecars');
  }
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    db.exec('PRAGMA query_only = ON');
    db.exec('BEGIN');
    const integrity = db.prepare('PRAGMA quick_check').all();
    if (integrity.some(row => Object.values(row)[0] !== 'ok')) reject('LEGACY_INTEGRITY', 'SQLite quick_check failed');
    if (db.prepare('PRAGMA foreign_key_check').all().length) reject('LEGACY_INTEGRITY', 'Legacy database contains dangling foreign keys');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    const rows = {}, counts = {}, unsupported = [];
    for (const { name } of tables) {
      const quoted = '"' + name.replaceAll('"', '""') + '"';
      const count = Number(db.prepare(`SELECT COUNT(*) AS count FROM ${quoted}`).get().count);
      counts[name] = count;
      if (!supportedTables.has(name) && !(includePrivate && privateTables.has(name))) {
        if (count) unsupported.push({ table: name, count });
        continue;
      }
      rows[name] = db.prepare(`SELECT * FROM ${quoted}`).all().map(row => ({ ...row }));
    }
    if (unsupported.length) reject('UNSUPPORTED_LEGACY_DATA', 'Private, identity, event or unknown nonempty tables need a separately reviewed migration; no output was produced', { tables: unsupported });
    const missing = contentTables.filter(name => !Object.hasOwn(rows, name));
    if (missing.length) reject('LEGACY_SCHEMA', 'Expected the complete legacy content schema', { missing });
    const nonContentOperations = (rows.workflow_operations ?? []).filter(row => row.target_type !== 'answer_card');
    if (nonContentOperations.length && !includePrivate) reject('UNSUPPORTED_LEGACY_DATA', 'Private workflow history requires the private migration path', { tables: [{ table: 'workflow_operations', count: nonContentOperations.length }] });
    if (createHash('sha256').update(readFileSync(source)).digest('hex') !== sourceSha256) reject('LIVE_DATABASE', 'Source changed during migration; use a closed SQLite copy');
    return { source, rows, counts, sourceSha256 };
  } finally { db.close(); }
}

function migratePrivateState(state, rows, options) {
  const { lifecycleConfig: config, participantsConfig, targetKeyring, legacyKeyring } = options;
  if (!config?.workflows || !participantsConfig || !targetKeyring) reject('PRIVATE_CONFIG_REQUIRED', 'Private migration requires lifecycleConfig, participantsConfig and targetKeyring');
  validateParticipantConfig(participantsConfig);
  if (participantsConfig.selfService.types.some(type => !Object.hasOwn(config.workflows, type))) reject('PRIVATE_CONFIG_REQUIRED', 'Participant self-service types must exist in the supplied lifecycle config');
  if (options.subjectMappings !== undefined && (!options.subjectMappings || Array.isArray(options.subjectMappings) || typeof options.subjectMappings !== 'object' || Object.values(options.subjectMappings).some(value => typeof value !== 'string'))) reject('SUBJECT_MAPPINGS', 'Reviewed subject mappings must be a JSON object of record keys to subject IDs');
  if (!Array.isArray(options.withdrawnSubjectIds) || !Array.isArray(options.revokedSubjectIds)) reject('REVOCATION_REGISTERS_REQUIRED', 'Provide independently reviewed withdrawnSubjectIds and revokedSubjectIds arrays, including explicit empty arrays');
  encryptPrivatePayload('migration-key-check', {}, targetKeyring);
  const now = Date.parse(options.now), data = state.modules.lifecycle;
  const table = name => rows[name] ?? [];
  const participantRows = new Map(table('pilot_participants').map(row => [row.id, row]));
  const subjectMap = new Map(table('pilot_participants').map(row => [row.id, identifier.test(`participant:${row.id}`) ? `participant:${row.id}` : `participant:${stableId('subject', row.id)}`]));
  const normalizeSubject = id => subjectMap.get(id) ?? id;
  const withdrawn = new Set(options.withdrawnSubjectIds.map(normalizeSubject));
  const revoked = new Set(options.revokedSubjectIds.map(normalizeSubject));
  const mappings = [], purged = [], reencrypted = [], decisions = [], archived = [];
  const currentConsentRequired = [], eligibilityReviewRequired = [];
  const recordIds = new Set();
  for (const value of [...withdrawn, ...revoked]) if (typeof value !== 'string' || !identifier.test(value) || !value.startsWith('participant:')) reject('REVOCATION_REGISTER', 'Participant registers must contain known legacy IDs or participant: identifiers');

  function policy(type) {
    const value = config.workflows[type];
    if (!value || !Number.isSafeInteger(value.retentionMs) || value.retentionMs <= 0) reject('LEGACY_WORKFLOW', `Missing bounded workflow ${type}`);
    return value;
  }
  function ensureSubject(id) {
    data.subjects[id] ??= { id, epoch: 0, consents: {}, eligibility: {}, withdrawnAt: null };
    return data.subjects[id];
  }
  function owner(row, key, allowAnonymous = false) {
    const mapped = options.subjectMappings?.[key] ?? row.pilot_participant_id;
    if (mapped !== null && mapped !== undefined) {
      const id = normalizeSubject(mapped);
      if (!Object.hasOwn(data.subjects, id)) reject('UNRESOLVED_LEGACY_SUBJECT', `Unknown reviewed subject for ${key}`);
      return id;
    }
    if (!allowAnonymous) reject('UNRESOLVED_LEGACY_SUBJECT', `An unexpired research record requires an authoritative subject mapping: ${key}`, { key });
    return ensureSubject(`legacy-anonymous:${stableId('subject', key)}`).id;
  }
  function milliseconds(value, label) { return Date.parse(iso(value, label)); }
  function expiry(createdAt, type, original) {
    const cap = createdAt + policy(type).retentionMs;
    return original === undefined ? cap : Math.min(original, cap);
  }
  function notes(targetType, id) {
    return table('case_notes').filter(row => row.target_type === targetType && row.target_id === id)
      .sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id))
      .map(row => ({ id: row.id, text: row.body, actorId: row.author_editor_id, createdAt: milliseconds(row.created_at, `${row.id}.created_at`) }));
  }
  function workflowHistory(targetType, id) {
    return table('workflow_operations').filter(row => row.target_type === targetType && row.target_id === id);
  }
  function auditHistory(id) { return table('audit_events').filter(row => row.target_id === id); }
  function record({ id, type, status, version = 0, subjectId = null, createdAt, updatedAt = createdAt, expiresAt,
    purgedAt = null, assignee = null, decisionCode = null, entityId = null, revisionId = null, payload, sourceTable }) {
    if (recordIds.has(id)) reject('LEGACY_ID_COLLISION', `Private IDs collide across legacy tables: ${id}`);
    if (createdAt > now) reject('LEGACY_TIME', `Private record ${id} has a future creation time; review the source clock before migration`);
    recordIds.add(id);
    const workflow = policy(type), subject = subjectId ? ensureSubject(subjectId) : null;
    const shouldPurge = purgedAt !== null || expiresAt <= now || subject?.withdrawnAt !== null && subject?.withdrawnAt !== undefined;
    const result = shouldPurge || decisionCode === null ? null : workflow.publicResults?.[decisionCode] ?? null;
    if (entityId !== null && !state.modules.content.entities.some(entity => entity.id === entityId)) reject('LEGACY_REFERENCE', `Unknown linked entity for private record ${id}`);
    if (revisionId !== null && !state.modules.content.revisions.some(revision => revision.id === revisionId && revision.entityId === entityId)) reject('LEGACY_REFERENCE', `Unknown or mismatched linked revision for private record ${id}`);
    let envelope = null;
    if (!shouldPurge) {
      const converted = payload();
      converted.legacy = { ...converted.legacy, references: { entityId, revisionId }, auditHistory: auditHistory(id) };
      envelope = encryptPrivatePayload(id, converted, targetKeyring);
    }
    const value = {
      id, type, status, version, subjectId: shouldPurge ? null : subjectId, consentEpoch: subject?.epoch ?? 0,
      // Retained private links are not new permission to publish historical outcomes.
      entityId: null, revisionId: null,
      externalId: shouldPurge ? null : id, assignee: shouldPurge ? null : assignee,
      decisionCode: shouldPurge ? null : decisionCode, publicResult: result ? structuredClone(result) : null,
      createdAt, updatedAt: shouldPurge ? Math.max(updatedAt, purgedAt ?? now) : updatedAt,
      expiresAt, purgedAt: shouldPurge ? purgedAt ?? now : null,
      payload: envelope,
    };
    if (!shouldPurge && subjectId === null) reject('UNRESOLVED_LEGACY_SUBJECT', `Missing retained subject for ${id}`);
    data.records[id] = value;
    mappings.push({ table: sourceTable, legacyId: id, recordId: id, type, requiresLinkReview: !shouldPurge && entityId !== null });
    if (shouldPurge) purged.push({ table: sourceTable, recordId: id });
    return value;
  }

  for (const row of participantRows.values()) {
    const id = subjectMap.get(row.id);
    if (!['active', 'withdrawn'].includes(row.status)) reject('LEGACY_SUBJECT', `Unknown participant status for ${row.id}`);
    if (row.status === 'withdrawn') {
      if (row.withdrawn_at === null) reject('LEGACY_SUBJECT', `Withdrawn participant ${row.id} lacks a withdrawal time`);
      withdrawn.add(id);
    }
    const withdrawnAt = withdrawn.has(id) ? row.withdrawn_at === null ? now : milliseconds(row.withdrawn_at, `${row.id}.withdrawn_at`) : null;
    const subject = { id, epoch: withdrawnAt === null ? 0 : 1, consents: {}, eligibility: {}, withdrawnAt };
    if (withdrawnAt === null) {
      for (const consent of table('pilot_consent_records').filter(consent => consent.participant_id === row.id && consent.withdrawn_at === null).sort((a, b) => a.granted_at - b.granted_at)) {
        if (consent.separate_consent !== 1) reject('LEGACY_CONSENT', `Consent ${consent.id} was not separate`);
        subject.consents[consent.purpose] = { version: consent.notice_version, grantedAt: milliseconds(consent.granted_at, `${consent.id}.granted_at`) };
      }
      if (!revoked.has(id)) {
        currentConsentRequired.push(id);
        eligibilityReviewRequired.push(id);
      }
    }
    data.subjects[id] = subject;
    if (withdrawnAt !== null) revoked.add(id);
    state.modules.participants.subjects.push({
      id, eligibility: {}, createdAt: milliseconds(row.created_at, `${row.id}.created_at`),
      revokedAt: revoked.has(id) ? withdrawnAt ?? now : null,
    });
  }
  for (const id of withdrawn) {
    const subject = ensureSubject(id);
    subject.withdrawnAt ??= now; subject.epoch = Math.max(subject.epoch, 1); subject.consents = {}; subject.eligibility = {};
  }

  for (const row of table('research_intakes')) {
    const type = row.kind, createdAt = milliseconds(row.submitted_at, `${row.id}.submitted_at`);
    const expiresAt = expiry(createdAt, type, milliseconds(row.expires_at, `${row.id}.expires_at`));
    const alreadyPurged = row.purged_at !== null || row.status === 'expired' || expiresAt <= now;
    const subjectId = alreadyPurged ? null : owner(row, `research_intakes:${row.id}`);
    record({
      id: row.id, type, status: row.status, version: row.lock_version, subjectId, createdAt,
      updatedAt: row.actioned_at === null ? createdAt : milliseconds(row.actioned_at, `${row.id}.actioned_at`),
      expiresAt, purgedAt: alreadyPurged ? row.purged_at === null ? now : milliseconds(row.purged_at, `${row.id}.purged_at`) : null,
      assignee: row.assignee_editor_id, decisionCode: row.decision_code,
      entityId: row.linked_card_id, revisionId: row.linked_revision_id, sourceTable: 'research_intakes',
      payload: () => {
        let original = { contextScope: row.context_scope, body: row.body, sourceUrl: row.source_url, provenanceRole: row.provenance_role };
        let originalEnvelope = null;
        if (row.payload_ciphertext !== null) {
          if (!options.reencryptLegacy) reject('REENCRYPTION_CONFIRMATION_REQUIRED', 'Retained legacy ciphertext requires explicit reencryptLegacy / --reencrypt-legacy');
          if (!legacyKeyring) reject('LEGACY_KEYRING_REQUIRED', `Legacy keyring is required to authenticate retained intake ${row.id}`);
          originalEnvelope = importLegacyIntakeEnvelope(row.id, row.payload_ciphertext, String(row.payload_key_version));
          original = decryptPrivatePayload(row.id, originalEnvelope, legacyKeyring);
          reencrypted.push({ recordId: row.id, originalAad: originalEnvelope.aad, originalKeyVersion: originalEnvelope.keyVersion, targetKeyVersion: targetKeyring.activeVersion });
        }
        if (!original || Array.isArray(original) || typeof original !== 'object' || typeof original.contextScope !== 'string') reject('LEGACY_PRIVATE_PAYLOAD', `Intake ${row.id} does not contain the expected authenticated legacy payload`);
        return {
          data: { ...original, originQueryEventId: row.origin_query_event_id, outcomeReason: row.outcome_reason },
          internalNotes: notes('research_intake', row.id),
          legacy: { originalEnvelope, assignedAt: row.assigned_at, lastWorkflowOperationId: row.last_workflow_operation_id,
            workflowHistory: workflowHistory('research_intake', row.id) },
        };
      },
    });
  }
  for (const row of table('reports')) {
    const type = row.type === 'privacy' ? 'privacy_report' : 'report';
    const createdAt = milliseconds(row.created_at, `${row.id}.created_at`), expiresAt = expiry(createdAt, type);
    const subjectId = expiresAt <= now ? null : owner(row, `reports:${row.id}`, type === 'privacy_report');
    record({
      id: row.id, type, status: row.status, version: row.lock_version, subjectId, createdAt,
      updatedAt: Math.max(createdAt, milliseconds(row.updated_at ?? row.created_at, `${row.id}.updated_at`)),
      expiresAt, assignee: row.assignee_editor_id, decisionCode: row.decision_code,
      entityId: row.resolution_card_id ?? row.target_card_id, revisionId: row.resolution_revision_id,
      sourceTable: 'reports',
      payload: () => ({
        data: { type: row.type, cardId: row.target_card_id, affectedArea: row.affected_area, priority: row.priority,
          legacyPublicCode: row.public_code, legacyPublicResponse: row.public_response,
          assignedAt: row.assigned_at, slaDueAt: row.sla_due_at, reviewingAt: row.reviewing_at, resolvedAt: row.resolved_at },
        internalNotes: notes('report', row.id),
        legacy: { workflowHistory: workflowHistory('report', row.id) },
      }),
    });
    if (row.public_response !== null) decisions.push({ recordId: row.id, legacyResponse: 'encrypted-only', publishedResult: 'current-configured-decision-only' });
  }
  for (const note of table('case_notes')) {
    if (!['report', 'research_intake'].includes(note.target_type) || !Object.hasOwn(data.records, note.target_id)) reject('LEGACY_REFERENCE', `Case note ${note.id} has an unsupported or missing target`);
  }
  for (const operation of table('workflow_operations')) {
    if (operation.target_type !== 'answer_card' && (!['report', 'research_intake'].includes(operation.target_type) || !Object.hasOwn(data.records, operation.target_id))) reject('LEGACY_REFERENCE', `Workflow operation ${operation.id} has an unsupported or missing target`);
  }
  const sessions = new Map(table('pilot_sessions').map(row => [row.id, row]));
  const events = new Map(table('query_events').map(row => [row.id, row]));
  const children = ['query_result_impressions', 'answer_open_events', 'answer_share_events', 'feedback_events'];
  for (const name of children) for (const child of table(name)) {
    if (child.query_event_id !== null && !events.has(child.query_event_id)) reject('LEGACY_REFERENCE', `${name} contains an unknown query event`);
  }
  for (const row of events.values()) {
    const createdAt = milliseconds(row.created_at, `${row.id}.created_at`), expiresAt = expiry(createdAt, 'research_event');
    const removed = row.principal_kind === 'withdrawn' || expiresAt <= now;
    const session = row.pilot_session_id === null ? null : required(sessions.get(row.pilot_session_id), `pilot session ${row.pilot_session_id}`);
    const subjectId = removed ? null : owner({ pilot_participant_id: session?.participant_id }, `query_events:${row.id}`, row.principal_kind !== 'research_participant');
    record({
      id: row.id, type: 'research_event', status: 'recorded', subjectId, createdAt, expiresAt,
      purgedAt: removed ? now : null, sourceTable: 'query_events',
      payload: () => ({ data: { eventType: 'legacy_query', query: row,
        ...Object.fromEntries(children.map(name => [name, table(name).filter(child => child.query_event_id === row.id)])) }, internalNotes: [] }),
    });
  }
  for (const row of table('feedback_events').filter(row => row.query_event_id === null)) {
    const createdAt = milliseconds(row.created_at, `${row.id}.created_at`), expiresAt = expiry(createdAt, 'research_event');
    record({ id: row.id, type: 'research_event', status: 'recorded',
      subjectId: expiresAt <= now ? null : owner({}, `feedback_events:${row.id}`, true), createdAt, expiresAt,
      sourceTable: 'feedback_events', payload: () => ({ data: { eventType: 'legacy_feedback', feedback: row }, internalNotes: [] }) });
  }
  for (const row of participantRows.values()) {
    const subjectId = subjectMap.get(row.id), createdAt = milliseconds(row.created_at, `${row.id}.created_at`);
    const id = stableId('participant-history', row.id);
    const relatedIds = new Set([row.id, ...table('pilot_invitations').filter(value => value.participant_id === row.id).map(value => value.id), ...table('pilot_sessions').filter(value => value.participant_id === row.id).map(value => value.id)]);
    record({ id, type: 'research_event', status: 'recorded', subjectId, createdAt, expiresAt: expiry(createdAt, 'research_event'),
      sourceTable: 'pilot_participants', payload: () => ({
        data: { eventType: 'legacy_participant_history', participant: row,
          consentHistory: table('pilot_consent_records').filter(consent => consent.participant_id === row.id),
          invitations: table('pilot_invitations').filter(invitation => invitation.participant_id === row.id).map(({ token_hash, ...rest }) => rest),
          sessions: table('pilot_sessions').filter(session => session.participant_id === row.id).map(({ token_hash, ...rest }) => rest),
          auditHistory: table('audit_events').filter(entry => relatedIds.has(entry.target_id)) }, internalNotes: [],
      }) });
  }
  for (const row of table('editor_accounts')) {
      archived.push({ id: row.id, email: row.email, displayName: row.display_name, status: row.status,
      createdAt: row.created_at, updatedAt: row.updated_at,
      roles: table('editor_role_grants').filter(grant => grant.account_id === row.id), auditHistory: auditHistory(row.id) });
  }
  const identityArchive = archived.length ? encryptPrivatePayload('legacy-editor-identities', { identities: archived }, targetKeyring) : null;
  const validation = structuredClone(state);
  validation.modules.lifecycle = lifecycleModule.initialState();
  lifecycleCommand(validation, { id: 'offline-migration-validator', mfa: true, roles: ['safety_reviewer'] },
    { action: 'import', data }, { config, keyring: targetKeyring, now });
  return {
    mappings, purged, reencrypted, decisions,
    subjectMappings: [...subjectMap].map(([legacyId, subjectId]) => ({ legacyId, subjectId })),
    withdrawnSubjectIds: [...withdrawn], revokedSubjectIds: [...revoked],
    requiresCurrentConsent: currentConsentRequired, requiresEligibilityReview: eligibilityReviewRequired,
    requiresEditorBootstrap: archived.map(row => row.id), identityArchive,
    invalidated: Object.fromEntries(['pilot_invitations', 'pilot_sessions', 'editor_accounts', 'editor_totp_factors', 'editor_recovery_codes', 'editor_sessions', 'idempotency_records', 'rate_limit_windows'].map(name => [name, table(name).length])),
    legacyReportReceipts: 'Not imported; old public codes do not become runtime capabilities.',
    privateReferences: 'Validated legacy links remain encrypted until explicit review; migration does not publish private historical outcomes.',
    archiveHandling: 'The encrypted editor identity archive is offline handover evidence, not live runtime data. Keep it in restricted storage and delete it after independently re-bootstraping and reconciling identities.',
  };
}

function catalogFrom(rows) {
  return {
    schemaVersion: 1,
    topics: rows.topics.map(row => ({
      id: row.id, slug: row.slug, titleZh: row.title_zh, titleEn: row.title_en,
      description: row.description, status: row.status,
      aliases: rows.topic_aliases.filter(alias => alias.topic_id === row.id).map(alias => alias.normalized_alias),
    })),
    scopes: rows.applicability_scopes.map(row => ({
      id: row.id, dimension: row.dimension, code: row.code, labelZh: row.label_zh,
      labelEn: row.label_en, sortOrder: row.sort_order, status: row.status ?? 'active',
    })),
    publishers: rows.publishers.map(row => ({
      id: row.id, type: row.type, nameZh: row.name_zh, nameEn: row.name_en,
      canonicalUrl: row.canonical_url, verificationStatus: row.verification_status,
    })),
  };
}

/** A private offline migration artifact, never a public export or live database update. */
export function readLegacySnapshot(sourcePath, { profile, communityId, publicOrigin, now = new Date().toISOString(), ...privateOptions } = {}) {
  validateContentProfile(profile);
  if (!identifier.test(communityId ?? '')) reject('COMMUNITY_ID', 'A stable community ID is required');
  if (!Number.isFinite(Date.parse(now))) reject('LEGACY_TIME', 'Migration time must be an ISO timestamp');
  if (publicOrigin) {
    const url = new URL(publicOrigin);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.origin !== publicOrigin.replace(/\/$/, '')) {
      reject('PUBLIC_ORIGIN', '--public-origin must be an HTTP(S) origin without credentials or a path');
    }
  }
  const answerType = required(profile.entityTypes.find(type => type.id === 'answer' && type.role === 'content'), 'answer content type').id;
  const sourceType = required(profile.entityTypes.find(type => type.id === 'artifact' && type.role === 'source'), 'artifact source type').id;
  const { source, rows, counts, sourceSha256 } = readTables(sourcePath, privateOptions.includePrivate === true);
  const catalog = catalogFrom(rows);
  const lookup = name => new Map(rows[name].map(row => [row.id, row]));
  const artifacts = lookup('artifacts'), artifactRevisions = lookup('artifact_revisions');
  const publishers = lookup('publishers'), cards = lookup('answer_cards'), topics = lookup('topics');
  const scopes = lookup('applicability_scopes'), answerRevisions = lookup('answer_card_revisions');
  const content = contentModule.initialState({ profile });
  const sourceMappings = [], spanSources = new Map(), linkSources = new Map();
  const unarchivedRevisionIds = new Set();

  function addSource(revision, { key, legacyId, revisionId, text, title, url, visibility, metadata = {}, mode, issuedAt, accessedAt }) {
    const artifact = required(artifacts.get(revision.artifact_id), `artifact ${revision.artifact_id}`);
    const publisher = required(publishers.get(artifact.publisher_id), `publisher ${artifact.publisher_id}`);
    const entityId = stableId('source', key);
    const active = artifact.moderation_status === 'approved';
    const withdrawn = artifact.moderation_status === 'withdrawn' || revision.visibility === 'withdrawn' || visibility === 'withdrawn';
    content.entities.push({
      id: entityId, type: sourceType, externalId: artifact.id, externalRevision: legacyId,
      version: 0, publicRevisionId: null, publishedRevisionIds: [],
      hidden: !active || revision.visibility !== 'public' || visibility !== 'public',
      disposition: withdrawn ? 'withdrawn' : 'active',
    });
    const rights = revision.rights_expires_at === null ? {} : { expiresAt: iso(revision.rights_expires_at, `${revision.id}.rights_expires_at`) };
    const data = {
      title: title ?? publisher.name_zh,
      url: sourceUrl(url ?? artifact.canonical_url, publicOrigin), mode, publisher: publisher.name_zh,
      ...(issuedAt == null ? {} : { issuedAt: iso(issuedAt, `${legacyId}.issuedAt`) }),
      accessedAt: iso(accessedAt ?? revision.captured_at, `${legacyId}.accessedAt`),
    };
    if (mode === 'link-only') {
      if (Object.keys(rights).length) data.rights = rights;
    } else {
      if (!['quote_allowed', 'snapshot_allowed'].includes(revision.rights_mode)) reject('LEGACY_RIGHTS', `Excerpt ${legacyId} has no legacy excerpt permission`);
      data.text = required(text, `archived text for ${legacyId}`);
      data.rights = { basis: 'permission', reference: `legacy:${revision.id}:${revision.rights_mode}`, ...rights };
    }
    content.revisions.push({
      id: revisionId, entityId, number: 1, parentRevisionId: null,
      createdAt: iso(revision.recorded_at, `${revision.id}.recorded_at`), data,
      extensions: mode === 'link-only'
        ? { externalId: legacyId, externalRevision: 1 }
        : { externalId: legacyId, artifactRevisionId: revision.id, ...metadata },
    });
    const mapping = { kind: key.split(':')[0], legacyId, artifactId: artifact.id, artifactRevisionId: revision.id, entityId, revisionId };
    sourceMappings.push(mapping);
    return mapping;
  }

  for (const revision of rows.artifact_revisions) {
    if (!['link_only', 'quote_allowed', 'snapshot_allowed'].includes(revision.rights_mode)) reject('LEGACY_RIGHTS', `Unknown rights mode for ${revision.id}`);
    if (revision.rights_mode === 'link_only' && (revision.archived_text !== null || revision.content_hash !== null)) reject('LEGACY_RIGHTS', 'Link-only legacy content retains an archive or content hash');
    // Quote-only revisions need not contain a complete archive; their exact retained spans are mapped below.
    if (revision.rights_mode !== 'link_only' && !revision.archived_text) {
      if (!rows.evidence_spans.some(span => span.artifact_revision_id === revision.id)) reject('LEGACY_EVIDENCE', `No retained excerpt for ${revision.id}`);
      unarchivedRevisionIds.add(revision.id);
      continue;
    }
    addSource(revision, {
      key: `revision:${revision.id}`, legacyId: revision.id, revisionId: revision.id,
      text: revision.archived_text, visibility: revision.visibility,
      mode: revision.rights_mode === 'link_only' ? 'link-only' : 'excerpt',
      issuedAt: revision.published_at, metadata: { contentHash: revision.content_hash },
    });
  }
  for (const span of rows.evidence_spans) {
    const revision = required(artifactRevisions.get(span.artifact_revision_id), `source revision ${span.artifact_revision_id}`);
    const sourceRevisionId = unarchivedRevisionIds.delete(revision.id) ? revision.id : stableId('span-revision', span.id);
    const mapping = addSource(revision, {
      key: `span:${span.id}`, legacyId: span.id, revisionId: sourceRevisionId,
      text: span.quote, visibility: span.visibility, mode: 'excerpt', issuedAt: revision.published_at,
      metadata: { locatorKind: span.locator_kind, locatorValue: span.locator_value, spanHash: span.span_hash },
    });
    spanSources.set(span.id, { ...mapping, quote: span.quote });
  }
  for (const link of rows.link_citations) {
    const revision = required(artifactRevisions.get(link.artifact_revision_id), `source revision ${link.artifact_revision_id}`);
    linkSources.set(link.id, addSource(revision, {
      key: `link:${link.id}`, legacyId: link.id, revisionId: stableId('link-revision', link.id),
      title: link.title, url: link.url, visibility: revision.visibility, mode: 'link-only',
      issuedAt: link.published_at, accessedAt: link.accessed_at,
    }));
  }
  for (const card of rows.answer_cards) {
    if (!['unpublished', 'published', 'hidden', 'tombstoned'].includes(card.publication_status)) reject('LEGACY_PUBLICATION', `Unknown publication state for ${card.id}`);
    if (card.publication_status === 'unpublished' && card.current_public_revision_id !== null) reject('LEGACY_PUBLICATION', `Unpublished card ${card.id} has a public revision pointer`);
    const topic = required(topics.get(card.topic_id), `topic ${card.topic_id}`);
    const published = rows.publish_operations.filter(operation => operation.card_id === card.id && operation.applied_at !== null)
      .sort((a, b) => a.applied_at - b.applied_at || a.created_at - b.created_at || a.id.localeCompare(b.id));
    const publishedRevisionIds = [...new Set(published.map(operation => operation.revision_id))];
    if (card.current_public_revision_id !== null && !publishedRevisionIds.includes(card.current_public_revision_id)) reject('LEGACY_PUBLICATION', `Current revision of ${card.id} has no applied publication operation`);
    if (card.publication_status === 'published' && card.current_public_revision_id === null) reject('LEGACY_PUBLICATION', `Published card ${card.id} has no current revision`);
    content.entities.push({
      id: card.id, type: answerType, externalId: card.id,
      extensions: { slug: card.slug, topicId: card.topic_id, riskLevel: card.risk_level },
      version: card.lock_version, publicRevisionId: card.current_public_revision_id,
      publishedRevisionIds, hidden: ['hidden', 'tombstoned'].includes(card.publication_status) || topic.status !== 'active',
      disposition: card.publication_status === 'tombstoned' ? 'withdrawn' : 'active',
    });
  }
  for (const revision of rows.answer_card_revisions) {
    const card = required(cards.get(revision.card_id), `card ${revision.card_id}`);
    const selected = rows.answer_card_revision_scopes.filter(row => row.card_revision_id === revision.id)
      .map(row => required(scopes.get(row.scope_id), `scope ${row.scope_id}`));
    const scope = {};
    if (revision.scope_mode === 'universal') for (const dimension of profile.scope.dimensions) scope[dimension] = [profile.scope.universal];
    else if (revision.scope_mode === 'unknown') for (const dimension of profile.scope.dimensions) scope[dimension] = [profile.scope.unknown];
    else if (revision.scope_mode === 'constrained') for (const selectedScope of selected) (scope[selectedScope.dimension] ??= []).push(selectedScope.code);
    else reject('LEGACY_SCOPE', `Unknown scope mode for ${revision.id}`);
    const sentences = rows.answer_card_revision_sentences.filter(row => row.card_revision_id === revision.id)
      .sort((a, b) => a.ordinal - b.ordinal)
      .map(row => ({ id: row.sentence_key, text: row.text, kind: row.is_factual ? 'fact' : 'advice' }));
    content.revisions.push({
      id: revision.id, entityId: card.id, number: revision.version_number,
      parentRevisionId: revision.parent_revision_id, createdAt: iso(revision.created_at, `${revision.id}.created_at`),
      data: {
        title: revision.title, summary: revision.summary, sentences, scope,
        impact: card.risk_level, origin: revision.generation_type,
        reviewDueAt: iso(revision.review_due_at, `${revision.id}.review_due_at`),
        asOf: revision.as_of, verifiedAt: iso(revision.verified_at, `${revision.id}.verified_at`),
        reviewOwnerId: revision.review_owner_id, reviewOwnerLabel: revision.review_owner_label,
        scopeMode: revision.scope_mode, scopeIds: selected.map(row => row.id), locale: revision.locale,
        evidenceCoverage: revision.evidence_coverage, disputeStatus: revision.dispute_status,
        ...(revision.evidence_note === null ? {} : { evidenceNote: revision.evidence_note }), searchText: revision.search_text,
      },
      extensions: { externalRevisionId: revision.id, editorId: revision.editor_id, expectedCardVersion: revision.expected_card_version },
    });
  }
  for (const citation of rows.answer_card_sentence_citations) {
    required(answerRevisions.get(citation.card_revision_id), `answer revision ${citation.card_revision_id}`);
    if ((citation.evidence_span_id !== null) === (citation.link_citation_id !== null)) reject('LEGACY_EVIDENCE', 'Each legacy citation must have exactly one source');
    const source = citation.evidence_span_id !== null
      ? required(spanSources.get(citation.evidence_span_id), `span ${citation.evidence_span_id}`)
      : required(linkSources.get(citation.link_citation_id), `link ${citation.link_citation_id}`);
    content.citations.push({
      id: stableId('citation', JSON.stringify([citation.card_revision_id, citation.sentence_key, citation.ordinal])),
      revisionId: citation.card_revision_id, sentenceId: citation.sentence_key,
      sourceEntityId: source.entityId, sourceRevisionId: source.revisionId,
      position: citation.evidence_span_id !== null ? { kind: 'text', start: 0, end: source.quote.length } : { kind: 'link' },
      order: citation.ordinal - 1, externalId: citation.evidence_span_id ?? citation.link_citation_id,
    });
  }
  validateContent(content);
  const modules = [{ ...contentModule, initialState: () => contentModule.initialState({ profile }) }, authModule, lifecycleModule, participantsModule, reportsModule];
  const validationStore = new RuntimeStore(':memory:', { communityId, modules });
  let backup;
  let privateReport = null;
  try {
    backup = validationStore.backup();
    backup.createdAt = new Date(now).toISOString();
    backup.state.modules.content = content;
    backup.state.audit = rows.audit_events.map(row => ({
      id: row.id, actorId: row.actor_id, action: row.action, targetId: row.target_id,
      at: row.created_at * 1000,
      metadata: { targetType: row.target_type, reason: row.reason, requestId: row.request_id, legacyMetadataJson: row.metadata_json },
    }));
    if (privateOptions.includePrivate) {
      privateReport = migratePrivateState(backup.state, rows, { ...privateOptions, now });
      const subjects = new Map(privateReport.subjectMappings.map(row => [row.legacyId, row.subjectId]));
      for (const credential of [...(rows.pilot_invitations ?? []), ...(rows.pilot_sessions ?? [])]) subjects.set(credential.id, subjects.get(credential.participant_id));
      const retainedPrivateIds = new Set(privateReport.mappings.map(row => row.recordId));
      const purgedIds = new Set(privateReport.purged.map(row => row.recordId));
      const withdrawn = new Set(privateReport.withdrawnSubjectIds);
      const editorIds = new Set(privateReport.requiresEditorBootstrap);
      backup.state.audit = backup.state.audit.map(entry => {
        let metadata;
        try { metadata = entry.metadata.legacyMetadataJson === null ? null : JSON.parse(entry.metadata.legacyMetadataJson); }
        catch { reject('LEGACY_AUDIT_JSON', `Audit ${entry.id} requires reviewed metadata JSON`); }
        const { legacyMetadataJson, ...fields } = entry.metadata;
        const subjectId = subjects.get(entry.targetId);
        const privateTarget = retainedPrivateIds.has(entry.targetId) || subjectId || editorIds.has(entry.targetId);
        if (['research_intake', 'report', 'pilot_participant', 'pilot_invitation', 'pilot_session'].includes(fields.targetType) && !privateTarget) reject('LEGACY_PRIVATE_AUDIT_REFERENCE', `Audit ${entry.id} has no retained private target`);
        return { ...entry, ...(subjectId ? { subjectId } : {}), metadata: privateTarget
          ? { targetType: fields.targetType, requestId: fields.requestId, legacyDetailsEncrypted: true }
          : { ...fields, legacy: metadata } };
      }).filter(entry => !purgedIds.has(entry.targetId) && !withdrawn.has(entry.subjectId));
    }
    const restoreOptions = { now: Date.parse(now), withdrawnSubjectIds: privateReport?.withdrawnSubjectIds ?? [], revokedSubjectIds: privateReport?.revokedSubjectIds ?? [] };
    validationStore.restore(backup, restoreOptions);
    if (privateReport) {
      // Keep reconciliation effects, not pre-cleanup copies, in the actual migration artifact.
      backup.state = validationStore.read();
    }
  } finally { validationStore.close(); }
  return {
    backup, catalog,
    report: {
      kind: 'private-legacy-migration', schemaVersion: 1, scope: privateReport ? 'content-and-private' : 'content-only', source, createdAt: backup.createdAt,
      sourceSha256, counts, sourceMappings,
      credentialsImported: false,
      ...(privateReport ? { private: privateReport } : {}),
      limitations: [
        privateReport ? 'Private migration requires renewed eligibility and consent; credentials and old report capabilities are not restored.' : 'Private records, participants, accounts, sessions and research events are unsupported and rejected when present.',
        'Source revisions and spans are separated by visibility boundary; external identities and mappings retain original relationships.',
        'This artifact contains private editorial history. Never serve it as public site data.',
      ],
      legacyTables: privateReport ? {
        ...Object.fromEntries(Object.entries(rows).filter(([name]) => supportedTables.has(name) && !['audit_events', 'workflow_operations'].includes(name))),
        workflow_operations: (rows.workflow_operations ?? []).filter(row => row.target_type === 'answer_card'),
      } : rows,
    },
  };
}

export function writeLegacyMigration(sourcePath, outputPath, options) {
  const output = resolve(outputPath);
  if (existsSync(output)) reject('OUTPUT_EXISTS', 'Output already exists; migration never overwrites files');
  const artifact = readLegacySnapshot(sourcePath, options);
  writeFileSync(output, JSON.stringify(artifact, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return artifact;
}

function main(argv) {
  const flags = new Map();
  const valueFlags = ['--source', '--output', '--profile', '--community-id', '--public-origin',
    '--lifecycle-file', '--participants-file', '--target-keyring-env', '--legacy-keyring-env',
    '--legacy-secret-env', '--subject-mappings', '--withdrawn-register', '--revoked-register'];
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flags.has(flag)) reject('USAGE', `Repeated argument ${flag}`);
    if (['--include-private', '--reencrypt-legacy'].includes(flag)) { flags.set(flag, true); continue; }
    if (!valueFlags.includes(flag) || !argv[index + 1] || argv[index + 1].startsWith('--')) reject('USAGE', 'Usage: node scripts/legacy-migration.mjs --source closed.sqlite --output private-migration.json --profile profile.json --community-id ID [--public-origin ORIGIN] [--include-private --lifecycle-file FILE --participants-file FILE --target-keyring-env NAME --withdrawn-register FILE --revoked-register FILE] [--reencrypt-legacy --legacy-keyring-env NAME | --legacy-secret-env NAME] [--subject-mappings FILE]');
    flags.set(flag, argv[++index]);
  }
  for (const flag of ['--source', '--output', '--profile', '--community-id']) if (!flags.has(flag)) reject('USAGE', `Missing required ${flag}`);
  const jsonFile = flag => JSON.parse(readFileSync(flags.get(flag), 'utf8'));
  function environment(flag, json = true) {
    const name = flags.get(flag);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name ?? '') || !process.env[name]) reject('KEY_ENV_REQUIRED', `${flag} must name a populated environment variable`);
    if (!json) return process.env[name];
    try { return JSON.parse(process.env[name]); }
    catch { reject('KEYRING_JSON', `${flag} does not contain valid keyring JSON`); }
  }
  const privateOptions = {};
  if (flags.has('--include-private')) {
    for (const flag of ['--lifecycle-file', '--participants-file', '--target-keyring-env', '--withdrawn-register', '--revoked-register']) if (!flags.has(flag)) reject('PRIVATE_CONFIG_REQUIRED', `Private migration requires ${flag}`);
    if (flags.has('--legacy-keyring-env') && flags.has('--legacy-secret-env')) reject('USAGE', 'Choose either a derived legacy keyring or the original version-1 secret');
    const participants = jsonFile('--participants-file');
    Object.assign(privateOptions, {
      includePrivate: true, lifecycleConfig: jsonFile('--lifecycle-file'), participantsConfig: participants.participants ?? participants,
      targetKeyring: environment('--target-keyring-env'), withdrawnSubjectIds: jsonFile('--withdrawn-register'), revokedSubjectIds: jsonFile('--revoked-register'),
      reencryptLegacy: flags.has('--reencrypt-legacy'),
      ...(flags.has('--subject-mappings') ? { subjectMappings: jsonFile('--subject-mappings') } : {}),
      ...(flags.has('--legacy-keyring-env') ? { legacyKeyring: environment('--legacy-keyring-env') } : {}),
      ...(flags.has('--legacy-secret-env') ? { legacyKeyring: { keys: { 1: legacyIntakeKey(environment('--legacy-secret-env', false)) } } } : {}),
    });
  } else if (argv.some(flag => valueFlags.slice(5).includes(flag) || flag === '--reencrypt-legacy')) reject('USAGE', 'Private migration options require --include-private');
  const artifact = writeLegacyMigration(flags.get('--source'), flags.get('--output'), {
    profile: JSON.parse(readFileSync(flags.get('--profile'), 'utf8')),
    communityId: flags.get('--community-id'), publicOrigin: flags.get('--public-origin'),
    ...privateOptions,
  });
  process.stdout.write(JSON.stringify({ output: resolve(flags.get('--output')), scope: artifact.report.scope, counts: artifact.report.counts }, null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(process.argv.slice(2)); }
  catch (error) {
    process.stderr.write(JSON.stringify({ code: error.code ?? 'MIGRATION_FAILED', message: error.message, details: error.details ?? {} }) + '\n');
    process.exitCode = 1;
  }
}
