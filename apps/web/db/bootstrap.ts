import migration0 from '@/drizzle/0000_flat_brood.sql?raw';
import migration1 from '@/drizzle/0001_stage1-invariants.sql?raw';
import migration2 from '@/drizzle/0002_breezy_cammi.sql?raw';

import { getD1, getRuntimeValue } from './index';

const migrations = [
  { id: '0000_flat_brood', sql: migration0 },
  { id: '0001_stage1_invariants', sql: migration1 },
  { id: '0002_workflow_operations', sql: migration2 },
] as const;

let bootstrapPromise: Promise<void> | undefined;
let maintenancePromise: Promise<void> | undefined;
let nextMaintenanceAt = 0;

function splitStatements(migrationSql: string): string[] {
  return migrationSql
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

export async function ensureDatabase(): Promise<void> {
  bootstrapPromise ??= bootstrapDatabase().catch((error) => {
    bootstrapPromise = undefined;
    throw error;
  });
  await bootstrapPromise;
  await runDatabaseMaintenance(false);
}

export async function runDatabaseMaintenance(force = true): Promise<void> {
  const nowMs = Date.now();
  if (!force && nowMs < nextMaintenanceAt) return;
  maintenancePromise ??= performDatabaseMaintenance()
    .then(() => {
      nextMaintenanceAt = Date.now() + 60_000;
    })
    .finally(() => {
      maintenancePromise = undefined;
    });
  await maintenancePromise;
}

async function bootstrapDatabase() {
  const d1 = getD1();
  await d1
    .prepare(
      `CREATE TABLE IF NOT EXISTS __app_migrations (
        id TEXT PRIMARY KEY NOT NULL,
        applied_at INTEGER NOT NULL
      )`,
    )
    .run();

  for (const migration of migrations) {
    const applied = await d1
      .prepare('SELECT id FROM __app_migrations WHERE id = ? LIMIT 1')
      .bind(migration.id)
      .first<{ id: string }>();
    if (applied) continue;

    const statements = splitStatements(migration.sql).map((statement) =>
      d1.prepare(statement),
    );
    statements.push(
      d1
        .prepare('INSERT INTO __app_migrations (id, applied_at) VALUES (?, ?)')
        .bind(migration.id, Math.floor(Date.now() / 1000)),
    );
    try {
      await d1.batch(statements);
    } catch (error) {
      const concurrentlyApplied = await d1
        .prepare('SELECT id FROM __app_migrations WHERE id = ? LIMIT 1')
        .bind(migration.id)
        .first<{ id: string }>();
      if (!concurrentlyApplied) throw error;
    }
  }

  await d1
    .prepare(
      `CREATE TABLE IF NOT EXISTS __app_seed_markers (
        id TEXT PRIMARY KEY NOT NULL,
        applied_at INTEGER NOT NULL
      )`,
    )
    .run();

  const seedMarker = await d1
    .prepare('SELECT id FROM __app_seed_markers WHERE id = ? LIMIT 1')
    .bind('stage1-demo-v1')
    .first<{ id: string }>();
  if (!seedMarker && getRuntimeValue('SEED_DEMO_CONTENT') === 'true') {
    try {
      await seedStageOneDemo(d1);
    } catch (error) {
      const concurrentlySeeded = await d1
        .prepare('SELECT id FROM __app_seed_markers WHERE id = ? LIMIT 1')
        .bind('stage1-demo-v1')
        .first<{ id: string }>();
      if (!concurrentlySeeded) throw error;
    }
  }
}

async function performDatabaseMaintenance() {
  const d1 = getD1();
  const now = Math.floor(Date.now() / 1000);
  const requestId = crypto.randomUUID();
  await d1.batch([
    d1
      .prepare(
        `UPDATE research_intakes
         SET participant_ref_hash = 'purged', context_scope = '已按保留期限清理',
             body = NULL, source_url = NULL, provenance_role = NULL,
             status = 'expired', purged_at = ?
         WHERE expires_at <= ? AND purged_at IS NULL`,
      )
      .bind(now, now),
    d1
      .prepare(
        `INSERT INTO audit_events
          (id, actor_id, action, target_type, target_id, reason, request_id,
           metadata_json, created_at)
         SELECT ?, 'system:retention', 'research_intake.purge_expired',
                'research_intake_batch', ?, '按 30 天保留期限清理私有线索载荷',
                ?, json_object('purgedCount', changes()), ?
         WHERE changes() > 0`,
      )
      .bind(`audit-${requestId}`, `purge-${now}`, requestId, now),
    d1
      .prepare('DELETE FROM idempotency_records WHERE expires_at <= ?')
      .bind(now),
  ]);
}

type Prepared = D1PreparedStatement;

function insert(d1: D1Database, sql: string, values: unknown[]): Prepared {
  return d1.prepare(sql).bind(...values);
}

async function seedStageOneDemo(d1: D1Database) {
  const now = Math.floor(Date.parse('2026-08-29T00:00:00Z') / 1000);
  const reviewDue = Math.floor(Date.parse('2026-11-30T00:00:00Z') / 1000);
  const statements: Prepared[] = [];

  const topics = [
    {
      id: 'topic-systems',
      slug: 'accounts-and-systems',
      titleZh: '账号与系统',
      titleEn: 'Accounts & systems',
      description: '查找登录入口、平台说明和操作帮助。',
      aliases: ['账号', '系统', '登录', 'e-bridge', 'learning mall'],
    },
    {
      id: 'topic-arrival',
      slug: 'arrival',
      titleZh: '到校准备',
      titleEn: 'Arrival',
      description: '集中核对新生到校前后常见事项与官方入口。',
      aliases: ['新生', '到校', '入学', '报到'],
    },
    {
      id: 'topic-services',
      slug: 'student-services',
      titleZh: '校园办事',
      titleEn: 'Student services',
      description: '从官方聚合页找到当前可用的学生服务入口。',
      aliases: ['办事', '服务', 'current students', '学生入口'],
    },
    {
      id: 'topic-method',
      slug: 'using-this-guide',
      titleZh: '使用本指南',
      titleEn: 'Using this guide',
      description: '理解来源、适用范围、核验时间和待复核标记。',
      aliases: ['来源', '核验', '待复核', '可信'],
    },
  ];

  for (const topic of topics) {
    statements.push(
      insert(
        d1,
        `INSERT INTO topics
          (id, slug, title_zh, title_en, description, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?)`,
        [
          topic.id,
          topic.slug,
          topic.titleZh,
          topic.titleEn,
          topic.description,
          now,
        ],
      ),
    );
    for (const alias of topic.aliases) {
      statements.push(
        insert(
          d1,
          `INSERT INTO topic_aliases (topic_id, language, normalized_alias)
           VALUES (?, ?, ?)`,
          [topic.id, /[\u3400-\u9fff]/u.test(alias) ? 'zh-CN' : 'en', alias],
        ),
      );
    }
  }

  const scopes = [
    [
      'scope-campus-suzhou',
      'campus',
      'suzhou',
      '苏州校区',
      'Suzhou campus',
      10,
    ],
    [
      'scope-audience-new',
      'audience',
      'new-student',
      '新生',
      'New students',
      10,
    ],
    [
      'scope-year-2026',
      'academic_year',
      '2026',
      '2026 入学届',
      '2026 intake',
      10,
    ],
  ];
  for (const scope of scopes) {
    statements.push(
      insert(
        d1,
        `INSERT INTO applicability_scopes
          (id, dimension, code, label_zh, label_en, sort_order)
         VALUES (?, ?, ?, ?, ?, ?)`,
        scope,
      ),
    );
  }

  statements.push(
    insert(
      d1,
      `INSERT INTO publishers
        (id, type, name_zh, name_en, canonical_url, verification_status, created_at)
       VALUES (?, 'university', ?, ?, ?, 'source_verified', ?)`,
      [
        'publisher-xjtlu',
        '西交利物浦大学',
        "Xi'an Jiaotong-Liverpool University",
        'https://www.xjtlu.edu.cn/',
        now,
      ],
    ),
    insert(
      d1,
      `INSERT INTO publishers
        (id, type, name_zh, name_en, canonical_url, verification_status, created_at)
       VALUES (?, 'platform', ?, ?, ?, 'platform_owned', ?)`,
      [
        'publisher-guide',
        '西浦非官方指南编辑组',
        'Unofficial Guide Editorial Team',
        '/about',
        now,
      ],
    ),
  );

  const externalSources = [
    {
      key: 'ebridge',
      url: 'https://www.xjtlu.edu.cn/en/it-services/e-bridge-eng',
      title: 'e-Bridge — XJTLU IT Services',
    },
    {
      key: 'current-students',
      url: 'https://www.xjtlu.edu.cn/zh/current-students',
      title: '在校学生 — 西交利物浦大学',
    },
    {
      key: 'learning-mall',
      url: 'https://knowledgebase.xjtlu.edu.cn/',
      title: 'Learning Mall Knowledge Base',
    },
  ];
  for (const source of externalSources) {
    statements.push(
      insert(
        d1,
        `INSERT INTO artifacts
          (id, publisher_id, type, canonical_url, moderation_status, created_at)
         VALUES (?, 'publisher-xjtlu', 'webpage', ?, 'approved', ?)`,
        [`artifact-${source.key}`, source.url, now],
      ),
      insert(
        d1,
        `INSERT INTO artifact_revisions
          (id, artifact_id, published_at, captured_at, recorded_at, visibility,
           rights_mode, rights_expires_at, content_hash, archived_text)
         VALUES (?, ?, NULL, ?, ?, 'public', 'link_only', NULL, NULL, NULL)`,
        [`artifact-revision-${source.key}`, `artifact-${source.key}`, now, now],
      ),
      insert(
        d1,
        `INSERT INTO link_citations
          (id, artifact_revision_id, url, title, published_at, accessed_at, created_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?)`,
        [
          `link-${source.key}`,
          `artifact-revision-${source.key}`,
          source.url,
          source.title,
          now,
          now,
        ],
      ),
    );
  }

  const policyText =
    '每张公开答案都必须标出适用范围、信息截至日期、人工核验时间、复核期限和来源。待复核内容会显示警示并在检索中降级。';
  statements.push(
    insert(
      d1,
      `INSERT INTO artifacts
        (id, publisher_id, type, canonical_url, moderation_status, created_at)
       VALUES ('artifact-method', 'publisher-guide', 'platform_policy', '/about#method', 'approved', ?)`,
      [now],
    ),
    insert(
      d1,
      `INSERT INTO artifact_revisions
        (id, artifact_id, published_at, captured_at, recorded_at, visibility,
         rights_mode, rights_expires_at, content_hash, archived_text)
       VALUES ('artifact-revision-method', 'artifact-method', ?, ?, ?, 'public',
               'snapshot_allowed', NULL, ?, ?)`,
      [now, now, now, 'sha256:platform-method-v1', policyText],
    ),
    insert(
      d1,
      `INSERT INTO evidence_spans
        (id, artifact_revision_id, locator_kind, locator_value, quote, span_hash,
         visibility, created_at)
       VALUES ('evidence-method', 'artifact-revision-method', 'section', 'method', ?,
               'sha256:platform-method-span-v1', 'public', ?)`,
      [policyText, now],
    ),
  );

  const cards = [
    {
      id: 'card-ebridge-entry',
      slug: 'where-to-check-e-bridge',
      topicId: 'topic-systems',
      title: '去哪里核对 e-Bridge 的登录与功能信息？',
      summary:
        '优先从学校 IT 服务说明页进入，并在原站核对当前登录地址与账号要求。',
      sentence:
        '学校 IT 服务中的 e-Bridge 说明页是核对该系统登录与功能信息的官方入口之一。',
      sourceType: 'link',
      sourceId: 'link-ebridge',
      keywords: 'e-bridge ebridge 登录 账号 教务 系统 portal',
      scopes: ['scope-campus-suzhou', 'scope-audience-new', 'scope-year-2026'],
    },
    {
      id: 'card-current-student-entry',
      slug: 'current-student-service-entry',
      topicId: 'topic-services',
      title: '从哪里开始找学生常用办事入口？',
      summary: '先查看学校“在校学生”聚合页，再进入具体服务并核对最新要求。',
      sentence: '学校“在校学生”页面集中提供多类学生服务与常用系统入口。',
      sourceType: 'link',
      sourceId: 'link-current-students',
      keywords: '在校学生 办事 服务 入口 current students portal',
      scopes: ['scope-campus-suzhou', 'scope-audience-new', 'scope-year-2026'],
    },
    {
      id: 'card-learning-mall-help',
      slug: 'learning-mall-help',
      topicId: 'topic-systems',
      title: '在哪里查 Learning Mall 的操作帮助？',
      summary:
        '到 Learning Mall Knowledge Base 查找当前的操作说明，并以原站页面为准。',
      sentence:
        'Learning Mall Knowledge Base 是查找 Learning Mall 操作说明的专门入口。',
      sourceType: 'link',
      sourceId: 'link-learning-mall',
      keywords: 'learning mall lm 知识库 knowledge base 教学平台 帮助',
      scopes: ['scope-campus-suzhou', 'scope-audience-new', 'scope-year-2026'],
    },
    {
      id: 'card-read-status',
      slug: 'how-to-read-answer-status',
      topicId: 'topic-method',
      title: '怎样判断一张答案卡是否仍适用？',
      summary:
        '一起查看适用范围、信息截至日期、人工核验时间、复核期限和来源类型。',
      sentence: policyText,
      sourceType: 'evidence',
      sourceId: 'evidence-method',
      keywords: '适用范围 截至日期 核验时间 复核期限 来源 待复核',
      scopes: [],
    },
  ] as const;

  for (const card of cards) {
    const revisionId = `revision-${card.id}-v1`;
    const operationId = `publish-${card.id}-v1`;
    const coverage =
      card.sourceType === 'link' ? 'linked_only' : 'fully_archived';
    const scopeMode = card.scopes.length > 0 ? 'constrained' : 'universal';
    statements.push(
      insert(
        d1,
        `INSERT INTO answer_cards
          (id, slug, topic_id, publication_status, risk_level,
           current_public_revision_id, lock_version, last_publish_operation_id, created_at)
         VALUES (?, ?, ?, 'unpublished', 'low', NULL, 0, NULL, ?)`,
        [card.id, card.slug, card.topicId, now],
      ),
      insert(
        d1,
        `INSERT INTO answer_card_revisions
          (id, card_id, parent_revision_id, version_number, expected_card_version,
           locale, title, summary, search_text, scope_mode, as_of, verified_at,
           review_due_at, review_owner_id, review_owner_label, generation_type,
           evidence_coverage, dispute_status, evidence_note, editor_id, created_at)
         VALUES (?, ?, NULL, 1, 0, 'zh-CN', ?, ?, ?, ?, '2026-08-29', ?, ?,
                 'seed-editorial-team', '内容编辑组', 'human', ?, 'none', ?,
                 'seed-editorial-team', ?)`,
        [
          revisionId,
          card.id,
          card.title,
          card.summary,
          `${card.title} ${card.summary} ${card.sentence} ${card.keywords}`.toLocaleLowerCase(),
          scopeMode,
          now,
          reviewDue,
          coverage,
          card.sourceType === 'link'
            ? '平台仅保存来源链接，未归档原文；请到原站核查。'
            : '本条引用平台自有方法说明中的可定位证据片段。',
          now,
        ],
      ),
      insert(
        d1,
        `INSERT INTO answer_card_revision_sentences
          (card_revision_id, sentence_key, ordinal, text, is_factual)
         VALUES (?, 's1', 1, ?, 1)`,
        [revisionId, card.sentence],
      ),
    );
    for (const scopeId of card.scopes) {
      statements.push(
        insert(
          d1,
          `INSERT INTO answer_card_revision_scopes (card_revision_id, scope_id)
           VALUES (?, ?)`,
          [revisionId, scopeId],
        ),
      );
    }
    statements.push(
      card.sourceType === 'link'
        ? insert(
            d1,
            `INSERT INTO answer_card_sentence_citations
              (card_revision_id, sentence_key, ordinal, evidence_span_id, link_citation_id)
             VALUES (?, 's1', 1, NULL, ?)`,
            [revisionId, card.sourceId],
          )
        : insert(
            d1,
            `INSERT INTO answer_card_sentence_citations
              (card_revision_id, sentence_key, ordinal, evidence_span_id, link_citation_id)
             VALUES (?, 's1', 1, ?, NULL)`,
            [revisionId, card.sourceId],
          ),
      insert(
        d1,
        `INSERT INTO publish_operations
          (id, card_id, revision_id, expected_card_version, reviewer_id, reason,
           request_id, created_at, applied_at)
         VALUES (?, ?, ?, 0, 'seed-editorial-team', '初始化阶段 1 演示答案', ?, ?, NULL)`,
        [operationId, card.id, revisionId, `seed-${card.id}-v1`, now],
      ),
      insert(
        d1,
        `UPDATE answer_cards
         SET publication_status = 'published', current_public_revision_id = ?,
             lock_version = 1, last_publish_operation_id = ?
         WHERE id = ? AND current_public_revision_id IS NULL AND lock_version = 0`,
        [revisionId, operationId, card.id],
      ),
    );
  }

  statements.push(
    insert(
      d1,
      'INSERT INTO __app_seed_markers (id, applied_at) VALUES (?, ?)',
      ['stage1-demo-v1', now],
    ),
  );

  await d1.batch(statements);
}
