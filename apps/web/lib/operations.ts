import { ensureDatabase } from '@/db/bootstrap';
import { getD1, getRuntimeValue } from '@/db';

import { sha256Hex } from './editor-crypto';
import { AppError } from './errors';

const EXPECTED_MIGRATION = '0014_private_intake_encryption';

export async function getSystemHealth() {
  await ensureDatabase();
  const now = nowSeconds();
  const row = await getD1()
    .prepare(
      `SELECT
         (SELECT id FROM __app_migrations ORDER BY applied_at DESC, id DESC LIMIT 1)
           AS migration_id,
         (SELECT COUNT(*) FROM research_intakes
          WHERE expires_at <= ? AND purged_at IS NULL) AS overdue_private,
         (SELECT COUNT(*) FROM research_intakes
          WHERE purged_at IS NULL AND payload_ciphertext IS NULL)
           AS unencrypted_private,
         (SELECT COUNT(DISTINCT c.id)
          FROM answer_cards c
          JOIN answer_card_sentence_citations sc
            ON sc.card_revision_id = c.current_public_revision_id
          LEFT JOIN evidence_spans es ON es.id = sc.evidence_span_id
          LEFT JOIN link_citations lc ON lc.id = sc.link_citation_id
          JOIN artifact_revisions ar
            ON ar.id = COALESCE(es.artifact_revision_id, lc.artifact_revision_id)
          JOIN artifacts a ON a.id = ar.artifact_id
          WHERE c.publication_status = 'published'
            AND (a.moderation_status != 'approved' OR ar.visibility != 'public'
                 OR (ar.rights_expires_at IS NOT NULL AND ar.rights_expires_at <= ?)))
           AS unsafe_public`,
    )
    .bind(now, now)
    .first<{
      migration_id: string | null;
      overdue_private: number;
      unencrypted_private: number;
      unsafe_public: number;
    }>();
  const healthy =
    row?.migration_id === EXPECTED_MIGRATION &&
    Number(row.overdue_private) === 0 &&
    Number(row.unencrypted_private) === 0 &&
    Number(row.unsafe_public) === 0;
  return {
    healthy,
    database: Boolean(row),
    migrationsCurrent: row?.migration_id === EXPECTED_MIGRATION,
    retentionCurrent: Number(row?.overdue_private ?? 1) === 0,
    privatePayloadEncryption: Number(row?.unencrypted_private ?? 1) === 0,
    publicSourceInvariant: Number(row?.unsafe_public ?? 1) === 0,
  };
}

export async function getOperationsSnapshot() {
  await ensureDatabase();
  const d1 = getD1();
  const now = nowSeconds();
  const [health, maintenance, backups, drills, counts, accountCount] =
    await Promise.all([
      getSystemHealth(),
      d1
        .prepare(
          `SELECT id, job, status, started_at, completed_at, details_json
           FROM maintenance_runs ORDER BY started_at DESC LIMIT 12`,
        )
        .all<RunRow>(),
      d1
        .prepare(
          `SELECT id, status, checksum_sha256, started_at, completed_at,
                  expires_at, verified_at, details_json
           FROM backup_runs ORDER BY started_at DESC LIMIT 12`,
        )
        .all<BackupRow>(),
      d1
        .prepare(
          `SELECT id, backup_run_id, status, started_at, completed_at,
                  foreign_key_check_passed, smoke_check_passed, details_json
           FROM recovery_drills ORDER BY started_at DESC LIMIT 12`,
        )
        .all<DrillRow>(),
      d1
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM reports
              WHERE status IN ('received', 'reviewing')
                AND sla_due_at <= ?) AS overdue_reports,
             (SELECT COUNT(*) FROM research_intakes
              WHERE expires_at <= ? AND purged_at IS NULL) AS overdue_intakes,
             (SELECT COUNT(*) FROM editor_sessions
              WHERE revoked_at IS NULL AND idle_expires_at > ?
                AND absolute_expires_at > ?) AS active_sessions,
             (SELECT COUNT(*) FROM rate_limit_windows
              WHERE expires_at > ?) AS active_rate_windows`,
        )
        .bind(now, now, now, now, now)
        .first<{
          overdue_reports: number;
          overdue_intakes: number;
          active_sessions: number;
          active_rate_windows: number;
        }>(),
      d1
        .prepare('SELECT COUNT(*) AS total FROM editor_accounts')
        .first<{ total: number }>(),
    ]);

  const lastBackup = backups.results.find(
    (item) => item.status === 'succeeded',
  );
  const lastDrill = drills.results.find((item) => item.status === 'succeeded');
  const configChecks = readinessChecks(Number(accountCount?.total ?? 0));
  const operationalChecks = [
    {
      key: 'backup_recent',
      label: '24 小时内有校验通过的备份',
      ok: Boolean(
        lastBackup?.verified_at &&
        Number(lastBackup.verified_at) >= now - 86_400,
      ),
    },
    {
      key: 'recovery_drill_recent',
      label: '31 天内完成恢复演练',
      ok: Boolean(
        lastDrill?.completed_at &&
        Number(lastDrill.completed_at) >= now - 31 * 86_400,
      ),
    },
    {
      key: 'retention_current',
      label: '无逾期私有载荷',
      ok: health.retentionCurrent,
    },
    {
      key: 'private_payload_encryption',
      label: '私有线索载荷均已加密',
      ok: health.privatePayloadEncryption,
    },
    {
      key: 'sources_safe',
      label: '无失效来源仍公开',
      ok: health.publicSourceInvariant,
    },
  ];
  return {
    health,
    counts: {
      overdueReports: Number(counts?.overdue_reports ?? 0),
      overdueIntakes: Number(counts?.overdue_intakes ?? 0),
      activeSessions: Number(counts?.active_sessions ?? 0),
      activeRateWindows: Number(counts?.active_rate_windows ?? 0),
    },
    readiness: [...configChecks, ...operationalChecks],
    ready: [...configChecks, ...operationalChecks].every((item) => item.ok),
    maintenanceRuns: maintenance.results.map(mapRun),
    backupRuns: backups.results.map(mapBackup),
    recoveryDrills: drills.results.map(mapDrill),
  };
}

export async function recordBackupEvidence(input: {
  id?: string;
  status: 'running' | 'succeeded' | 'failed';
  snapshotReference?: string | null;
  checksumSha256?: string | null;
  startedAt: number;
  completedAt?: number | null;
  expiresAt?: number | null;
  verifiedAt?: number | null;
  details?: Record<string, unknown>;
}) {
  await ensureDatabase();
  validateRunTimes(input.startedAt, input.completedAt, input.status);
  if (
    input.status === 'succeeded' &&
    (!input.snapshotReference ||
      !/^[a-f0-9]{64}$/u.test(input.checksumSha256 ?? '') ||
      !input.verifiedAt ||
      !input.completedAt)
  ) {
    throw new AppError(
      400,
      'backup_evidence_incomplete',
      '成功备份必须包含快照引用、SHA-256 校验和与校验时间。',
    );
  }
  if (
    input.expiresAt != null &&
    input.completedAt != null &&
    input.expiresAt <= input.completedAt
  ) {
    throw new AppError(
      400,
      'invalid_backup_expiry',
      '备份到期时间必须晚于完成时间。',
    );
  }
  const id = input.id?.trim().slice(0, 100) || crypto.randomUUID();
  const snapshotRefHash = input.snapshotReference
    ? await sha256Hex(input.snapshotReference)
    : null;
  await getD1()
    .prepare(
      `INSERT INTO backup_runs
        (id, status, snapshot_ref_hash, checksum_sha256, started_at,
         completed_at, expires_at, verified_at, details_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status,
         snapshot_ref_hash = excluded.snapshot_ref_hash,
         checksum_sha256 = excluded.checksum_sha256,
         completed_at = excluded.completed_at,
         expires_at = excluded.expires_at,
         verified_at = excluded.verified_at,
         details_json = excluded.details_json`,
    )
    .bind(
      id,
      input.status,
      snapshotRefHash,
      input.checksumSha256 ?? null,
      input.startedAt,
      input.completedAt ?? null,
      input.expiresAt ?? null,
      input.verifiedAt ?? null,
      input.details ? JSON.stringify(input.details) : null,
    )
    .run();
  return { id };
}

export async function recordRecoveryDrill(input: {
  id?: string;
  backupRunId?: string | null;
  status: 'running' | 'succeeded' | 'failed';
  startedAt: number;
  completedAt?: number | null;
  foreignKeyCheckPassed?: boolean | null;
  smokeCheckPassed?: boolean | null;
  details?: Record<string, unknown>;
}) {
  await ensureDatabase();
  validateRunTimes(input.startedAt, input.completedAt, input.status);
  if (
    input.status === 'succeeded' &&
    (!input.backupRunId ||
      !input.completedAt ||
      !input.foreignKeyCheckPassed ||
      !input.smokeCheckPassed)
  ) {
    throw new AppError(
      400,
      'recovery_evidence_incomplete',
      '成功演练必须关联备份，并通过外键与核心读取检查。',
    );
  }
  const id = input.id?.trim().slice(0, 100) || crypto.randomUUID();
  await getD1()
    .prepare(
      `INSERT INTO recovery_drills
        (id, backup_run_id, status, started_at, completed_at,
         foreign_key_check_passed, smoke_check_passed, details_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status,
         completed_at = excluded.completed_at,
         foreign_key_check_passed = excluded.foreign_key_check_passed,
         smoke_check_passed = excluded.smoke_check_passed,
         details_json = excluded.details_json`,
    )
    .bind(
      id,
      input.backupRunId ?? null,
      input.status,
      input.startedAt,
      input.completedAt ?? null,
      input.foreignKeyCheckPassed == null
        ? null
        : Number(input.foreignKeyCheckPassed),
      input.smokeCheckPassed == null ? null : Number(input.smokeCheckPassed),
      input.details ? JSON.stringify(input.details) : null,
    )
    .run();
  return { id };
}

function readinessChecks(accountCount: number) {
  const origin = getRuntimeValue('PUBLIC_ORIGIN')?.trim() ?? '';
  const pepper = getRuntimeValue('EDITOR_PASSWORD_PEPPER')?.trim() ?? '';
  const mfa = getRuntimeValue('EDITOR_MFA_KEY_V1')?.trim() ?? '';
  const rate = getRuntimeValue('EDITOR_RATE_LIMIT_SECRET')?.trim() ?? '';
  const privateIntake = getRuntimeValue('PRIVATE_INTAKE_KEY_V1')?.trim() ?? '';
  return [
    {
      key: 'public_origin',
      label: '已配置 HTTPS 正式域名',
      ok: isHttpsOrigin(origin),
    },
    {
      key: 'named_accounts',
      label: '至少一个具名编辑账号',
      ok: accountCount > 0,
    },
    {
      key: 'editor_secrets',
      label: '密码、MFA、限流与私有载荷密钥相互独立',
      ok:
        pepper.length >= 32 &&
        mfa.length >= 32 &&
        rate.length >= 32 &&
        privateIntake.length >= 32 &&
        new Set([pepper, mfa, rate, privateIntake]).size === 4,
    },
    {
      key: 'legacy_disabled',
      label: '共享编辑入口已关闭',
      ok: getRuntimeValue('EDITOR_ENABLE_LEGACY_LOGIN') !== 'true',
    },
    {
      key: 'maintenance_secret',
      label: '定时维护凭证已配置',
      ok: (getRuntimeValue('MAINTENANCE_SECRET')?.trim().length ?? 0) >= 32,
    },
    {
      key: 'pilot_secret',
      label: '试点伪名化密钥已配置',
      ok: (getRuntimeValue('PILOT_SECRET')?.trim().length ?? 0) >= 32,
    },
    {
      key: 'demo_seed_disabled',
      label: '正式环境未启用演示种子',
      ok: getRuntimeValue('SEED_DEMO_CONTENT') !== 'true',
    },
  ];
}

type RunRow = {
  id: string;
  job: string;
  status: string;
  started_at: number;
  completed_at: number | null;
  details_json: string | null;
};
type BackupRow = {
  id: string;
  status: string;
  checksum_sha256: string | null;
  started_at: number;
  completed_at: number | null;
  expires_at: number | null;
  verified_at: number | null;
  details_json: string | null;
};
type DrillRow = {
  id: string;
  backup_run_id: string | null;
  status: string;
  started_at: number;
  completed_at: number | null;
  foreign_key_check_passed: number | null;
  smoke_check_passed: number | null;
  details_json: string | null;
};

function mapRun(row: RunRow) {
  return {
    id: row.id,
    job: row.job,
    status: row.status,
    startedAt: Number(row.started_at),
    completedAt: nullableNumber(row.completed_at),
    details: safeJson(row.details_json),
  };
}
function mapBackup(row: BackupRow) {
  return {
    id: row.id,
    status: row.status,
    checksumSha256: row.checksum_sha256,
    startedAt: Number(row.started_at),
    completedAt: nullableNumber(row.completed_at),
    expiresAt: nullableNumber(row.expires_at),
    verifiedAt: nullableNumber(row.verified_at),
    details: safeJson(row.details_json),
  };
}
function mapDrill(row: DrillRow) {
  return {
    id: row.id,
    backupRunId: row.backup_run_id,
    status: row.status,
    startedAt: Number(row.started_at),
    completedAt: nullableNumber(row.completed_at),
    foreignKeyCheckPassed:
      row.foreign_key_check_passed === null
        ? null
        : Boolean(row.foreign_key_check_passed),
    smokeCheckPassed:
      row.smoke_check_passed === null ? null : Boolean(row.smoke_check_passed),
    details: safeJson(row.details_json),
  };
}

function validateRunTimes(
  startedAt: number,
  completedAt: number | null | undefined,
  status: 'running' | 'succeeded' | 'failed',
) {
  const now = nowSeconds();
  if (!Number.isInteger(startedAt) || startedAt <= 0 || startedAt > now + 300) {
    throw new AppError(400, 'invalid_run_time', '运行开始时间无效。');
  }
  if (
    completedAt != null &&
    (!Number.isInteger(completedAt) ||
      completedAt < startedAt ||
      completedAt > now + 300)
  ) {
    throw new AppError(400, 'invalid_run_time', '运行完成时间无效。');
  }
  if (status === 'running' && completedAt != null) {
    throw new AppError(
      400,
      'invalid_run_state',
      '运行中的任务不能填写完成时间。',
    );
  }
  if (status !== 'running' && completedAt == null) {
    throw new AppError(
      400,
      'invalid_run_state',
      '已结束的任务必须填写完成时间。',
    );
  }
}

function isHttpsOrigin(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' && url.origin === value.replace(/\/$/u, '')
    );
  } catch {
    return false;
  }
}

function safeJson(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function nullableNumber(value: number | null) {
  return value === null ? null : Number(value);
}

function nowSeconds() {
  return Math.floor(Date.now() / 1_000);
}
