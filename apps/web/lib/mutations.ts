import { ensureDatabase } from '@/db/bootstrap';
import { getD1, getRuntimeValue } from '@/db/index';

import {
  cleanPlainText,
  computeEvidenceCoverage,
  containsLikelyPersonalData,
  dateToEpochEndOfDay,
  FEEDBACK_OUTCOMES,
  isIsoDate,
  isOneOf,
  isSafePublicUrl,
  normalizeSearchText,
  REPORT_TYPES,
  sha256,
  SCOPE_MODES,
  DISPUTE_STATUSES,
  type FeedbackOutcome,
  type ReportType,
} from './domain';
import type {
  CitationDraftInput,
  NewCardInput,
  RevisionDraftInput,
} from './types';
import { AppError } from './errors';

export { AppError } from './errors';

type MutationResult<T> = {
  data: T;
  replayed: boolean;
};

type IdempotencyContext = {
  actorScope: string;
  route: string;
  keyHash: string;
  requestHash: string;
  existing: { statusCode: number; response: unknown } | null;
};

export async function submitFeedback(input: {
  cardRevisionId: string;
  outcome: unknown;
  idempotencyKey: string | null;
}): Promise<MutationResult<{ accepted: true }>> {
  await ensureDatabase();
  if (!isOneOf(input.outcome, FEEDBACK_OUTCOMES)) {
    throw new AppError(
      400,
      'invalid_outcome',
      '只能选择“已解决”或“仍不清楚”。',
    );
  }
  const revisionId = cleanPlainText(input.cardRevisionId, 100);
  if (!revisionId)
    throw new AppError(400, 'missing_revision', '缺少答案版本。');

  const payload = { cardRevisionId: revisionId, outcome: input.outcome };
  const idempotency = await prepareIdempotency(
    'anonymous',
    '/v1/feedback',
    input.idempotencyKey,
    payload,
  );
  if (idempotency.existing) {
    return {
      data: idempotency.existing.response as { accepted: true },
      replayed: true,
    };
  }

  const response = { accepted: true } as const;
  const now = nowSeconds();
  const d1 = getD1();
  try {
    await d1.batch([
      d1
        .prepare(
          `INSERT INTO feedback_events (id, card_revision_id, outcome, created_at)
           VALUES (?, ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), revisionId, input.outcome, now),
      idempotencyInsert(d1, idempotency, 201, response, now + 86_400),
    ]);
  } catch (error) {
    return resolveMutationRaceOrThrow(idempotency, error);
  }
  return { data: response, replayed: false };
}

export async function submitReport(input: {
  cardId: string | null;
  type: unknown;
  inviteSecret: string;
  adultAttested: boolean;
  idempotencyKey: string | null;
}): Promise<MutationResult<{ code: string; status: 'received' }>> {
  await ensureDatabase();
  if (!isOneOf(input.type, REPORT_TYPES)) {
    throw new AppError(400, 'invalid_report_type', '请选择支持的问题类型。');
  }
  const cardId = input.cardId ? cleanPlainText(input.cardId, 100) : null;
  if (!cardId && input.type !== 'privacy') {
    throw new AppError(400, 'missing_card', '请选择需要报告的答案卡。');
  }

  if (input.type !== 'privacy') {
    const configuredSecret = getRuntimeValue('RESEARCH_INTAKE_SECRET');
    if (!configuredSecret) {
      throw new AppError(
        503,
        'invited_reports_closed',
        '非隐私问题报告仅向受邀成年试点参与者开放，当前入口未配置。',
      );
    }
    if (!(await secretsEqual(input.inviteSecret, configuredSecret))) {
      throw new AppError(
        403,
        'invalid_invitation',
        '非隐私问题报告需要有效的试点邀请凭证。',
      );
    }
    if (!input.adultAttested) {
      throw new AppError(
        403,
        'adult_attestation_required',
        '非隐私问题报告只面向已在线下流程确认成年的受邀参与者。',
      );
    }
  }

  const payload = { cardId, type: input.type };
  const idempotency = await prepareIdempotency(
    input.type === 'privacy' ? 'anonymous-privacy' : 'invited-adult',
    '/v1/reports',
    input.idempotencyKey,
    payload,
  );
  if (idempotency.existing) {
    return {
      data: idempotency.existing.response as {
        code: string;
        status: 'received';
      },
      replayed: true,
    };
  }

  if (cardId) {
    const exists = await getD1()
      .prepare(
        `SELECT id FROM answer_cards
         WHERE id = ? AND publication_status = 'published' LIMIT 1`,
      )
      .bind(cardId)
      .first<{ id: string }>();
    if (!exists)
      throw new AppError(404, 'card_not_found', '找不到这张公开答案卡。');
  }

  const id = crypto.randomUUID();
  const code = `XG-${id.replaceAll('-', '').toLocaleUpperCase()}`;
  const response = { code, status: 'received' as const };
  const now = nowSeconds();
  const d1 = getD1();
  try {
    await d1.batch([
      d1
        .prepare(
          `INSERT INTO reports
            (id, public_code, target_card_id, type, status, public_response,
             created_at, resolved_at)
           VALUES (?, ?, ?, ?, 'received', NULL, ?, NULL)`,
        )
        .bind(id, code, cardId, input.type, now),
      idempotencyInsert(d1, idempotency, 201, response, now + 86_400),
    ]);
  } catch (error) {
    return resolveMutationRaceOrThrow(idempotency, error);
  }
  return { data: response, replayed: false };
}

export async function submitResearchIntake(input: {
  inviteSecret: string;
  participantRef: string;
  adultAttested: boolean;
  kind: unknown;
  contextScope: string;
  body?: string | null;
  sourceUrl?: string | null;
  provenanceRole?: string | null;
  idempotencyKey: string | null;
}): Promise<MutationResult<{ reference: string; expiresAt: string }>> {
  await ensureDatabase();
  const configuredSecret = getRuntimeValue('RESEARCH_INTAKE_SECRET');
  if (!configuredSecret) {
    throw new AppError(
      503,
      'intake_closed',
      '私有线索入口尚未配置，当前只保留匿名结构化反馈。',
    );
  }
  if (!(await secretsEqual(input.inviteSecret, configuredSecret))) {
    throw new AppError(403, 'invalid_invitation', '邀请凭证无效或已失效。');
  }
  if (!input.adultAttested) {
    throw new AppError(
      403,
      'adult_attestation_required',
      '该研究入口仅面向已线下确认成年的受邀参与者。',
    );
  }
  if (!isOneOf(input.kind, ['question', 'material'] as const)) {
    throw new AppError(
      400,
      'invalid_intake_kind',
      '请选择问题线索或材料线索。',
    );
  }

  const participantRef = cleanPlainText(input.participantRef, 80);
  if (!/^[A-Za-z0-9_-]{6,80}$/u.test(participantRef)) {
    throw new AppError(
      400,
      'invalid_participant_ref',
      '请输入招募方提供的随机研究编号。',
    );
  }
  const contextScope = cleanPlainText(input.contextScope, 160);
  const body = input.body ? cleanPlainText(input.body, 1_500) : null;
  const sourceUrl = input.sourceUrl
    ? input.sourceUrl.trim().slice(0, 1_500)
    : null;
  const provenanceRole = input.provenanceRole
    ? cleanPlainText(input.provenanceRole, 40)
    : null;
  if (!contextScope)
    throw new AppError(400, 'missing_context', '请填写必要的适用背景。');
  if (input.kind === 'question' && (!body || body.length < 10)) {
    throw new AppError(400, 'missing_question', '问题线索至少需要 10 个字符。');
  }
  if (input.kind === 'material' && !body && !sourceUrl) {
    throw new AppError(
      400,
      'missing_material',
      '材料线索至少需要链接或简短说明。',
    );
  }
  const provenanceRoles = ['original_author', 'reteller', 'lead_only'] as const;
  if (provenanceRole && !isOneOf(provenanceRole, provenanceRoles)) {
    throw new AppError(400, 'invalid_provenance_role', '材料关系选项无效。');
  }
  if (input.kind === 'material' && !provenanceRole) {
    throw new AppError(
      400,
      'provenance_role_required',
      '材料线索需要说明你是原作者、转述者，还是仅提供线索。',
    );
  }
  if (sourceUrl && !isSafePublicUrl(sourceUrl)) {
    throw new AppError(
      400,
      'unsafe_source_url',
      '材料链接必须是公开的 http 或 https 地址。',
    );
  }
  if (
    containsLikelyPersonalData(
      `${contextScope} ${body ?? ''} ${sourceUrl ? decodeUrlForScreening(sourceUrl) : ''}`,
    )
  ) {
    throw new AppError(
      400,
      'personal_data_detected',
      '内容看起来包含邮箱、电话、学号或证件号，请删除后再提交。',
    );
  }

  const participantRefHash = await sha256(participantRef);
  const payload = {
    participantRefHash,
    kind: input.kind,
    contextScope,
    body,
    sourceUrl,
    provenanceRole,
  };
  const idempotency = await prepareIdempotency(
    `research:${participantRefHash.slice(0, 20)}`,
    '/v1/research-intakes',
    input.idempotencyKey,
    payload,
  );
  if (idempotency.existing) {
    return {
      data: idempotency.existing.response as {
        reference: string;
        expiresAt: string;
      },
      replayed: true,
    };
  }

  const id = crypto.randomUUID();
  const reference = `RI-${id.replaceAll('-', '').slice(0, 10).toLocaleUpperCase()}`;
  const now = nowSeconds();
  const expiresAt = now + 30 * 86_400;
  const response = {
    reference,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
  };
  const d1 = getD1();
  try {
    await d1.batch([
      d1
        .prepare(
          `INSERT INTO research_intakes
            (id, participant_ref_hash, kind, context_scope, body, source_url,
             provenance_role, status, submitted_at, expires_at, purged_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?, NULL)`,
        )
        .bind(
          reference,
          participantRefHash,
          input.kind,
          contextScope,
          body,
          sourceUrl,
          provenanceRole,
          now,
          expiresAt,
        ),
      d1
        .prepare(
          `INSERT INTO audit_events
            (id, actor_id, action, target_type, target_id, reason, request_id,
             metadata_json, created_at)
           VALUES (?, ?, 'research_intake.submit', 'research_intake', ?,
                   '受邀成年参与者提交私有选题线索', ?, NULL, ?)`,
        )
        .bind(
          `audit-${id}`,
          `research:${participantRefHash.slice(0, 20)}`,
          reference,
          id,
          now,
        ),
      idempotencyInsert(d1, idempotency, 201, response, now + 7 * 86_400),
    ]);
  } catch (error) {
    return resolveMutationRaceOrThrow(idempotency, error);
  }
  return { data: response, replayed: false };
}

export async function createAnswerCardDraft(input: {
  payload: unknown;
  actorId: string;
  idempotencyKey: string | null;
}): Promise<
  MutationResult<{ cardId: string; revisionId: string; lockVersion: 0 }>
> {
  await ensureDatabase();
  const draft = await validateNewCardInput(input.payload);
  const idempotency = await prepareIdempotency(
    input.actorId,
    '/v1/editor/answer-cards',
    input.idempotencyKey,
    draft,
  );
  if (idempotency.existing) {
    return {
      data: idempotency.existing.response as {
        cardId: string;
        revisionId: string;
        lockVersion: 0;
      },
      replayed: true,
    };
  }
  const existingSlug = await getD1()
    .prepare('SELECT id FROM answer_cards WHERE slug = ? LIMIT 1')
    .bind(draft.slug)
    .first<{ id: string }>();
  if (existingSlug)
    throw new AppError(409, 'slug_exists', '这个答案链接标识已被使用。');
  await validateTopicAndScopes(draft.topicId, draft.scopeMode, draft.scopeIds);

  const cardId = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  const response = { cardId, revisionId, lockVersion: 0 as const };
  const d1 = getD1();
  const now = nowSeconds();
  const statements: D1PreparedStatement[] = [
    d1
      .prepare(
        `INSERT INTO answer_cards
          (id, slug, topic_id, publication_status, risk_level,
           current_public_revision_id, lock_version, last_publish_operation_id, created_at)
         VALUES (?, ?, ?, 'unpublished', ?, NULL, 0, NULL, ?)`,
      )
      .bind(cardId, draft.slug, draft.topicId, draft.riskLevel, now),
  ];
  statements.push(
    ...(await buildRevisionStatements({
      d1,
      cardId,
      revisionId,
      versionNumber: 1,
      expectedCardVersion: 0,
      parentRevisionId: null,
      draft,
      actorId: input.actorId,
      now,
    })),
    d1
      .prepare(
        `INSERT INTO audit_events
          (id, actor_id, action, target_type, target_id, reason, request_id,
           metadata_json, created_at)
         VALUES (?, ?, 'answer_card.create_draft', 'answer_card', ?,
                 '创建答案卡及首个不可变草稿版本', ?, ?, ?)`,
      )
      .bind(
        `audit-${crypto.randomUUID()}`,
        input.actorId,
        cardId,
        crypto.randomUUID(),
        JSON.stringify({ revisionId }),
        now,
      ),
    idempotencyInsert(d1, idempotency, 201, response, now + 7 * 86_400),
  );

  try {
    await d1.batch(statements);
  } catch (error) {
    return resolveMutationRaceOrThrow(
      idempotency,
      translateDatabaseError(error),
    );
  }
  return { data: response, replayed: false };
}

export async function createAnswerCardRevision(input: {
  cardId: string;
  expectedCardVersion: number;
  payload: unknown;
  actorId: string;
  idempotencyKey: string | null;
}): Promise<
  MutationResult<{ cardId: string; revisionId: string; lockVersion: number }>
> {
  await ensureDatabase();
  const draft = await validateRevisionDraftInput(input.payload);
  const idempotency = await prepareIdempotency(
    input.actorId,
    `/v1/editor/answer-cards/${input.cardId}/revisions`,
    input.idempotencyKey,
    { expectedCardVersion: input.expectedCardVersion, draft },
  );
  if (idempotency.existing) {
    return {
      data: idempotency.existing.response as {
        cardId: string;
        revisionId: string;
        lockVersion: number;
      },
      replayed: true,
    };
  }
  const card = await getD1()
    .prepare(
      `SELECT id, topic_id, risk_level, current_public_revision_id, lock_version,
              (SELECT COALESCE(MAX(version_number), 0)
               FROM answer_card_revisions r WHERE r.card_id = answer_cards.id) AS max_version
       FROM answer_cards WHERE id = ? LIMIT 1`,
    )
    .bind(input.cardId)
    .first<{
      id: string;
      topic_id: string;
      risk_level: 'low' | 'high';
      current_public_revision_id: string | null;
      lock_version: number;
      max_version: number;
    }>();
  if (!card) throw new AppError(404, 'card_not_found', '找不到这张答案卡。');
  if (Number(card.lock_version) !== input.expectedCardVersion) {
    throw new AppError(
      412,
      'stale_card_version',
      '答案卡已被其他编辑更新，请刷新后重试.',
      {
        currentVersion: Number(card.lock_version),
      },
    );
  }
  if (
    card.risk_level === 'high' &&
    draft.sentences.some((item) => item.citation.kind === 'link')
  ) {
    throw new AppError(
      422,
      'high_risk_requires_evidence',
      '高影响答案的每个事实句都必须使用可定位证据。',
    );
  }
  await validateTopicAndScopes(card.topic_id, draft.scopeMode, draft.scopeIds);

  const revisionId = crypto.randomUUID();
  const response = {
    cardId: card.id,
    revisionId,
    lockVersion: Number(card.lock_version),
  };
  const d1 = getD1();
  const now = nowSeconds();
  const statements = await buildRevisionStatements({
    d1,
    cardId: card.id,
    revisionId,
    versionNumber: Number(card.max_version) + 1,
    expectedCardVersion: Number(card.lock_version),
    parentRevisionId: card.current_public_revision_id,
    draft,
    actorId: input.actorId,
    now,
  });
  statements.push(
    d1
      .prepare(
        `INSERT INTO audit_events
          (id, actor_id, action, target_type, target_id, reason, request_id,
           metadata_json, created_at)
         VALUES (?, ?, 'answer_card.create_revision', 'answer_card_revision', ?,
                 '创建不可变答案卡修订草稿', ?, ?, ?)`,
      )
      .bind(
        `audit-${crypto.randomUUID()}`,
        input.actorId,
        revisionId,
        crypto.randomUUID(),
        JSON.stringify({
          cardId: card.id,
          parentRevisionId: card.current_public_revision_id,
        }),
        now,
      ),
    idempotencyInsert(d1, idempotency, 201, response, now + 7 * 86_400),
  );
  try {
    await d1.batch(statements);
  } catch (error) {
    return resolveMutationRaceOrThrow(
      idempotency,
      translateDatabaseError(error),
    );
  }
  return { data: response, replayed: false };
}

export async function publishAnswerCardRevision(input: {
  revisionId: string;
  expectedCardVersion: number;
  reviewerId: string;
  reason: string;
  idempotencyKey: string | null;
}): Promise<
  MutationResult<{ cardId: string; revisionId: string; lockVersion: number }>
> {
  await ensureDatabase();
  const reason = cleanPlainText(input.reason, 400);
  if (reason.length < 8) {
    throw new AppError(
      400,
      'review_reason_required',
      '发布审核理由至少需要 8 个字符。',
    );
  }
  const payload = {
    revisionId: input.revisionId,
    expectedCardVersion: input.expectedCardVersion,
    reason,
  };
  const route = `/v1/editor/answer-card-revisions/${input.revisionId}/publish`;
  const idempotency = await prepareIdempotency(
    input.reviewerId,
    route,
    input.idempotencyKey,
    payload,
  );
  if (idempotency.existing) {
    return {
      data: idempotency.existing.response as {
        cardId: string;
        revisionId: string;
        lockVersion: number;
      },
      replayed: true,
    };
  }
  const row = await getD1()
    .prepare(
      `SELECT r.card_id, r.generation_type, c.lock_version,
              c.current_public_revision_id
       FROM answer_card_revisions r
       JOIN answer_cards c ON c.id = r.card_id
       WHERE r.id = ? LIMIT 1`,
    )
    .bind(input.revisionId)
    .first<{
      card_id: string;
      generation_type: 'human' | 'ai_draft';
      lock_version: number;
      current_public_revision_id: string | null;
    }>();
  if (!row)
    throw new AppError(404, 'revision_not_found', '找不到这个修订版本。');
  if (row.generation_type === 'ai_draft') {
    throw new AppError(
      422,
      'ai_draft_cannot_publish',
      'AI 草稿必须先由人工创建正式修订，不能直接发布。',
    );
  }
  if (row.current_public_revision_id === input.revisionId) {
    throw new AppError(
      409,
      'already_published',
      '这个修订已经是当前公开版本。',
    );
  }
  if (Number(row.lock_version) !== input.expectedCardVersion) {
    throw new AppError(
      412,
      'stale_card_version',
      '答案卡已更新，请刷新审核页后重试。',
      {
        currentVersion: Number(row.lock_version),
      },
    );
  }

  const operationId = crypto.randomUUID();
  const requestId = crypto.randomUUID();
  const now = nowSeconds();
  const response = {
    cardId: row.card_id,
    revisionId: input.revisionId,
    lockVersion: input.expectedCardVersion + 1,
  };
  const d1 = getD1();
  try {
    await d1.batch([
      d1
        .prepare(
          `INSERT INTO publish_operations
            (id, card_id, revision_id, expected_card_version, reviewer_id,
             reason, request_id, created_at, applied_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        )
        .bind(
          operationId,
          row.card_id,
          input.revisionId,
          input.expectedCardVersion,
          input.reviewerId,
          reason,
          requestId,
          now,
        ),
      d1
        .prepare(
          `UPDATE answer_cards
           SET publication_status = 'published', current_public_revision_id = ?,
               lock_version = lock_version + 1, last_publish_operation_id = ?
           WHERE id = ?`,
        )
        .bind(input.revisionId, operationId, row.card_id),
      idempotencyInsert(d1, idempotency, 200, response, now + 7 * 86_400),
    ]);
  } catch (error) {
    return resolveMutationRaceOrThrow(
      idempotency,
      translateDatabaseError(error),
    );
  }
  return { data: response, replayed: false };
}

export async function setAnswerCardVisibility(input: {
  cardId: string;
  status: 'hidden' | 'published';
  reason: string;
  expectedCardVersion: number;
  actorId: string;
  idempotencyKey: string | null;
}): Promise<
  MutationResult<{ cardId: string; status: string; lockVersion: number }>
> {
  await ensureDatabase();
  const cardId = cleanPlainText(input.cardId, 100);
  const reason = cleanPlainText(input.reason, 400);
  if (reason.length < 8) {
    throw new AppError(
      400,
      'visibility_reason_required',
      '隐藏或恢复理由至少需要 8 个字符。',
    );
  }
  const payload = {
    status: input.status,
    reason,
    expectedCardVersion: input.expectedCardVersion,
  };
  const route = `/v1/editor/answer-cards/${cardId}/visibility`;
  const idempotency = await prepareIdempotency(
    input.actorId,
    route,
    input.idempotencyKey,
    payload,
  );
  if (idempotency.existing) {
    return {
      data: idempotency.existing.response as {
        cardId: string;
        status: string;
        lockVersion: number;
      },
      replayed: true,
    };
  }

  const card = await getD1()
    .prepare(
      `SELECT id, publication_status, current_public_revision_id, lock_version
       FROM answer_cards WHERE id = ? LIMIT 1`,
    )
    .bind(cardId)
    .first<{
      id: string;
      publication_status: string;
      current_public_revision_id: string | null;
      lock_version: number;
    }>();
  if (!card) throw new AppError(404, 'card_not_found', '找不到这张答案卡。');
  if (Number(card.lock_version) !== input.expectedCardVersion) {
    throw new AppError(
      412,
      'stale_card_version',
      '答案卡状态已更新，请刷新后重试。',
      {
        currentVersion: Number(card.lock_version),
      },
    );
  }
  if (card.publication_status === input.status) {
    throw new AppError(409, 'visibility_unchanged', '答案卡已经处于该状态。');
  }
  if (
    !(
      (card.publication_status === 'published' && input.status === 'hidden') ||
      (card.publication_status === 'hidden' && input.status === 'published')
    ) ||
    !card.current_public_revision_id
  ) {
    throw new AppError(
      409,
      'invalid_visibility_transition',
      '当前答案卡状态不允许执行该操作。',
    );
  }

  const d1 = getD1();
  const operationId = crypto.randomUUID();
  const requestId = crypto.randomUUID();
  const now = nowSeconds();
  const response = {
    cardId,
    status: input.status,
    lockVersion: input.expectedCardVersion + 1,
  };
  try {
    await d1.batch([
      workflowOperationInsert(d1, {
        id: operationId,
        targetType: 'answer_card',
        targetId: cardId,
        expectedVersion: input.expectedCardVersion,
        targetStatus: input.status,
        actorId: input.actorId,
        reason,
        requestId,
        now,
      }),
      d1
        .prepare(
          `UPDATE answer_cards
           SET publication_status = ?, lock_version = lock_version + 1,
               last_workflow_operation_id = ?
           WHERE id = ?`,
        )
        .bind(input.status, operationId, cardId),
      idempotencyInsert(d1, idempotency, 200, response, now + 7 * 86_400),
    ]);
  } catch (error) {
    return resolveMutationRaceOrThrow(
      idempotency,
      translateDatabaseError(error),
    );
  }
  return { data: response, replayed: false };
}

export async function updateReport(input: {
  publicCode: string;
  status: 'reviewing' | 'resolved' | 'closed';
  publicResponse?: string | null;
  actorId: string;
  expectedVersion: number;
  idempotencyKey: string | null;
}): Promise<
  MutationResult<{ code: string; status: string; lockVersion: number }>
> {
  await ensureDatabase();
  const code = cleanPlainText(input.publicCode, 50).toLocaleUpperCase();
  const response = input.publicResponse
    ? cleanPlainText(input.publicResponse, 500)
    : null;
  const payload = {
    status: input.status,
    publicResponse: response,
    expectedVersion: input.expectedVersion,
  };
  const idempotency = await prepareIdempotency(
    input.actorId,
    `/v1/editor/reports/${code}`,
    input.idempotencyKey,
    payload,
  );
  if (idempotency.existing) {
    return {
      data: idempotency.existing.response as {
        code: string;
        status: string;
        lockVersion: number;
      },
      replayed: true,
    };
  }

  const report = await getD1()
    .prepare(
      `SELECT id, status, lock_version FROM reports
       WHERE public_code = ? LIMIT 1`,
    )
    .bind(code)
    .first<{ id: string; status: string; lock_version: number }>();
  if (!report) throw new AppError(404, 'report_not_found', '找不到该报告。');
  if (Number(report.lock_version) !== input.expectedVersion) {
    throw new AppError(
      412,
      'stale_report_version',
      '报告状态已更新，请刷新后重试。',
      {
        currentVersion: Number(report.lock_version),
      },
    );
  }

  const now = nowSeconds();
  const requestId = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  const resultValue = {
    code,
    status: input.status,
    lockVersion: input.expectedVersion + 1,
  };
  const d1 = getD1();
  try {
    await d1.batch([
      workflowOperationInsert(d1, {
        id: operationId,
        targetType: 'report',
        targetId: report.id,
        expectedVersion: input.expectedVersion,
        targetStatus: input.status,
        actorId: input.actorId,
        reason: '处理结构化问题报告',
        requestId,
        now,
      }),
      d1
        .prepare(
          `UPDATE reports
           SET status = ?, public_response = ?, resolved_at = ?,
               lock_version = lock_version + 1,
               last_workflow_operation_id = ?
           WHERE id = ?`,
        )
        .bind(
          input.status,
          response,
          input.status === 'resolved' || input.status === 'closed' ? now : null,
          operationId,
          report.id,
        ),
      idempotencyInsert(d1, idempotency, 200, resultValue, now + 7 * 86_400),
    ]);
  } catch (error) {
    return resolveMutationRaceOrThrow(
      idempotency,
      translateDatabaseError(error),
    );
  }
  return { data: resultValue, replayed: false };
}

export async function updateResearchIntake(input: {
  id: string;
  status: 'screening' | 'actioned' | 'rejected';
  actorId: string;
  expectedVersion: number;
  idempotencyKey: string | null;
}): Promise<
  MutationResult<{ id: string; status: string; lockVersion: number }>
> {
  await ensureDatabase();
  const id = cleanPlainText(input.id, 80);
  const payload = {
    status: input.status,
    expectedVersion: input.expectedVersion,
  };
  const idempotency = await prepareIdempotency(
    input.actorId,
    `/v1/editor/research-intakes/${id}`,
    input.idempotencyKey,
    payload,
  );
  if (idempotency.existing) {
    return {
      data: idempotency.existing.response as {
        id: string;
        status: string;
        lockVersion: number;
      },
      replayed: true,
    };
  }

  const intake = await getD1()
    .prepare(
      `SELECT id, status, lock_version, expires_at, purged_at
       FROM research_intakes WHERE id = ? LIMIT 1`,
    )
    .bind(id)
    .first<{
      id: string;
      status: string;
      lock_version: number;
      expires_at: number;
      purged_at: number | null;
    }>();
  if (!intake) {
    throw new AppError(404, 'intake_not_found', '找不到该私有线索。');
  }
  if (intake.purged_at !== null || Number(intake.expires_at) <= nowSeconds()) {
    throw new AppError(410, 'intake_expired', '该私有线索已到期并停止处理。');
  }
  if (Number(intake.lock_version) !== input.expectedVersion) {
    throw new AppError(
      412,
      'stale_intake_version',
      '线索状态已更新，请刷新后重试。',
      {
        currentVersion: Number(intake.lock_version),
      },
    );
  }

  const now = nowSeconds();
  const requestId = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  const resultValue = {
    id,
    status: input.status,
    lockVersion: input.expectedVersion + 1,
  };
  const d1 = getD1();
  try {
    await d1.batch([
      workflowOperationInsert(d1, {
        id: operationId,
        targetType: 'research_intake',
        targetId: id,
        expectedVersion: input.expectedVersion,
        targetStatus: input.status,
        actorId: input.actorId,
        reason: '处理私有研究线索',
        requestId,
        now,
      }),
      d1
        .prepare(
          `UPDATE research_intakes
           SET status = ?, lock_version = lock_version + 1,
               last_workflow_operation_id = ?
           WHERE id = ?`,
        )
        .bind(input.status, operationId, id),
      idempotencyInsert(d1, idempotency, 200, resultValue, now + 7 * 86_400),
    ]);
  } catch (error) {
    return resolveMutationRaceOrThrow(
      idempotency,
      translateDatabaseError(error),
    );
  }
  return { data: resultValue, replayed: false };
}

function workflowOperationInsert(
  d1: D1Database,
  input: {
    id: string;
    targetType: 'answer_card' | 'report' | 'research_intake';
    targetId: string;
    expectedVersion: number;
    targetStatus: string;
    actorId: string;
    reason: string;
    requestId: string;
    now: number;
  },
) {
  return d1
    .prepare(
      `INSERT INTO workflow_operations
        (id, target_type, target_id, expected_version, target_status,
         actor_id, reason, request_id, created_at, applied_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
    .bind(
      input.id,
      input.targetType,
      input.targetId,
      input.expectedVersion,
      input.targetStatus,
      input.actorId,
      input.reason,
      input.requestId,
      input.now,
    );
}

type ValidatedRevision = RevisionDraftInput & {
  title: string;
  summary: string;
  reviewOwnerLabel: string;
  evidenceNote: string | null;
  generationType: 'human' | 'ai_draft';
};

async function validateNewCardInput(
  value: unknown,
): Promise<NewCardInput & ValidatedRevision> {
  if (!value || typeof value !== 'object') {
    throw new AppError(400, 'invalid_payload', '请求内容不是有效对象。');
  }
  const raw = value as Record<string, unknown>;
  const revision = await validateRevisionDraftInput(value);
  const slug =
    typeof raw.slug === 'string' ? raw.slug.trim().toLocaleLowerCase() : '';
  const topicId =
    typeof raw.topicId === 'string' ? cleanPlainText(raw.topicId, 100) : '';
  const riskLevel = raw.riskLevel === 'high' ? 'high' : 'low';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug) || slug.length > 100) {
    throw new AppError(
      400,
      'invalid_slug',
      '链接标识只能使用小写字母、数字和连字符。',
    );
  }
  if (!topicId) throw new AppError(400, 'missing_topic', '请选择话题。');
  if (riskLevel === 'high') {
    throw new AppError(
      422,
      'high_risk_publishing_disabled',
      '高影响答案在领域审核与来源权威校验上线前保持禁用。',
    );
  }
  return { ...revision, slug, topicId, riskLevel };
}

async function validateRevisionDraftInput(
  value: unknown,
): Promise<ValidatedRevision> {
  if (!value || typeof value !== 'object') {
    throw new AppError(400, 'invalid_payload', '请求内容不是有效对象。');
  }
  const raw = value as Record<string, unknown>;
  const title =
    typeof raw.title === 'string' ? cleanPlainText(raw.title, 120) : '';
  const summary =
    typeof raw.summary === 'string' ? cleanPlainText(raw.summary, 360) : '';
  const reviewOwnerLabel =
    typeof raw.reviewOwnerLabel === 'string'
      ? cleanPlainText(raw.reviewOwnerLabel, 80)
      : '';
  const evidenceNote =
    typeof raw.evidenceNote === 'string'
      ? cleanPlainText(raw.evidenceNote, 500) || null
      : null;
  const scopeMode = isOneOf(raw.scopeMode, SCOPE_MODES) ? raw.scopeMode : null;
  const disputeStatus = isOneOf(raw.disputeStatus, DISPUTE_STATUSES)
    ? raw.disputeStatus
    : 'none';
  const asOf = typeof raw.asOf === 'string' ? raw.asOf : '';
  const reviewDueOn =
    typeof raw.reviewDueOn === 'string' ? raw.reviewDueOn : '';
  const generationType =
    raw.generationType === 'ai_draft' ? 'ai_draft' : 'human';
  const scopeIds = Array.isArray(raw.scopeIds)
    ? [
        ...new Set(
          raw.scopeIds.filter(
            (item): item is string => typeof item === 'string',
          ),
        ),
      ].slice(0, 20)
    : [];

  if (title.length < 6)
    throw new AppError(400, 'title_too_short', '标题至少需要 6 个字符。');
  if (summary.length < 12)
    throw new AppError(400, 'summary_too_short', '简答至少需要 12 个字符。');
  if (!scopeMode)
    throw new AppError(400, 'invalid_scope_mode', '请选择适用范围模式。');
  if (scopeMode === 'constrained' && scopeIds.length === 0) {
    throw new AppError(400, 'scope_required', '受限范围至少需要选择一个范围。');
  }
  if (scopeMode !== 'constrained' && scopeIds.length > 0) {
    throw new AppError(
      400,
      'scope_mode_mismatch',
      '仅“受限范围”可以关联具体范围。',
    );
  }
  if (!isIsoDate(asOf))
    throw new AppError(400, 'invalid_as_of', '信息截至日期无效。');
  if (!isIsoDate(reviewDueOn)) {
    throw new AppError(400, 'invalid_review_due', '复核期限无效。');
  }
  if (dateToEpochEndOfDay(reviewDueOn) <= nowSeconds()) {
    throw new AppError(400, 'review_due_in_past', '复核期限必须晚于当前时间。');
  }
  if (!reviewOwnerLabel) {
    throw new AppError(
      400,
      'missing_review_owner',
      '请填写公开显示的复核负责人角色。',
    );
  }
  if (
    !Array.isArray(raw.sentences) ||
    raw.sentences.length < 1 ||
    raw.sentences.length > 8
  ) {
    throw new AppError(400, 'invalid_sentences', '每个修订需要 1–8 个事实句。');
  }

  const sentences = await Promise.all(
    raw.sentences.map(async (item, index) => {
      if (!item || typeof item !== 'object') {
        throw new AppError(
          400,
          'invalid_sentence',
          `第 ${index + 1} 个事实句无效。`,
        );
      }
      const sentenceRaw = item as Record<string, unknown>;
      const text =
        typeof sentenceRaw.text === 'string'
          ? cleanPlainText(sentenceRaw.text, 500)
          : '';
      if (text.length < 8) {
        throw new AppError(
          400,
          'sentence_too_short',
          `第 ${index + 1} 个事实句至少需要 8 个字符。`,
        );
      }
      const citation = await validateCitation(sentenceRaw.citation, index);
      return { text, citation };
    }),
  );

  return {
    title,
    summary,
    scopeMode,
    scopeIds,
    asOf,
    reviewDueOn,
    reviewOwnerLabel,
    disputeStatus,
    evidenceNote,
    generationType,
    sentences,
  };
}

async function validateCitation(
  value: unknown,
  index: number,
): Promise<CitationDraftInput> {
  if (!value || typeof value !== 'object') {
    throw new AppError(
      400,
      'missing_citation',
      `第 ${index + 1} 个事实句缺少来源。`,
    );
  }
  const raw = value as Record<string, unknown>;
  const kind =
    raw.kind === 'evidence' ? 'evidence' : raw.kind === 'link' ? 'link' : null;
  const sourceTitle =
    typeof raw.sourceTitle === 'string'
      ? cleanPlainText(raw.sourceTitle, 200)
      : '';
  const sourceUrl =
    typeof raw.sourceUrl === 'string'
      ? raw.sourceUrl.trim().slice(0, 1_500)
      : '';
  const publisherName =
    typeof raw.publisherName === 'string'
      ? cleanPlainText(raw.publisherName, 160)
      : '';
  const publishedAt =
    typeof raw.publishedAt === 'string' && raw.publishedAt
      ? raw.publishedAt
      : null;
  if (!kind || !sourceTitle || !publisherName || !isSafePublicUrl(sourceUrl)) {
    throw new AppError(
      400,
      'invalid_citation',
      `第 ${index + 1} 个来源需要类型、标题、发布主体和安全的公开链接。`,
    );
  }
  if (publishedAt && !isIsoDate(publishedAt)) {
    throw new AppError(
      400,
      'invalid_source_date',
      `第 ${index + 1} 个来源发布日期无效。`,
    );
  }
  if (kind === 'evidence') {
    const quote =
      typeof raw.quote === 'string' ? cleanPlainText(raw.quote, 1_000) : '';
    const locator =
      typeof raw.locator === 'string' ? cleanPlainText(raw.locator, 200) : '';
    if (!raw.rightsConfirmed) {
      throw new AppError(
        422,
        'evidence_rights_unconfirmed',
        '保存证据片段前必须确认摘录权利。',
      );
    }
    if (quote.length < 8 || !locator) {
      throw new AppError(
        400,
        'invalid_evidence_span',
        '可定位证据需要摘录和定位说明。',
      );
    }
    return {
      kind,
      sourceTitle,
      sourceUrl: new URL(sourceUrl).toString(),
      publisherName,
      publishedAt,
      quote,
      locator,
      rightsConfirmed: true,
    };
  }
  return {
    kind,
    sourceTitle,
    sourceUrl: new URL(sourceUrl).toString(),
    publisherName,
    publishedAt,
    quote: null,
    locator: null,
    rightsConfirmed: false,
  };
}

async function validateTopicAndScopes(
  topicId: string,
  scopeMode: string,
  scopeIds: string[],
) {
  const d1 = getD1();
  const topic = await d1
    .prepare("SELECT id FROM topics WHERE id = ? AND status = 'active' LIMIT 1")
    .bind(topicId)
    .first<{ id: string }>();
  if (!topic)
    throw new AppError(400, 'invalid_topic', '所选话题不存在或已停用。');
  if (scopeMode !== 'constrained') return;
  const placeholders = scopeIds.map(() => '?').join(', ');
  const result = await d1
    .prepare(
      `SELECT COUNT(*) AS total FROM applicability_scopes WHERE id IN (${placeholders})`,
    )
    .bind(...scopeIds)
    .first<{ total: number }>();
  if (Number(result?.total ?? 0) !== scopeIds.length) {
    throw new AppError(400, 'invalid_scope', '一个或多个适用范围无效。');
  }
}

async function buildRevisionStatements(options: {
  d1: D1Database;
  cardId: string;
  revisionId: string;
  versionNumber: number;
  expectedCardVersion: number;
  parentRevisionId: string | null;
  draft: ValidatedRevision;
  actorId: string;
  now: number;
}): Promise<D1PreparedStatement[]> {
  const { d1, draft } = options;
  const coverage = computeEvidenceCoverage(
    draft.sentences.map((item) => item.citation.kind),
  );
  const searchText = normalizeSearchText(
    `${draft.title} ${draft.summary} ${draft.sentences.map((item) => item.text).join(' ')}`,
  );
  const statements: D1PreparedStatement[] = [
    d1
      .prepare(
        `INSERT INTO answer_card_revisions
          (id, card_id, parent_revision_id, version_number, expected_card_version,
           locale, title, summary, search_text, scope_mode, as_of, verified_at,
           review_due_at, review_owner_id, review_owner_label, generation_type,
           evidence_coverage, dispute_status, evidence_note, editor_id, created_at)
         VALUES (?, ?, ?, ?, ?, 'zh-CN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        options.revisionId,
        options.cardId,
        options.parentRevisionId,
        options.versionNumber,
        options.expectedCardVersion,
        draft.title,
        draft.summary,
        searchText,
        draft.scopeMode,
        draft.asOf,
        options.now,
        dateToEpochEndOfDay(draft.reviewDueOn),
        options.actorId,
        draft.reviewOwnerLabel,
        draft.generationType,
        coverage,
        draft.disputeStatus,
        draft.evidenceNote,
        options.actorId,
        options.now,
      ),
  ];

  for (const scopeId of draft.scopeIds) {
    statements.push(
      d1
        .prepare(
          `INSERT INTO answer_card_revision_scopes (card_revision_id, scope_id)
           VALUES (?, ?)`,
        )
        .bind(options.revisionId, scopeId),
    );
  }

  const sourceDescriptors: Awaited<
    ReturnType<typeof prepareSourceDescriptor>
  >[] = [];
  const artifactsByUrl = new Map<string, string>();
  for (const item of draft.sentences) {
    sourceDescriptors.push(
      await prepareSourceDescriptor(d1, item.citation, artifactsByUrl),
    );
  }
  for (let index = 0; index < draft.sentences.length; index += 1) {
    const item = draft.sentences[index];
    const source = sourceDescriptors[index];
    const sentenceKey = `s${index + 1}`;
    statements.push(
      d1
        .prepare(
          `INSERT INTO answer_card_revision_sentences
            (card_revision_id, sentence_key, ordinal, text, is_factual)
           VALUES (?, ?, ?, ?, 1)`,
        )
        .bind(options.revisionId, sentenceKey, index + 1, item.text),
      ...source.statements,
      source.kind === 'link'
        ? d1
            .prepare(
              `INSERT INTO answer_card_sentence_citations
                (card_revision_id, sentence_key, ordinal, evidence_span_id, link_citation_id)
               VALUES (?, ?, 1, NULL, ?)`,
            )
            .bind(options.revisionId, sentenceKey, source.citationId)
        : d1
            .prepare(
              `INSERT INTO answer_card_sentence_citations
                (card_revision_id, sentence_key, ordinal, evidence_span_id, link_citation_id)
               VALUES (?, ?, 1, ?, NULL)`,
            )
            .bind(options.revisionId, sentenceKey, source.citationId),
    );
  }
  return statements;
}

async function prepareSourceDescriptor(
  d1: D1Database,
  citation: CitationDraftInput,
  artifactsByUrl: Map<string, string>,
) {
  const urlHash = await sha256(citation.sourceUrl);
  const publisherHash = await sha256(
    normalizeSearchText(citation.publisherName),
  );
  const plannedArtifactId = artifactsByUrl.get(citation.sourceUrl);
  const existingArtifact = plannedArtifactId
    ? { id: plannedArtifactId }
    : await d1
        .prepare('SELECT id FROM artifacts WHERE canonical_url = ? LIMIT 1')
        .bind(citation.sourceUrl)
        .first<{ id: string }>();
  const publisherId = `publisher-${publisherHash.slice(0, 24)}`;
  const artifactId = existingArtifact?.id ?? `artifact-${urlHash.slice(0, 24)}`;
  artifactsByUrl.set(citation.sourceUrl, artifactId);
  const artifactRevisionId = crypto.randomUUID();
  const citationId = crypto.randomUUID();
  const now = nowSeconds();
  const publishedAt = citation.publishedAt
    ? Math.floor(Date.parse(`${citation.publishedAt}T00:00:00Z`) / 1000)
    : null;
  const statements: D1PreparedStatement[] = [];

  if (!existingArtifact) {
    statements.push(
      d1
        .prepare(
          `INSERT OR IGNORE INTO publishers
            (id, type, name_zh, name_en, canonical_url, verification_status, created_at)
           VALUES (?, 'organization', ?, NULL, ?, 'unverified', ?)`,
        )
        .bind(
          publisherId,
          citation.publisherName,
          new URL(citation.sourceUrl).origin,
          now,
        ),
      d1
        .prepare(
          `INSERT INTO artifacts
            (id, publisher_id, type, canonical_url, moderation_status, created_at)
           VALUES (?, ?, 'webpage', ?, 'approved', ?)`,
        )
        .bind(artifactId, publisherId, citation.sourceUrl, now),
    );
  }

  if (citation.kind === 'link') {
    statements.push(
      d1
        .prepare(
          `INSERT INTO artifact_revisions
            (id, artifact_id, published_at, captured_at, recorded_at, visibility,
             rights_mode, rights_expires_at, content_hash, archived_text)
           VALUES (?, ?, ?, ?, ?, 'public', 'link_only', NULL, NULL, NULL)`,
        )
        .bind(artifactRevisionId, artifactId, publishedAt, now, now),
      d1
        .prepare(
          `INSERT INTO link_citations
            (id, artifact_revision_id, url, title, published_at, accessed_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          citationId,
          artifactRevisionId,
          citation.sourceUrl,
          citation.sourceTitle,
          publishedAt,
          now,
          now,
        ),
    );
    return { kind: 'link' as const, citationId, statements };
  }

  const quote = citation.quote ?? '';
  const spanHash = await sha256(quote);
  statements.push(
    d1
      .prepare(
        `INSERT INTO artifact_revisions
          (id, artifact_id, published_at, captured_at, recorded_at, visibility,
           rights_mode, rights_expires_at, content_hash, archived_text)
         VALUES (?, ?, ?, ?, ?, 'public', 'quote_allowed', NULL, ?, ?)`,
      )
      .bind(
        artifactRevisionId,
        artifactId,
        publishedAt,
        now,
        now,
        spanHash,
        quote,
      ),
    d1
      .prepare(
        `INSERT INTO evidence_spans
          (id, artifact_revision_id, locator_kind, locator_value, quote, span_hash,
           visibility, created_at)
         VALUES (?, ?, 'editor_locator', ?, ?, ?, 'public', ?)`,
      )
      .bind(
        citationId,
        artifactRevisionId,
        citation.locator,
        quote,
        spanHash,
        now,
      ),
  );
  return { kind: 'evidence' as const, citationId, statements };
}

async function prepareIdempotency(
  actorScope: string,
  route: string,
  idempotencyKey: string | null,
  payload: unknown,
): Promise<IdempotencyContext> {
  const key = idempotencyKey?.trim() ?? '';
  if (key.length < 8 || key.length > 160) {
    throw new AppError(
      400,
      'idempotency_key_required',
      '写请求需要 8–160 字符的 Idempotency-Key。',
    );
  }
  const keyHash = await sha256(key);
  const requestHash = await sha256(JSON.stringify(payload));
  const now = nowSeconds();
  await getD1()
    .prepare(
      `DELETE FROM idempotency_records
       WHERE actor_scope = ? AND route = ? AND key_hash = ? AND expires_at <= ?`,
    )
    .bind(actorScope, route, keyHash, now)
    .run();
  const existing = await getD1()
    .prepare(
      `SELECT request_hash, status_code, response_json
       FROM idempotency_records
       WHERE actor_scope = ? AND route = ? AND key_hash = ?
         AND expires_at > ?
       LIMIT 1`,
    )
    .bind(actorScope, route, keyHash, now)
    .first<{
      request_hash: string;
      status_code: number;
      response_json: string;
    }>();
  if (existing && existing.request_hash !== requestHash) {
    throw new AppError(
      409,
      'idempotency_key_conflict',
      '同一幂等键已用于不同请求内容。',
    );
  }
  return {
    actorScope,
    route,
    keyHash,
    requestHash,
    existing: existing
      ? {
          statusCode: Number(existing.status_code),
          response: JSON.parse(existing.response_json),
        }
      : null,
  };
}

function idempotencyInsert(
  d1: D1Database,
  context: IdempotencyContext,
  statusCode: number,
  response: unknown,
  expiresAt: number,
) {
  return d1
    .prepare(
      `INSERT INTO idempotency_records
        (actor_scope, route, key_hash, request_hash, status_code, response_json,
         created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      context.actorScope,
      context.route,
      context.keyHash,
      context.requestHash,
      statusCode,
      JSON.stringify(response),
      nowSeconds(),
      expiresAt,
    );
}

async function resolveMutationRaceOrThrow<T>(
  context: IdempotencyContext,
  error: unknown,
): Promise<MutationResult<T>> {
  const existing = await getD1()
    .prepare(
      `SELECT request_hash, response_json
       FROM idempotency_records
       WHERE actor_scope = ? AND route = ? AND key_hash = ?
         AND expires_at > ? LIMIT 1`,
    )
    .bind(context.actorScope, context.route, context.keyHash, nowSeconds())
    .first<{ request_hash: string; response_json: string }>();
  if (existing) {
    if (existing.request_hash !== context.requestHash) {
      throw new AppError(
        409,
        'idempotency_key_conflict',
        '同一幂等键已用于不同请求内容。',
      );
    }
    return { data: JSON.parse(existing.response_json) as T, replayed: true };
  }
  throw error;
}

function translateDatabaseError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  const rules: Array<[string, AppError]> = [
    [
      'stale_card_version_or_invalid_parent',
      new AppError(412, 'stale_card_version', '答案卡已更新，请刷新后重试。'),
    ],
    [
      'missing_or_stale_publish_operation',
      new AppError(
        412,
        'stale_card_version',
        '发布目标已变化，请刷新审核页后重试。',
      ),
    ],
    [
      'factual_sentence_missing_citation',
      new AppError(
        422,
        'citation_coverage_incomplete',
        '每个事实句都必须至少有一个来源。',
      ),
    ],
    [
      'high_risk_revision_requires_exact_evidence',
      new AppError(
        422,
        'high_risk_requires_evidence',
        '高影响结论不能只由未归档外链支撑。',
      ),
    ],
    [
      'revision_not_publishable',
      new AppError(
        422,
        'revision_not_publishable',
        '修订类型、复核期限或版本状态不允许发布。',
      ),
    ],
    [
      'evidence_not_public_or_rights_expired',
      new AppError(
        422,
        'evidence_unavailable',
        '一个或多个证据片段不可公开或授权已到期。',
      ),
    ],
    [
      'missing_or_stale_answer_card_workflow',
      new AppError(
        412,
        'stale_card_version',
        '答案卡状态已更新，请刷新后重试。',
      ),
    ],
    [
      'missing_or_stale_report_workflow',
      new AppError(
        412,
        'stale_report_version',
        '报告状态已更新，请刷新后重试。',
      ),
    ],
    [
      'missing_or_stale_research_intake_workflow',
      new AppError(
        412,
        'stale_intake_version',
        '线索状态已更新，请刷新后重试。',
      ),
    ],
    [
      'invalid_report_status_transition',
      new AppError(
        409,
        'invalid_status_transition',
        '报告当前状态不允许该操作。',
      ),
    ],
    [
      'invalid_research_intake_status_transition',
      new AppError(
        409,
        'invalid_status_transition',
        '线索当前状态不允许该操作。',
      ),
    ],
    [
      'research_intake_expired',
      new AppError(410, 'intake_expired', '该私有线索已到期并停止处理。'),
    ],
    [
      'high_risk_publishing_disabled',
      new AppError(
        422,
        'high_risk_publishing_disabled',
        '高影响答案在领域审核与来源权威校验上线前保持禁用。',
      ),
    ],
  ];
  for (const [needle, mapped] of rules) {
    if (message.includes(needle)) return mapped;
  }
  return error instanceof Error ? error : new Error(message);
}

async function secretsEqual(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([
    sha256(left),
    sha256(right),
  ]);
  if (leftHash.length !== rightHash.length) return false;
  let difference = 0;
  for (let index = 0; index < leftHash.length; index += 1) {
    difference |= leftHash.charCodeAt(index) ^ rightHash.charCodeAt(index);
  }
  return difference === 0;
}

function decodeUrlForScreening(value: string): string {
  let decoded = value.replaceAll('+', ' ');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

export function errorResponse(error: unknown, requestId = crypto.randomUUID()) {
  const headers = new Headers({ 'Cache-Control': 'private, no-store' });
  if (error instanceof AppError) {
    if (
      error.status === 429 &&
      typeof error.details?.retryAfterSeconds === 'number'
    ) {
      headers.set('Retry-After', String(error.details.retryAfterSeconds));
    }
    return Response.json(
      {
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
        request_id: requestId,
      },
      { status: error.status, headers },
    );
  }
  console.error('request_failed', { requestId, error });
  return Response.json(
    {
      error: { code: 'internal_error', message: '服务器未能完成请求。' },
      request_id: requestId,
    },
    { status: 500, headers },
  );
}

export type { FeedbackOutcome, ReportType };
