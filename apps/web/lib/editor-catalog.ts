import { ensureDatabase } from '@/db/bootstrap';
import { getD1 } from '@/db';

import { cleanPlainText, isSafePublicUrl } from './domain';
import { AppError } from './errors';

export type CatalogTopic = {
  id: string;
  slug: string;
  titleZh: string;
  titleEn: string | null;
  description: string;
  status: 'active' | 'hidden';
  aliases: string[];
  cardCount: number;
};

export type CatalogScope = {
  id: string;
  dimension: string;
  code: string;
  labelZh: string;
  labelEn: string | null;
  sortOrder: number;
  status: 'active' | 'hidden';
  revisionCount: number;
};

export type CatalogPublisher = {
  id: string;
  type: string;
  nameZh: string;
  nameEn: string | null;
  canonicalUrl: string | null;
  verificationStatus: 'unverified' | 'platform_owned' | 'source_verified';
  artifactCount: number;
};

export type CatalogArtifact = {
  id: string;
  publisherName: string;
  type: string;
  canonicalUrl: string;
  status: 'approved' | 'under_review' | 'withdrawn' | 'unavailable';
  affectedPublishedCards: number;
  latestCapturedAt: number | null;
  rightsExpiresAt: number | null;
};

export async function getEditorCatalog() {
  await ensureDatabase();
  const d1 = getD1();
  const [topics, scopes, publishers, artifacts] = await Promise.all([
    d1
      .prepare(
        `SELECT t.id, t.slug, t.title_zh, t.title_en, t.description, t.status,
                GROUP_CONCAT(DISTINCT ta.normalized_alias) AS aliases,
                COUNT(DISTINCT c.id) AS card_count
         FROM topics t
         LEFT JOIN topic_aliases ta ON ta.topic_id = t.id
         LEFT JOIN answer_cards c ON c.topic_id = t.id
         GROUP BY t.id ORDER BY t.status ASC, t.title_zh ASC`,
      )
      .all<{
        id: string;
        slug: string;
        title_zh: string;
        title_en: string | null;
        description: string;
        status: 'active' | 'hidden';
        aliases: string | null;
        card_count: number;
      }>(),
    d1
      .prepare(
        `SELECT s.id, s.dimension, s.code, s.label_zh, s.label_en,
                s.sort_order, s.status,
                COUNT(rs.card_revision_id) AS revision_count
         FROM applicability_scopes s
         LEFT JOIN answer_card_revision_scopes rs ON rs.scope_id = s.id
         GROUP BY s.id
         ORDER BY s.status ASC, s.dimension ASC, s.sort_order ASC, s.label_zh ASC`,
      )
      .all<{
        id: string;
        dimension: string;
        code: string;
        label_zh: string;
        label_en: string | null;
        sort_order: number;
        status: 'active' | 'hidden';
        revision_count: number;
      }>(),
    d1
      .prepare(
        `SELECT p.id, p.type, p.name_zh, p.name_en, p.canonical_url,
                p.verification_status, COUNT(a.id) AS artifact_count
         FROM publishers p LEFT JOIN artifacts a ON a.publisher_id = p.id
         GROUP BY p.id
         ORDER BY p.verification_status DESC, p.name_zh ASC`,
      )
      .all<{
        id: string;
        type: string;
        name_zh: string;
        name_en: string | null;
        canonical_url: string | null;
        verification_status: CatalogPublisher['verificationStatus'];
        artifact_count: number;
      }>(),
    d1
      .prepare(
        `SELECT a.id, p.name_zh AS publisher_name, a.type, a.canonical_url,
                a.moderation_status,
                MAX(ar.captured_at) AS latest_captured_at,
                MIN(CASE WHEN ar.visibility = 'public' THEN ar.rights_expires_at END)
                  AS rights_expires_at,
                COUNT(DISTINCT CASE WHEN c.publication_status = 'published'
                                    THEN c.id END) AS affected_cards
         FROM artifacts a
         JOIN publishers p ON p.id = a.publisher_id
         LEFT JOIN artifact_revisions ar ON ar.artifact_id = a.id
         LEFT JOIN evidence_spans es ON es.artifact_revision_id = ar.id
         LEFT JOIN link_citations lc ON lc.artifact_revision_id = ar.id
         LEFT JOIN answer_card_sentence_citations sc
           ON sc.evidence_span_id = es.id OR sc.link_citation_id = lc.id
         LEFT JOIN answer_card_revisions cr ON cr.id = sc.card_revision_id
         LEFT JOIN answer_cards c
           ON c.current_public_revision_id = cr.id
         GROUP BY a.id
         ORDER BY CASE a.moderation_status
                    WHEN 'withdrawn' THEN 0 WHEN 'unavailable' THEN 1
                    WHEN 'under_review' THEN 2 ELSE 3 END,
                  p.name_zh ASC, a.canonical_url ASC`,
      )
      .all<{
        id: string;
        publisher_name: string;
        type: string;
        canonical_url: string;
        moderation_status: CatalogArtifact['status'];
        latest_captured_at: number | null;
        rights_expires_at: number | null;
        affected_cards: number;
      }>(),
  ]);
  return {
    topics: topics.results.map((row) => ({
      id: row.id,
      slug: row.slug,
      titleZh: row.title_zh,
      titleEn: row.title_en,
      description: row.description,
      status: row.status,
      aliases: row.aliases?.split(',').filter(Boolean) ?? [],
      cardCount: Number(row.card_count),
    })) satisfies CatalogTopic[],
    scopes: scopes.results.map((row) => ({
      id: row.id,
      dimension: row.dimension,
      code: row.code,
      labelZh: row.label_zh,
      labelEn: row.label_en,
      sortOrder: Number(row.sort_order),
      status: row.status,
      revisionCount: Number(row.revision_count),
    })) satisfies CatalogScope[],
    publishers: publishers.results.map((row) => ({
      id: row.id,
      type: row.type,
      nameZh: row.name_zh,
      nameEn: row.name_en,
      canonicalUrl: row.canonical_url,
      verificationStatus: row.verification_status,
      artifactCount: Number(row.artifact_count),
    })) satisfies CatalogPublisher[],
    artifacts: artifacts.results.map((row) => ({
      id: row.id,
      publisherName: row.publisher_name,
      type: row.type,
      canonicalUrl: row.canonical_url,
      status: row.moderation_status,
      affectedPublishedCards: Number(row.affected_cards),
      latestCapturedAt:
        row.latest_captured_at === null ? null : Number(row.latest_captured_at),
      rightsExpiresAt:
        row.rights_expires_at === null ? null : Number(row.rights_expires_at),
    })) satisfies CatalogArtifact[],
  };
}

export async function saveCatalogTopic(input: {
  id?: string;
  slug: string;
  titleZh: string;
  titleEn?: string | null;
  description: string;
  status: 'active' | 'hidden';
  aliases: string[];
  actorId: string;
  requestId: string;
}) {
  await ensureDatabase();
  const slug = input.slug.trim().toLocaleLowerCase('en-US');
  const titleZh = cleanPlainText(input.titleZh, 80);
  const titleEn = input.titleEn ? cleanPlainText(input.titleEn, 120) : null;
  const description = cleanPlainText(input.description, 360);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug) || !titleZh || !description) {
    throw new AppError(400, 'invalid_topic', '话题标识、名称或说明无效。');
  }
  const aliases = normalizeAliases(input.aliases);
  const id = input.id?.trim() || crypto.randomUUID();
  const now = nowSeconds();
  const d1 = getD1();
  const existing = await d1
    .prepare('SELECT id FROM topics WHERE id = ? LIMIT 1')
    .bind(id)
    .first<{ id: string }>();
  const statements: D1PreparedStatement[] = [];
  if (existing) {
    statements.push(
      d1
        .prepare(
          `UPDATE topics SET slug = ?, title_zh = ?, title_en = ?,
                 description = ?, status = ? WHERE id = ?`,
        )
        .bind(slug, titleZh, titleEn, description, input.status, id),
      d1.prepare('DELETE FROM topic_aliases WHERE topic_id = ?').bind(id),
    );
  } else {
    statements.push(
      d1
        .prepare(
          `INSERT INTO topics
            (id, slug, title_zh, title_en, description, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, slug, titleZh, titleEn, description, input.status, now),
    );
  }
  for (const alias of aliases) {
    statements.push(
      d1
        .prepare(
          `INSERT INTO topic_aliases (topic_id, language, normalized_alias)
           VALUES (?, ?, ?)`,
        )
        .bind(id, containsHan(alias) ? 'zh-CN' : 'en', alias),
    );
  }
  statements.push(
    auditInsert(d1, {
      actorId: input.actorId,
      action: existing ? 'catalog.topic.update' : 'catalog.topic.create',
      targetType: 'topic',
      targetId: id,
      reason: existing ? '更新话题与检索别名' : '创建话题与检索别名',
      requestId: input.requestId,
      metadata: { slug, status: input.status, aliases },
      now,
    }),
  );
  try {
    await d1.batch(statements);
  } catch (error) {
    if (String(error).includes('UNIQUE')) {
      throw new AppError(409, 'topic_conflict', '话题标识或别名发生冲突。');
    }
    throw error;
  }
  return { id };
}

export async function saveCatalogScope(input: {
  id?: string;
  dimension: string;
  code: string;
  labelZh: string;
  labelEn?: string | null;
  sortOrder: number;
  status: 'active' | 'hidden';
  actorId: string;
  requestId: string;
}) {
  await ensureDatabase();
  const dimension = slugPart(input.dimension);
  const code = slugPart(input.code);
  const labelZh = cleanPlainText(input.labelZh, 80);
  const labelEn = input.labelEn ? cleanPlainText(input.labelEn, 120) : null;
  const sortOrder = Number.isInteger(input.sortOrder)
    ? Math.min(Math.max(input.sortOrder, -10_000), 10_000)
    : 0;
  if (!dimension || !code || !labelZh) {
    throw new AppError(400, 'invalid_scope', '范围维度、代码或名称无效。');
  }
  const id = input.id?.trim() || crypto.randomUUID();
  const now = nowSeconds();
  const d1 = getD1();
  const existing = await d1
    .prepare('SELECT id FROM applicability_scopes WHERE id = ? LIMIT 1')
    .bind(id)
    .first<{ id: string }>();
  try {
    await d1.batch([
      existing
        ? d1
            .prepare(
              `UPDATE applicability_scopes
               SET dimension = ?, code = ?, label_zh = ?, label_en = ?,
                   sort_order = ?, status = ? WHERE id = ?`,
            )
            .bind(
              dimension,
              code,
              labelZh,
              labelEn,
              sortOrder,
              input.status,
              id,
            )
        : d1
            .prepare(
              `INSERT INTO applicability_scopes
                (id, dimension, code, label_zh, label_en, sort_order, status)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              id,
              dimension,
              code,
              labelZh,
              labelEn,
              sortOrder,
              input.status,
            ),
      auditInsert(d1, {
        actorId: input.actorId,
        action: existing ? 'catalog.scope.update' : 'catalog.scope.create',
        targetType: 'applicability_scope',
        targetId: id,
        reason: existing ? '更新适用范围' : '创建适用范围',
        requestId: input.requestId,
        metadata: { dimension, code, status: input.status },
        now,
      }),
    ]);
  } catch (error) {
    if (String(error).includes('UNIQUE')) {
      throw new AppError(409, 'scope_conflict', '同一维度下的范围代码重复。');
    }
    throw error;
  }
  return { id };
}

export async function saveCatalogPublisher(input: {
  id?: string;
  type: string;
  nameZh: string;
  nameEn?: string | null;
  canonicalUrl?: string | null;
  verificationStatus: CatalogPublisher['verificationStatus'];
  actorId: string;
  requestId: string;
}) {
  await ensureDatabase();
  const type = slugPart(input.type);
  const nameZh = cleanPlainText(input.nameZh, 120);
  const nameEn = input.nameEn ? cleanPlainText(input.nameEn, 160) : null;
  const canonicalUrl = input.canonicalUrl?.trim() || null;
  if (!type || !nameZh || (canonicalUrl && !isSafePublicUrl(canonicalUrl))) {
    throw new AppError(400, 'invalid_publisher', '发布主体资料无效。');
  }
  if (
    !['unverified', 'platform_owned', 'source_verified'].includes(
      input.verificationStatus,
    )
  ) {
    throw new AppError(400, 'invalid_verification_status', '验证状态无效。');
  }
  const id = input.id?.trim() || crypto.randomUUID();
  const now = nowSeconds();
  const d1 = getD1();
  const existing = await d1
    .prepare('SELECT id FROM publishers WHERE id = ? LIMIT 1')
    .bind(id)
    .first<{ id: string }>();
  await d1.batch([
    existing
      ? d1
          .prepare(
            `UPDATE publishers SET type = ?, name_zh = ?, name_en = ?,
                    canonical_url = ?, verification_status = ? WHERE id = ?`,
          )
          .bind(
            type,
            nameZh,
            nameEn,
            canonicalUrl,
            input.verificationStatus,
            id,
          )
      : d1
          .prepare(
            `INSERT INTO publishers
              (id, type, name_zh, name_en, canonical_url,
               verification_status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            id,
            type,
            nameZh,
            nameEn,
            canonicalUrl,
            input.verificationStatus,
            now,
          ),
    auditInsert(d1, {
      actorId: input.actorId,
      action: existing
        ? 'catalog.publisher.update'
        : 'catalog.publisher.create',
      targetType: 'publisher',
      targetId: id,
      reason: existing ? '更新发布主体' : '创建发布主体',
      requestId: input.requestId,
      metadata: { type, verificationStatus: input.verificationStatus },
      now,
    }),
  ]);
  return { id };
}

export async function setArtifactDisposition(input: {
  artifactId: string;
  status: CatalogArtifact['status'];
  reason: string;
  actorId: string;
  requestId: string;
}) {
  await ensureDatabase();
  const statuses: CatalogArtifact['status'][] = [
    'approved',
    'under_review',
    'withdrawn',
    'unavailable',
  ];
  if (!statuses.includes(input.status)) {
    throw new AppError(400, 'invalid_artifact_status', '来源状态无效。');
  }
  const reason = cleanPlainText(input.reason, 400);
  if (reason.length < 8) {
    throw new AppError(
      400,
      'artifact_reason_required',
      '处置理由至少需要 8 个字符。',
    );
  }
  const d1 = getD1();
  const artifact = await d1
    .prepare('SELECT id, moderation_status FROM artifacts WHERE id = ? LIMIT 1')
    .bind(input.artifactId)
    .first<{ id: string; moderation_status: CatalogArtifact['status'] }>();
  if (!artifact)
    throw new AppError(404, 'artifact_not_found', '找不到该来源。');
  if (artifact.moderation_status === input.status) {
    throw new AppError(
      409,
      'artifact_status_unchanged',
      '来源已经处于该状态。',
    );
  }
  const affected =
    input.status === 'approved'
      ? { results: [] as Array<{ id: string; lock_version: number }> }
      : await d1
          .prepare(
            `SELECT DISTINCT c.id, c.lock_version
             FROM answer_cards c
             JOIN answer_card_sentence_citations sc
               ON sc.card_revision_id = c.current_public_revision_id
             LEFT JOIN evidence_spans es ON es.id = sc.evidence_span_id
             LEFT JOIN link_citations lc ON lc.id = sc.link_citation_id
             JOIN artifact_revisions ar
               ON ar.id = COALESCE(es.artifact_revision_id, lc.artifact_revision_id)
             WHERE ar.artifact_id = ? AND c.publication_status = 'published'`,
          )
          .bind(input.artifactId)
          .all<{ id: string; lock_version: number }>();
  const now = nowSeconds();
  const statements: D1PreparedStatement[] = [
    d1
      .prepare('UPDATE artifacts SET moderation_status = ? WHERE id = ?')
      .bind(input.status, input.artifactId),
    d1
      .prepare(
        `INSERT INTO artifact_disposition_events
          (id, artifact_id, previous_status, new_status, reason, actor_id,
           request_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        input.artifactId,
        artifact.moderation_status,
        input.status,
        reason,
        input.actorId,
        input.requestId,
        now,
      ),
    auditInsert(d1, {
      actorId: input.actorId,
      action: 'artifact.disposition',
      targetType: 'artifact',
      targetId: input.artifactId,
      reason,
      requestId: input.requestId,
      metadata: {
        previousStatus: artifact.moderation_status,
        newStatus: input.status,
        affectedCards: affected.results.length,
      },
      now,
    }),
  ];
  for (const card of affected.results) {
    const operationId = crypto.randomUUID();
    statements.push(
      d1
        .prepare(
          `INSERT INTO workflow_operations
            (id, target_type, target_id, expected_version, target_status,
             actor_id, reason, request_id, created_at, applied_at)
           VALUES (?, 'answer_card', ?, ?, 'hidden', ?, ?, ?, ?, NULL)`,
        )
        .bind(
          operationId,
          card.id,
          card.lock_version,
          input.actorId,
          `来源状态变为 ${input.status}：${reason}`,
          `${input.requestId}:${card.id}`,
          now,
        ),
      d1
        .prepare(
          `UPDATE answer_cards
           SET publication_status = 'hidden', lock_version = lock_version + 1,
               last_workflow_operation_id = ? WHERE id = ?`,
        )
        .bind(operationId, card.id),
    );
  }
  await d1.batch(statements);
  return { status: input.status, hiddenCards: affected.results.length };
}

function normalizeAliases(values: string[]) {
  const aliases = values
    .map((value) => cleanPlainText(value, 80).toLocaleLowerCase('en-US'))
    .filter(Boolean);
  return [...new Set(aliases)].slice(0, 30);
}

function slugPart(value: string) {
  const normalized = value.trim().toLocaleLowerCase('en-US');
  return /^[a-z0-9_]+(?:-[a-z0-9_]+)*$/u.test(normalized) ? normalized : '';
}

function containsHan(value: string) {
  return /\p{Script=Han}/u.test(value);
}

function auditInsert(
  d1: D1Database,
  input: {
    actorId: string;
    action: string;
    targetType: string;
    targetId: string;
    reason: string;
    requestId: string;
    metadata: Record<string, unknown>;
    now: number;
  },
) {
  return d1
    .prepare(
      `INSERT INTO audit_events
        (id, actor_id, action, target_type, target_id, reason, request_id,
         metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      `audit-${crypto.randomUUID()}`,
      input.actorId,
      input.action,
      input.targetType,
      input.targetId,
      input.reason,
      input.requestId,
      JSON.stringify(input.metadata),
      input.now,
    );
}

function nowSeconds() {
  return Math.floor(Date.now() / 1_000);
}
