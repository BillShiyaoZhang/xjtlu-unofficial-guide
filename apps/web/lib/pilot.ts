import { ensureDatabase } from '@/db/bootstrap';
import { getD1 } from '@/db/index';

import { cleanPlainText, isOneOf, sha256 } from './domain';
import { AppError } from './errors';
import {
  derivePilotSessionToken,
  hmacHex,
  PILOT_NOTICE_VERSION,
  readPilotCookie,
} from './pilot-crypto';
import {
  decidePilotInvitationParticipant,
  isPilotInvitationMode,
} from './pilot-invitation-mode';
import {
  DETACH_WITHDRAWN_QUERY_EVENTS_SQL,
  PURGE_WITHDRAWN_QUERY_IDEMPOTENCY_SQL,
  PURGE_WITHDRAWN_SESSION_IDEMPOTENCY_SQL,
} from './pilot-withdrawal';
import {
  ANONYMOUS_METRIC_WHERE,
  FORMAL_PILOT_METRIC_WHERE,
  pilotMetricSql,
  pilotParticipantSql,
  pilotSharingParticipantSql,
} from './pilot-metrics';
import { getPilotMetricWindow, type PilotMetricWindow } from './pilot-window';

const RECRUITMENT_CHANNELS = [
  'campus',
  'student_group',
  'referral',
  'other',
] as const;

export type PilotSessionIdentity = {
  id: string;
  participantId: string;
  invitationId: string;
  expiresAt: number;
  noticeVersion: string;
  isTest: boolean;
};

export type PilotInvitationSummary = {
  id: string;
  participantHint: string;
  recruitmentChannel: (typeof RECRUITMENT_CHANNELS)[number];
  isTest: boolean;
  issuedAt: number;
  expiresAt: number;
  redeemedAt: number | null;
  revokedAt: number | null;
  lockVersion: number;
  status: 'available' | 'redeemed' | 'expired' | 'revoked';
};

export type PilotMetricSet = {
  queries: number;
  completed: number;
  zeroResults: number;
  responded: number;
  resolved: number;
  opened: number;
  shared: number;
  topThreeResolved: number;
  retrievalErrors: number;
};

export type PilotAdminSnapshot = {
  invitations: PilotInvitationSummary[];
  participants: number;
  sharingParticipants: number;
  formal: PilotMetricSet;
  anonymous: PilotMetricSet;
  metricWindow: PilotMetricWindow;
};

export async function getPilotSessionFromRequest(
  request: Request,
): Promise<PilotSessionIdentity | null> {
  return getPilotSessionFromCookieHeader(request.headers.get('cookie'));
}

export async function getPilotSessionFromCookieHeader(
  cookieHeader: string | null,
): Promise<PilotSessionIdentity | null> {
  const token = readPilotCookie(cookieHeader);
  if (!token) return null;
  await ensureDatabase();
  const tokenHash = await sha256(token);
  const now = nowSeconds();
  const row = await getD1()
    .prepare(
      `SELECT s.id, s.participant_id, s.invitation_id, s.expires_at, c.notice_version,
              p.is_test
       FROM pilot_sessions s
       JOIN pilot_participants p ON p.id = s.participant_id
       JOIN pilot_consent_records c ON c.id = s.consent_id
       JOIN pilot_invitations i ON i.id = s.invitation_id
       WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?
         AND p.status = 'active' AND p.withdrawn_at IS NULL
         AND c.withdrawn_at IS NULL AND c.separate_consent = 1
         AND i.revoked_at IS NULL
       LIMIT 1`,
    )
    .bind(tokenHash, now)
    .first<{
      id: string;
      participant_id: string;
      invitation_id: string;
      expires_at: number;
      notice_version: string;
      is_test: number;
    }>();
  if (!row) return null;
  return {
    id: row.id,
    participantId: row.participant_id,
    invitationId: row.invitation_id,
    expiresAt: Number(row.expires_at),
    noticeVersion: row.notice_version,
    isTest: Boolean(row.is_test),
  };
}

export async function createPilotInvitation(input: {
  inviteCode: string;
  participantRef: string;
  mode: unknown;
  recruitmentChannel: unknown;
  isTest: boolean;
  adultVerified: boolean;
  actorId: string;
}): Promise<{ invitation: PilotInvitationSummary; replayed: boolean }> {
  await ensureDatabase();
  const inviteCode = input.inviteCode.trim();
  const participantRef = input.participantRef.trim().toLocaleUpperCase('en-US');
  if (!/^pi1_[A-Za-z0-9_-]{43}$/u.test(inviteCode)) {
    throw new AppError(
      400,
      'invalid_invite_code',
      '邀请代码必须由编辑工作台安全生成。',
    );
  }
  if (!/^PR-[A-Z0-9]{12,32}$/u.test(participantRef)) {
    throw new AppError(
      400,
      'invalid_participant_ref',
      '研究编号必须由编辑工作台安全生成。',
    );
  }
  if (!isPilotInvitationMode(input.mode)) {
    throw new AppError(
      400,
      'invalid_invitation_mode',
      '请选择新建参与者或向既有研究编号补发邀请。',
    );
  }
  if (!isOneOf(input.recruitmentChannel, RECRUITMENT_CHANNELS)) {
    throw new AppError(400, 'invalid_recruitment_channel', '招募渠道无效。');
  }
  if (!input.adultVerified) {
    throw new AppError(
      400,
      'adult_verification_required',
      '签发邀请前必须完成线下成年核验。',
    );
  }

  const [tokenHash, participantRefHmac] = await Promise.all([
    sha256(inviteCode),
    hmacHex('pilot-participant-ref-v1', participantRef),
  ]);
  const d1 = getD1();
  const existing = await findInvitationByTokenHash(tokenHash);
  if (existing) {
    if (existing.participant_ref_hmac !== participantRefHmac) {
      throw new AppError(
        409,
        'invite_code_conflict',
        '该邀请代码已用于另一名参与者。',
      );
    }
    return { invitation: mapInvitation(existing), replayed: true };
  }

  const now = nowSeconds();
  const expiresAt = now + 72 * 3_600;
  const invitationId = crypto.randomUUID();
  const participantHint = participantRef.slice(-6);
  let participant = await d1
    .prepare(
      `SELECT id, status, recruitment_channel, is_test
       FROM pilot_participants
       WHERE participant_ref_hmac = ? LIMIT 1`,
    )
    .bind(participantRefHmac)
    .first<{
      id: string;
      status: string;
      recruitment_channel: string;
      is_test: number;
    }>();
  const participantDecision = decidePilotInvitationParticipant({
    mode: input.mode,
    participant: participant
      ? {
          status: participant.status,
          recruitmentChannel: participant.recruitment_channel,
          isTest: Boolean(participant.is_test),
        }
      : null,
    recruitmentChannel: input.recruitmentChannel,
    isTest: input.isTest,
  });
  if (!participantDecision.ok) {
    const errors = {
      participant_reissue_not_found: {
        status: 404,
        message: '未找到可补发的活跃研究编号；请核对原编号，已撤回者不能补发。',
      },
      participant_withdrawn: {
        status: 409,
        message: '该研究编号已撤回，不能重新签发邀请。',
      },
      participant_profile_conflict: {
        status: 409,
        message: '该研究编号的渠道或测试标记与既有记录不一致。',
      },
      participant_ref_conflict: {
        status: 409,
        message: '该研究编号已经存在；如需继续参与，请选择补发邀请。',
      },
    } as const;
    const detail = errors[participantDecision.error];
    throw new AppError(
      detail.status,
      participantDecision.error,
      detail.message,
    );
  }

  const participantId = participant?.id ?? crypto.randomUUID();
  const statements: D1PreparedStatement[] = [];
  if (participantDecision.action === 'create') {
    statements.push(
      d1
        .prepare(
          `INSERT INTO pilot_participants
            (id, participant_ref_hmac, participant_hint, recruitment_channel,
             is_test, adult_verified_at, adult_verified_by, status, created_at,
             withdrawn_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, NULL)`,
        )
        .bind(
          participantId,
          participantRefHmac,
          participantHint,
          input.recruitmentChannel,
          input.isTest ? 1 : 0,
          now,
          input.actorId,
          now,
        ),
    );
  }
  statements.push(
    d1
      .prepare(
        `INSERT INTO pilot_invitations
          (id, participant_id, token_hash, issued_by, issued_at, expires_at,
           redeemed_at, revoked_at, revoked_by, lock_version)
         VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 0)`,
      )
      .bind(
        invitationId,
        participantId,
        tokenHash,
        input.actorId,
        now,
        expiresAt,
      ),
    d1
      .prepare(
        `INSERT INTO audit_events
          (id, actor_id, action, target_type, target_id, reason, request_id,
           metadata_json, created_at)
         VALUES (?, ?, 'pilot.invitation.issue', 'pilot_invitation', ?,
                 '完成线下成年核验后签发一次性试点邀请', ?,
                 json_object('channel', ?, 'is_test', ?), ?)`,
      )
      .bind(
        `audit-${invitationId}`,
        input.actorId,
        invitationId,
        crypto.randomUUID(),
        input.recruitmentChannel,
        input.isTest ? 1 : 0,
        now,
      ),
  );

  try {
    await d1.batch(statements);
  } catch (error) {
    const raced = await findInvitationByTokenHash(tokenHash);
    if (raced && raced.participant_ref_hmac === participantRefHmac) {
      return { invitation: mapInvitation(raced), replayed: true };
    }
    throw error;
  }
  participant ??= {
    id: participantId,
    status: 'active',
    recruitment_channel: input.recruitmentChannel,
    is_test: input.isTest ? 1 : 0,
  };
  return {
    invitation: {
      id: invitationId,
      participantHint,
      recruitmentChannel: input.recruitmentChannel,
      isTest: input.isTest,
      issuedAt: now,
      expiresAt,
      redeemedAt: null,
      revokedAt: null,
      lockVersion: 0,
      status: 'available',
    },
    replayed: false,
  };
}

export async function redeemPilotInvitation(input: {
  inviteCode: string;
  noticeVersion: unknown;
  accepted: boolean;
  currentSession: PilotSessionIdentity | null;
}): Promise<{
  token: string;
  session: PilotSessionIdentity;
  replayed: boolean;
}> {
  await ensureDatabase();
  const inviteCode = input.inviteCode.trim();
  if (
    !/^pi1_[A-Za-z0-9_-]{43}$/u.test(inviteCode) ||
    input.noticeVersion !== PILOT_NOTICE_VERSION ||
    !input.accepted
  ) {
    throw new AppError(
      400,
      'consent_required',
      '请输入有效邀请代码，并明确同意当前版本的研究说明。',
    );
  }
  const [inviteHash, token] = await Promise.all([
    sha256(inviteCode),
    derivePilotSessionToken(inviteCode),
  ]);
  const tokenHash = await sha256(token);
  const d1 = getD1();
  const now = nowSeconds();
  const invitation = await d1
    .prepare(
      `SELECT i.id, i.participant_id, i.expires_at, i.redeemed_at,
              i.revoked_at, p.status, p.is_test, p.adult_verified_at
       FROM pilot_invitations i
       JOIN pilot_participants p ON p.id = i.participant_id
       WHERE i.token_hash = ? LIMIT 1`,
    )
    .bind(inviteHash)
    .first<{
      id: string;
      participant_id: string;
      expires_at: number;
      redeemed_at: number | null;
      revoked_at: number | null;
      status: string;
      is_test: number;
      adult_verified_at: number;
    }>();
  if (
    !invitation ||
    invitation.revoked_at !== null ||
    Number(invitation.expires_at) <= now ||
    invitation.status !== 'active' ||
    !invitation.adult_verified_at
  ) {
    throw invitationUnavailable();
  }

  const existing = await findSessionByInvitation(invitation.id, tokenHash);
  if (invitation.redeemed_at !== null) {
    if (
      !existing ||
      input.currentSession?.id !== existing.id ||
      input.currentSession.invitationId !== invitation.id
    ) {
      throw invitationUnavailable();
    }
    return {
      token,
      session: mapSession(existing),
      replayed: true,
    };
  }
  if (input.currentSession) {
    throw new AppError(
      409,
      'pilot_session_already_active',
      '这台设备已有有效试点会话，请先退出后再兑换其他邀请。',
    );
  }

  const consentId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const expiresAt = now + 28 * 86_400;
  try {
    await d1.batch([
      d1
        .prepare(
          `UPDATE pilot_invitations
           SET redeemed_at = ?, lock_version = lock_version + 1
           WHERE id = ? AND redeemed_at IS NULL AND revoked_at IS NULL
             AND expires_at > ?`,
        )
        .bind(now, invitation.id, now),
      d1
        .prepare(
          `INSERT INTO pilot_consent_records
            (id, participant_id, invitation_id, notice_version, purpose,
             separate_consent, granted_at, withdrawn_at)
           VALUES (?, ?, ?, ?, 'stage1_product_research', 1, ?, NULL)`,
        )
        .bind(
          consentId,
          invitation.participant_id,
          invitation.id,
          PILOT_NOTICE_VERSION,
          now,
        ),
      d1
        .prepare(
          `INSERT INTO pilot_sessions
            (id, participant_id, consent_id, invitation_id, token_hash,
             issued_at, expires_at, revoked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
        )
        .bind(
          sessionId,
          invitation.participant_id,
          consentId,
          invitation.id,
          tokenHash,
          now,
          expiresAt,
        ),
      d1
        .prepare(
          `INSERT INTO audit_events
            (id, actor_id, action, target_type, target_id, reason, request_id,
             metadata_json, created_at)
           VALUES (?, ?, 'pilot.consent.grant', 'pilot_session', ?,
                   '参与者明确同意当前研究说明并兑换一次性邀请', ?,
                   json_object('notice_version', ?), ?)`,
        )
        .bind(
          `audit-${sessionId}`,
          `pilot-invitation:${invitation.id}`,
          sessionId,
          crypto.randomUUID(),
          PILOT_NOTICE_VERSION,
          now,
        ),
    ]);
  } catch (error) {
    const raced = await findSessionByInvitation(invitation.id, tokenHash);
    if (raced) throw invitationUnavailable();
    throw error;
  }
  return {
    token,
    session: {
      id: sessionId,
      participantId: invitation.participant_id,
      invitationId: invitation.id,
      expiresAt,
      noticeVersion: PILOT_NOTICE_VERSION,
      isTest: Boolean(invitation.is_test),
    },
    replayed: false,
  };
}

export async function revokePilotInvitation(input: {
  invitationId: string;
  expectedVersion: number;
  actorId: string;
}): Promise<PilotInvitationSummary> {
  await ensureDatabase();
  const invitationId = cleanPlainText(input.invitationId, 100);
  if (!invitationId || !Number.isInteger(input.expectedVersion)) {
    throw new AppError(400, 'invalid_invitation', '邀请记录无效。');
  }
  const d1 = getD1();
  const before = await findInvitationById(invitationId);
  if (!before) throw new AppError(404, 'invitation_not_found', '找不到邀请。');
  if (before.revoked_at !== null) return mapInvitation(before);
  if (Number(before.lock_version) !== input.expectedVersion) {
    throw new AppError(412, 'stale_invitation', '邀请状态已更新，请刷新。');
  }
  const now = nowSeconds();
  const requestId = crypto.randomUUID();
  await d1.batch([
    d1
      .prepare(
        `UPDATE pilot_invitations
         SET revoked_at = ?, revoked_by = ?,
             lock_version = lock_version + 1
         WHERE id = ? AND lock_version = ? AND revoked_at IS NULL`,
      )
      .bind(now, input.actorId, invitationId, input.expectedVersion),
    d1
      .prepare(
        `INSERT INTO audit_events
          (id, actor_id, action, target_type, target_id, reason, request_id,
           metadata_json, created_at)
         SELECT ?, ?, 'pilot.invitation.revoke', 'pilot_invitation', ?,
                '编辑撤销邀请并立即终止关联会话', ?, NULL, ?
         WHERE EXISTS (
           SELECT 1 FROM pilot_invitations
           WHERE id = ? AND revoked_at = ? AND lock_version = ?
         )`,
      )
      .bind(
        `audit-${requestId}`,
        input.actorId,
        invitationId,
        requestId,
        now,
        invitationId,
        now,
        input.expectedVersion + 1,
      ),
  ]);
  const after = await findInvitationById(invitationId);
  if (
    !after ||
    after.revoked_at === null ||
    Number(after.lock_version) !== input.expectedVersion + 1
  ) {
    throw new AppError(412, 'stale_invitation', '邀请状态已更新，请刷新。');
  }
  return mapInvitation(after);
}

export async function exitPilotSession(session: PilotSessionIdentity) {
  await ensureDatabase();
  const now = nowSeconds();
  await getD1()
    .prepare(
      `UPDATE pilot_sessions
       SET token_hash = 'revoked:' || id, revoked_at = COALESCE(revoked_at, ?)
       WHERE id = ? AND revoked_at IS NULL`,
    )
    .bind(now, session.id)
    .run();
}

export async function getPilotWithdrawalSubject(inviteCodeInput: string) {
  await ensureDatabase();
  const inviteCode = inviteCodeInput.trim();
  if (!/^pi1_[A-Za-z0-9_-]{43}$/u.test(inviteCode)) {
    throw new AppError(
      400,
      'invalid_withdrawal_code',
      '请输入兑换试点时使用的完整邀请代码。',
    );
  }
  const tokenHash = await sha256(inviteCode);
  const row = await getD1()
    .prepare(
      `SELECT i.id AS invitation_id, i.participant_id
       FROM pilot_invitations i
       JOIN pilot_participants p ON p.id = i.participant_id
       WHERE i.token_hash = ? AND i.redeemed_at IS NOT NULL
         AND p.status = 'active' AND p.withdrawn_at IS NULL
       LIMIT 1`,
    )
    .bind(tokenHash)
    .first<{ invitation_id: string; participant_id: string }>();
  if (!row) {
    throw new AppError(
      404,
      'withdrawal_code_unavailable',
      '邀请代码无效，或该参与记录已经撤回。',
    );
  }
  return {
    participantId: row.participant_id,
    actorId: `pilot-invitation:${row.invitation_id}`,
  };
}

export async function withdrawPilotParticipation(input: {
  participantId: string;
  actorId: string;
}) {
  await ensureDatabase();
  const d1 = getD1();
  const now = nowSeconds();
  const requestId = crypto.randomUUID();
  await d1.batch([
    d1.prepare(PURGE_WITHDRAWN_QUERY_IDEMPOTENCY_SQL).bind(input.participantId),
    d1.prepare(DETACH_WITHDRAWN_QUERY_EVENTS_SQL).bind(input.participantId),
    d1
      .prepare(
        `UPDATE research_intakes
         SET participant_ref_hash = 'purged', pilot_participant_id = NULL,
             origin_query_event_id = NULL,
             context_scope = '参与者撤回后已清理', body = NULL,
             source_url = NULL, provenance_role = NULL, status = 'expired',
             expires_at = ?, purged_at = ?
         WHERE pilot_participant_id = ? AND purged_at IS NULL`,
      )
      .bind(now, now, input.participantId),
    d1
      .prepare(
        `UPDATE reports SET pilot_participant_id = NULL
         WHERE pilot_participant_id = ?`,
      )
      .bind(input.participantId),
    d1
      .prepare(PURGE_WITHDRAWN_SESSION_IDEMPOTENCY_SQL)
      .bind(input.participantId),
    d1
      .prepare(
        `UPDATE pilot_participants
         SET participant_ref_hmac = NULL, participant_hint = 'withdrawn',
             status = 'withdrawn', withdrawn_at = ?
         WHERE id = ? AND status = 'active'`,
      )
      .bind(now, input.participantId),
    d1
      .prepare(
        `UPDATE pilot_invitations
         SET token_hash = 'withdrawn:' || id
         WHERE participant_id = ?`,
      )
      .bind(input.participantId),
    d1
      .prepare(
        `INSERT INTO audit_events
          (id, actor_id, action, target_type, target_id, reason, request_id,
           metadata_json, created_at)
         VALUES (?, ?, 'pilot.consent.withdraw', 'pilot_participant', ?,
                 '参与者撤回同意；会话失效并清理可识别映射与私有载荷', ?,
                 NULL, ?)`,
      )
      .bind(
        `audit-${requestId}`,
        input.actorId,
        input.participantId,
        requestId,
        now,
      ),
  ]);
}

export async function getPilotAdminSnapshot(
  actorId: string,
): Promise<PilotAdminSnapshot> {
  await ensureDatabase();
  const d1 = getD1();
  const now = nowSeconds();
  const metricWindow = getPilotMetricWindow();
  const metricBindings = metricWindow.configured
    ? [metricWindow.startAt, metricWindow.endAt]
    : [];
  const requestId = crypto.randomUUID();
  await d1
    .prepare(
      `INSERT INTO audit_events
        (id, actor_id, action, target_type, target_id, reason, request_id,
         metadata_json, created_at)
       VALUES (?, ?, 'pilot.dashboard.read', 'pilot_dashboard', 'stage1',
               '查看试点邀请状态与去标识化聚合指标', ?, NULL, ?)`,
    )
    .bind(`audit-${requestId}`, actorId, requestId, now)
    .run();
  const [
    invitationRows,
    participantRow,
    sharingParticipantRow,
    formalRow,
    anonymousRow,
  ] = await Promise.all([
    d1
      .prepare(
        `SELECT i.id, i.issued_at, i.expires_at, i.redeemed_at,
                  i.revoked_at, i.lock_version, p.participant_hint,
                  p.recruitment_channel, p.is_test, p.participant_ref_hmac
           FROM pilot_invitations i
           JOIN pilot_participants p ON p.id = i.participant_id
           ORDER BY i.issued_at DESC LIMIT 50`,
      )
      .all<InvitationRow>(),
    d1
      .prepare(pilotParticipantSql(metricWindow.configured))
      .bind(...metricBindings)
      .first<{ total: number }>(),
    d1
      .prepare(pilotSharingParticipantSql(metricWindow.configured))
      .bind(...metricBindings)
      .first<{ total: number }>(),
    metricQuery(FORMAL_PILOT_METRIC_WHERE),
    metricQuery(ANONYMOUS_METRIC_WHERE),
  ]);
  return {
    invitations: invitationRows.results.map(mapInvitation),
    participants: Number(participantRow?.total ?? 0),
    sharingParticipants: Number(sharingParticipantRow?.total ?? 0),
    formal: mapMetricRow(formalRow),
    anonymous: mapMetricRow(anonymousRow),
    metricWindow,
  };

  async function metricQuery(where: string) {
    return d1
      .prepare(pilotMetricSql(where, metricWindow.configured))
      .bind(...metricBindings)
      .first<MetricRow>();
  }
}

type InvitationRow = {
  id: string;
  participant_hint: string;
  participant_ref_hmac?: string | null;
  recruitment_channel: (typeof RECRUITMENT_CHANNELS)[number];
  is_test: number;
  issued_at: number;
  expires_at: number;
  redeemed_at: number | null;
  revoked_at: number | null;
  lock_version: number;
};

type InvitationLookupRow = InvitationRow & {
  participant_ref_hmac: string | null;
};

type SessionRow = {
  id: string;
  participant_id: string;
  invitation_id: string;
  expires_at: number;
  notice_version: string;
  is_test: number;
};

type MetricRow = {
  queries: number | null;
  completed: number | null;
  zero_results: number | null;
  responded: number | null;
  resolved: number | null;
  opened: number | null;
  shared: number | null;
  top_three_resolved: number | null;
  retrieval_errors: number | null;
};

async function findInvitationByTokenHash(tokenHash: string) {
  return getD1()
    .prepare(
      `SELECT i.id, i.issued_at, i.expires_at, i.redeemed_at, i.revoked_at,
              i.lock_version, p.participant_hint, p.participant_ref_hmac,
              p.recruitment_channel, p.is_test
       FROM pilot_invitations i
       JOIN pilot_participants p ON p.id = i.participant_id
       WHERE i.token_hash = ? LIMIT 1`,
    )
    .bind(tokenHash)
    .first<InvitationLookupRow>();
}

async function findInvitationById(id: string) {
  return getD1()
    .prepare(
      `SELECT i.id, i.issued_at, i.expires_at, i.redeemed_at, i.revoked_at,
              i.lock_version, p.participant_hint, p.participant_ref_hmac,
              p.recruitment_channel, p.is_test
       FROM pilot_invitations i
       JOIN pilot_participants p ON p.id = i.participant_id
       WHERE i.id = ? LIMIT 1`,
    )
    .bind(id)
    .first<InvitationLookupRow>();
}

async function findSessionByInvitation(
  invitationId: string,
  tokenHash: string,
) {
  const now = nowSeconds();
  return getD1()
    .prepare(
      `SELECT s.id, s.participant_id, s.invitation_id, s.expires_at, c.notice_version,
              p.is_test
       FROM pilot_sessions s
       JOIN pilot_consent_records c ON c.id = s.consent_id
       JOIN pilot_participants p ON p.id = s.participant_id
       WHERE s.invitation_id = ? AND s.token_hash = ?
         AND s.revoked_at IS NULL AND s.expires_at > ?
         AND c.withdrawn_at IS NULL AND p.status = 'active'
       LIMIT 1`,
    )
    .bind(invitationId, tokenHash, now)
    .first<SessionRow>();
}

function mapInvitation(row: InvitationRow): PilotInvitationSummary {
  const now = nowSeconds();
  const status = row.revoked_at
    ? 'revoked'
    : row.redeemed_at
      ? 'redeemed'
      : Number(row.expires_at) <= now
        ? 'expired'
        : 'available';
  return {
    id: row.id,
    participantHint: row.participant_hint,
    recruitmentChannel: row.recruitment_channel,
    isTest: Boolean(row.is_test),
    issuedAt: Number(row.issued_at),
    expiresAt: Number(row.expires_at),
    redeemedAt: row.redeemed_at === null ? null : Number(row.redeemed_at),
    revokedAt: row.revoked_at === null ? null : Number(row.revoked_at),
    lockVersion: Number(row.lock_version),
    status,
  };
}

function mapSession(row: SessionRow): PilotSessionIdentity {
  return {
    id: row.id,
    participantId: row.participant_id,
    invitationId: row.invitation_id,
    expiresAt: Number(row.expires_at),
    noticeVersion: row.notice_version,
    isTest: Boolean(row.is_test),
  };
}

function mapMetricRow(row: MetricRow | null): PilotMetricSet {
  return {
    queries: Number(row?.queries ?? 0),
    completed: Number(row?.completed ?? 0),
    zeroResults: Number(row?.zero_results ?? 0),
    responded: Number(row?.responded ?? 0),
    resolved: Number(row?.resolved ?? 0),
    opened: Number(row?.opened ?? 0),
    shared: Number(row?.shared ?? 0),
    topThreeResolved: Number(row?.top_three_resolved ?? 0),
    retrievalErrors: Number(row?.retrieval_errors ?? 0),
  };
}

function invitationUnavailable() {
  return new AppError(
    409,
    'invitation_unavailable',
    '邀请已使用、已撤销或已过期，请联系招募人员。',
  );
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}
