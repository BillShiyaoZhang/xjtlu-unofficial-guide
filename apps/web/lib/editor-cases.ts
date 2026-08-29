import { ensureDatabase } from '@/db/bootstrap';
import { getD1, getRuntimeValue } from '@/db';

import { cleanPlainText, containsLikelyPersonalData } from './domain';
import { AppError } from './errors';
import { decryptPrivateIntakePayload } from './private-intake-crypto';

const PAGE_SIZE = 24;

export async function listEditorReports(input: {
  page: number;
  status?: string;
  actorId: string;
}) {
  await ensureDatabase();
  const page = safePage(input.page);
  const statuses = ['received', 'reviewing', 'resolved', 'closed'];
  const status = statuses.includes(input.status ?? '') ? input.status! : null;
  const d1 = getD1();
  const where = status ? 'WHERE r.status = ?' : '';
  const bindings = status ? [status] : [];
  const [rows, count] = await Promise.all([
    d1
      .prepare(
        `SELECT r.id, r.public_code, r.type, r.affected_area, r.priority,
                r.status, r.assignee_editor_id, r.sla_due_at, r.created_at,
                r.updated_at, r.lock_version, r.decision_code,
                cr.title AS card_title
         FROM reports r
         LEFT JOIN answer_cards c ON c.id = r.target_card_id
         LEFT JOIN answer_card_revisions cr ON cr.id = c.current_public_revision_id
         ${where}
         ORDER BY CASE r.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
                  CASE WHEN r.status IN ('received', 'reviewing') THEN 0 ELSE 1 END,
                  COALESCE(r.sla_due_at, r.created_at + 259200) ASC,
                  r.created_at DESC LIMIT ? OFFSET ?`,
      )
      .bind(...bindings, PAGE_SIZE, (page - 1) * PAGE_SIZE)
      .all<ReportListRow>(),
    d1
      .prepare(`SELECT COUNT(*) AS total FROM reports r ${where}`)
      .bind(...bindings)
      .first<{ total: number }>(),
    recordSensitiveRead(
      d1,
      input.actorId,
      'editor.reports.list',
      'report_queue',
      `page:${page}`,
    ),
  ]);
  const total = Number(count?.total ?? 0);
  return {
    items: rows.results.map(mapReportListRow),
    page,
    pageSize: PAGE_SIZE,
    total,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

export async function getEditorReport(code: string, actorId: string) {
  await ensureDatabase();
  const normalized = code.trim().toLocaleUpperCase('en-US');
  const d1 = getD1();
  const report = await d1
    .prepare(
      `SELECT r.id, r.public_code, r.type, r.affected_area, r.priority,
              r.status, r.assignee_editor_id, r.assigned_at, r.sla_due_at,
              r.public_response, r.decision_code, r.resolution_card_id,
              r.resolution_revision_id, r.created_at, r.reviewing_at,
              r.updated_at, r.resolved_at, r.lock_version,
              c.slug AS card_slug, cr.title AS card_title
       FROM reports r
       LEFT JOIN answer_cards c ON c.id = r.target_card_id
       LEFT JOIN answer_card_revisions cr ON cr.id = c.current_public_revision_id
       WHERE r.public_code = ? LIMIT 1`,
    )
    .bind(normalized)
    .first<ReportDetailRow>();
  if (!report) return null;
  const notes = await listCaseNotes('report', report.id);
  await recordSensitiveRead(
    d1,
    actorId,
    'editor.report.read',
    'report',
    report.id,
  );
  return { ...mapReportListRow(report), ...reportDetailFields(report), notes };
}

export async function listEditorIntakes(input: {
  page: number;
  status?: string;
  actorId: string;
}) {
  await ensureDatabase();
  const page = safePage(input.page);
  const statuses = [
    'submitted',
    'screening',
    'actioned',
    'rejected',
    'expired',
  ];
  const status = statuses.includes(input.status ?? '') ? input.status! : null;
  const d1 = getD1();
  const where = status ? 'WHERE i.status = ?' : '';
  const bindings = status ? [status] : [];
  const [rows, count] = await Promise.all([
    d1
      .prepare(
        `SELECT i.id, i.kind, i.context_scope, i.status,
                i.assignee_editor_id, i.submitted_at, i.expires_at,
                i.purged_at, i.lock_version, i.decision_code,
                i.linked_card_id, i.linked_revision_id
         FROM research_intakes i ${where}
         ORDER BY CASE WHEN i.status IN ('submitted', 'screening') THEN 0 ELSE 1 END,
                  i.expires_at ASC, i.submitted_at DESC LIMIT ? OFFSET ?`,
      )
      .bind(...bindings, PAGE_SIZE, (page - 1) * PAGE_SIZE)
      .all<IntakeListRow>(),
    d1
      .prepare(`SELECT COUNT(*) AS total FROM research_intakes i ${where}`)
      .bind(...bindings)
      .first<{ total: number }>(),
    recordSensitiveRead(
      d1,
      input.actorId,
      'editor.intakes.list',
      'research_intake_queue',
      `page:${page}`,
    ),
  ]);
  const total = Number(count?.total ?? 0);
  return {
    items: rows.results.map(mapIntakeListRow),
    page,
    pageSize: PAGE_SIZE,
    total,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

export async function getEditorIntake(id: string, actorId: string) {
  await ensureDatabase();
  const d1 = getD1();
  const intake = await d1
    .prepare(
      `SELECT i.id, i.kind, i.context_scope, i.body, i.source_url,
              i.provenance_role, i.payload_ciphertext, i.payload_key_version,
              i.status, i.assignee_editor_id,
              i.assigned_at, i.decision_code, i.outcome_reason,
              i.linked_card_id, i.linked_revision_id, i.actioned_at,
              i.submitted_at, i.expires_at, i.purged_at, i.lock_version,
              c.slug AS linked_card_slug, cr.title AS linked_revision_title
       FROM research_intakes i
       LEFT JOIN answer_cards c ON c.id = i.linked_card_id
       LEFT JOIN answer_card_revisions cr ON cr.id = i.linked_revision_id
       WHERE i.id = ? LIMIT 1`,
    )
    .bind(id.trim().slice(0, 80))
    .first<IntakeDetailRow>();
  if (!intake) return null;
  const notes = await listCaseNotes('research_intake', intake.id);
  await recordSensitiveRead(
    d1,
    actorId,
    'editor.research_intake.read',
    'research_intake',
    intake.id,
  );
  if (intake.payload_ciphertext && intake.payload_key_version !== 1) {
    throw new AppError(
      500,
      'private_intake_key_version_unsupported',
      '私有线索使用了当前运行环境不支持的密钥版本。',
    );
  }
  if (!intake.payload_ciphertext && intake.purged_at === null) {
    throw new AppError(
      503,
      'private_intake_encryption_migration_required',
      '这条私有线索尚未完成加密迁移，请先配置密钥并运行维护任务。',
    );
  }
  const payload = intake.payload_ciphertext
    ? await decryptPrivateIntakePayload(
        intake.id,
        intake.payload_ciphertext,
        getRuntimeValue('PRIVATE_INTAKE_KEY_V1'),
      )
    : {
        contextScope: intake.context_scope,
        body: intake.body,
        sourceUrl: intake.source_url,
        provenanceRole: intake.provenance_role,
      };
  return {
    ...mapIntakeListRow(intake),
    contextScope: payload.contextScope,
    body: payload.body,
    sourceUrl: payload.sourceUrl,
    provenanceRole: payload.provenanceRole,
    assignedAt: nullableNumber(intake.assigned_at),
    outcomeReason: intake.outcome_reason,
    actionedAt: nullableNumber(intake.actioned_at),
    linkedCardSlug: intake.linked_card_slug,
    linkedRevisionTitle: intake.linked_revision_title,
    notes,
  };
}

export async function addCaseNote(input: {
  targetType: 'report' | 'research_intake';
  targetId: string;
  body: string;
  actorId: string;
  requestId: string;
}) {
  await ensureDatabase();
  const body = cleanPlainText(input.body, 1_000);
  if (body.length < 4) {
    throw new AppError(
      400,
      'case_note_too_short',
      '内部记录至少需要 4 个字符。',
    );
  }
  if (containsLikelyPersonalData(body)) {
    throw new AppError(
      400,
      'case_note_personal_data',
      '内部记录看起来包含邮箱、电话、学号或证件号，请先删除。',
    );
  }
  const table = input.targetType === 'report' ? 'reports' : 'research_intakes';
  const target = await getD1()
    .prepare(`SELECT id FROM ${table} WHERE id = ? LIMIT 1`)
    .bind(input.targetId)
    .first<{ id: string }>();
  if (!target) throw new AppError(404, 'case_not_found', '找不到该处置记录。');
  const id = crypto.randomUUID();
  const now = nowSeconds();
  const d1 = getD1();
  await d1.batch([
    d1
      .prepare(
        `INSERT INTO case_notes
          (id, target_type, target_id, author_editor_id, body, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, input.targetType, input.targetId, input.actorId, body, now),
    d1
      .prepare(
        `INSERT INTO audit_events
          (id, actor_id, action, target_type, target_id, reason, request_id,
           metadata_json, created_at)
         VALUES (?, ?, 'case.note.add', ?, ?, '添加不含个人信息的内部处置记录',
                 ?, NULL, ?)`,
      )
      .bind(
        `audit-${id}`,
        input.actorId,
        input.targetType,
        input.targetId,
        input.requestId,
        now,
      ),
  ]);
  return { id, body, authorEditorId: input.actorId, createdAt: now };
}

type ReportListRow = {
  id: string;
  public_code: string;
  type: string;
  affected_area: string | null;
  priority: 'critical' | 'high' | 'standard';
  status: string;
  assignee_editor_id: string | null;
  sla_due_at: number | null;
  created_at: number;
  updated_at: number;
  lock_version: number;
  decision_code: string | null;
  card_title: string | null;
};

type ReportDetailRow = ReportListRow & {
  assigned_at: number | null;
  public_response: string | null;
  resolution_card_id: string | null;
  resolution_revision_id: string | null;
  reviewing_at: number | null;
  resolved_at: number | null;
  card_slug: string | null;
};

type IntakeListRow = {
  id: string;
  kind: string;
  context_scope: string;
  status: string;
  assignee_editor_id: string | null;
  submitted_at: number;
  expires_at: number;
  purged_at: number | null;
  lock_version: number;
  decision_code: string | null;
  linked_card_id: string | null;
  linked_revision_id: string | null;
};

type IntakeDetailRow = IntakeListRow & {
  body: string | null;
  source_url: string | null;
  provenance_role: string | null;
  payload_ciphertext: string | null;
  payload_key_version: number | null;
  assigned_at: number | null;
  outcome_reason: string | null;
  actioned_at: number | null;
  linked_card_slug: string | null;
  linked_revision_title: string | null;
};

function mapReportListRow(row: ReportListRow) {
  return {
    id: row.id,
    publicCode: row.public_code,
    type: row.type,
    affectedArea: row.affected_area,
    priority: row.priority,
    status: row.status,
    assigneeEditorId: row.assignee_editor_id,
    slaDueAt: nullableNumber(row.sla_due_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    lockVersion: Number(row.lock_version),
    decisionCode: row.decision_code,
    cardTitle: row.card_title,
  };
}

function reportDetailFields(row: ReportDetailRow) {
  return {
    assignedAt: nullableNumber(row.assigned_at),
    publicResponse: row.public_response,
    resolutionCardId: row.resolution_card_id,
    resolutionRevisionId: row.resolution_revision_id,
    reviewingAt: nullableNumber(row.reviewing_at),
    resolvedAt: nullableNumber(row.resolved_at),
    cardSlug: row.card_slug,
  };
}

function mapIntakeListRow(row: IntakeListRow) {
  return {
    id: row.id,
    kind: row.kind,
    contextScope:
      row.context_scope === '已按保留期限清理'
        ? row.context_scope
        : '受限载荷 · 打开详情后解密',
    status: row.status,
    assigneeEditorId: row.assignee_editor_id,
    submittedAt: Number(row.submitted_at),
    expiresAt: Number(row.expires_at),
    purgedAt: nullableNumber(row.purged_at),
    lockVersion: Number(row.lock_version),
    decisionCode: row.decision_code,
    linkedCardId: row.linked_card_id,
    linkedRevisionId: row.linked_revision_id,
  };
}

async function listCaseNotes(
  targetType: 'report' | 'research_intake',
  targetId: string,
) {
  const result = await getD1()
    .prepare(
      `SELECT id, author_editor_id, body, created_at FROM case_notes
       WHERE target_type = ? AND target_id = ? ORDER BY created_at DESC`,
    )
    .bind(targetType, targetId)
    .all<{
      id: string;
      author_editor_id: string;
      body: string;
      created_at: number;
    }>();
  return result.results.map((row) => ({
    id: row.id,
    authorEditorId: row.author_editor_id,
    body: row.body,
    createdAt: Number(row.created_at),
  }));
}

function recordSensitiveRead(
  d1: D1Database,
  actorId: string,
  action: string,
  targetType: string,
  targetId: string,
) {
  const id = crypto.randomUUID();
  return d1
    .prepare(
      `INSERT INTO audit_events
        (id, actor_id, action, target_type, target_id, reason, request_id,
         metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, '读取受限处置队列', ?, NULL, ?)`,
    )
    .bind(
      `audit-${id}`,
      actorId,
      action,
      targetType,
      targetId,
      id,
      nowSeconds(),
    )
    .run();
}

function nullableNumber(value: number | null) {
  return value === null ? null : Number(value);
}

function safePage(value: number) {
  return Math.max(
    1,
    Math.min(Number.isFinite(value) ? Math.trunc(value) : 1, 10_000),
  );
}

function nowSeconds() {
  return Math.floor(Date.now() / 1_000);
}
