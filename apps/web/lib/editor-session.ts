import { ensureDatabase } from '@/db/bootstrap';
import { getD1, getRuntimeValue } from '@/db';

import {
  buildTotpUri,
  createPasswordCredential,
  decryptTotpSecret,
  encryptTotpSecret,
  findValidTotpCounter,
  generateRecoveryCodes,
  generateTotpSecret,
  normalizeEditorEmail,
  randomToken,
  secretsMatch,
  sha256Hex,
  validatePassword,
  verifyPassword,
} from './editor-crypto';
import {
  EDITOR_ROLES,
  ROLE_PERMISSIONS,
  type EditorPermission,
  type EditorRole,
} from './editor-access-model';
import { AppError } from './errors';

export {
  EDITOR_PERMISSIONS,
  EDITOR_ROLES,
  type EditorPermission,
  type EditorRole,
} from './editor-access-model';

export const EDITOR_COOKIE_NAME = '__Host-xg_editor';
const ABSOLUTE_SESSION_SECONDS = 8 * 3_600;
const IDLE_SESSION_SECONDS = 30 * 60;
const SESSION_TOUCH_SECONDS = 5 * 60;

export type LocalEditorUser = {
  userId: string;
  sessionId: string | null;
  displayName: string;
  email: string;
  fullName: string | null;
  roles: EditorRole[];
  permissions: EditorPermission[];
  mustChangePassword: boolean;
  legacy: boolean;
};

export type EditorLoginMode =
  | { mode: 'named'; bootstrapCreated: boolean }
  | { mode: 'legacy'; bootstrapCreated: false }
  | { mode: 'unconfigured'; bootstrapCreated: false };

export async function createEditorSession(input: {
  email?: string;
  password?: string;
  mfaCode?: string;
  legacySecret?: string;
  requestId?: string;
}) {
  await ensureDatabase();
  await ensureBootstrapEditor();
  if (!(await namedAccountExists())) {
    return createLegacyEditorSession(input.legacySecret ?? '');
  }

  const config = namedEditorSecrets();
  if (!config) {
    throw new AppError(
      503,
      'editor_security_not_configured',
      '编辑账号安全密钥尚未完整配置。',
    );
  }
  const email = normalizeEditorEmail(input.email ?? '');
  const password = input.password ?? '';
  const mfaCode = (input.mfaCode ?? '').trim();
  const d1 = getD1();
  const now = nowSeconds();
  const account = await d1
    .prepare(
      `SELECT a.id, a.email, a.display_name, a.password_salt, a.password_hash,
              a.password_iterations, a.status, a.session_version,
              a.must_change_password, a.failed_login_count, a.locked_until,
              f.id AS factor_id, f.encrypted_secret, f.last_used_counter
       FROM editor_accounts a
       LEFT JOIN editor_totp_factors f
         ON f.account_id = a.id AND f.revoked_at IS NULL
       WHERE a.email = ? LIMIT 1`,
    )
    .bind(email)
    .first<NamedAccountRow>();

  const reject = async (reason: string): Promise<never> => {
    if (account) await recordFailedLogin(account, reason, input.requestId);
    if (!account) await burnLoginTiming(password, config.passwordPepper);
    throw new AppError(
      401,
      'invalid_editor_credentials',
      '邮箱、密码或双重验证码不正确。',
    );
  };

  if (
    !account ||
    account.status !== 'active' ||
    (account.locked_until !== null && Number(account.locked_until) > now)
  ) {
    return reject('account_unavailable');
  }
  if (
    !(await verifyPassword(password, config.passwordPepper, {
      salt: account.password_salt,
      hash: account.password_hash,
      iterations: Number(account.password_iterations),
    }))
  ) {
    return reject('password_rejected');
  }
  if (!account.factor_id || !account.encrypted_secret) {
    throw new AppError(
      403,
      'editor_mfa_required',
      '该账号尚未完成双重验证配置。',
    );
  }

  let mfaMethod = 'totp';
  if (/^\d{6}$/u.test(mfaCode)) {
    let secret: string;
    try {
      secret = await decryptTotpSecret({
        encryptedSecret: account.encrypted_secret,
        encryptionKey: config.mfaKey,
        accountId: account.id,
        factorId: account.factor_id,
      });
    } catch {
      throw new AppError(
        503,
        'editor_mfa_key_unavailable',
        '双重验证密钥不可用，请联系账号管理员。',
      );
    }
    const counter = await findValidTotpCounter({
      secret,
      code: mfaCode,
      lastUsedCounter: account.last_used_counter,
    });
    if (counter === null) return reject('totp_rejected');
    const replayGuard = await d1
      .prepare(
        `UPDATE editor_totp_factors SET last_used_counter = ?
         WHERE id = ? AND revoked_at IS NULL
           AND (last_used_counter IS NULL OR last_used_counter < ?)`,
      )
      .bind(counter, account.factor_id, counter)
      .run();
    if (Number(replayGuard.meta.changes ?? 0) !== 1) {
      return reject('totp_replayed');
    }
  } else {
    const recoveryHash = await sha256Hex(normalizeRecoveryCode(mfaCode));
    const used = await d1
      .prepare(
        `UPDATE editor_recovery_codes SET used_at = ?
         WHERE account_id = ? AND code_hash = ? AND used_at IS NULL`,
      )
      .bind(now, account.id, recoveryHash)
      .run();
    if (Number(used.meta.changes ?? 0) !== 1) {
      return reject('recovery_code_rejected');
    }
    mfaMethod = 'recovery_code';
  }

  const sessionId = crypto.randomUUID();
  const rawToken = `es2_${randomToken(32)}`;
  const tokenHash = await sha256Hex(rawToken);
  const absoluteExpiresAt = now + ABSOLUTE_SESSION_SECONDS;
  const idleExpiresAt = now + IDLE_SESSION_SECONDS;
  const requestId = input.requestId ?? crypto.randomUUID();
  await d1.batch([
    d1
      .prepare(
        `INSERT INTO editor_sessions
          (id, account_id, token_hash, session_version, issued_at, last_seen_at,
           idle_expires_at, absolute_expires_at, revoked_at, revoked_by, revoke_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
      )
      .bind(
        sessionId,
        account.id,
        tokenHash,
        account.session_version,
        now,
        now,
        idleExpiresAt,
        absoluteExpiresAt,
      ),
    d1
      .prepare(
        `UPDATE editor_accounts
         SET failed_login_count = 0, locked_until = NULL,
             last_login_at = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(now, now, account.id),
    auditStatement(d1, {
      actorId: account.id,
      action: 'editor.session.login',
      targetType: 'editor_session',
      targetId: sessionId,
      reason: '具名编辑完成密码和双重验证登录',
      requestId,
      metadata: { mfaMethod },
      now,
    }),
  ]);
  return {
    token: rawToken,
    expiresAt: absoluteExpiresAt,
    user: await namedEditorUser(account, sessionId),
  };
}

export async function getLocalEditorFromCookieHeader(
  cookieHeader: string | null,
): Promise<LocalEditorUser | null> {
  if (!cookieHeader) return null;
  const token = readCookie(cookieHeader, EDITOR_COOKIE_NAME);
  if (!token) return null;
  await ensureDatabase();

  if (/^es2_[A-Za-z0-9_-]{43}$/u.test(token)) {
    const now = nowSeconds();
    const tokenHash = await sha256Hex(token);
    const row = await getD1()
      .prepare(
        `SELECT s.id AS session_id, s.last_seen_at, s.absolute_expires_at,
                a.id, a.email, a.display_name, a.status, a.session_version,
                a.must_change_password
         FROM editor_sessions s
         JOIN editor_accounts a ON a.id = s.account_id
         WHERE s.token_hash = ? AND s.revoked_at IS NULL
           AND s.idle_expires_at > ? AND s.absolute_expires_at > ?
           AND a.status = 'active' AND a.session_version = s.session_version
         LIMIT 1`,
      )
      .bind(tokenHash, now, now)
      .first<NamedSessionRow>();
    if (!row) return null;
    if (Number(row.last_seen_at) + SESSION_TOUCH_SECONDS <= now) {
      await getD1()
        .prepare(
          `UPDATE editor_sessions
           SET last_seen_at = ?, idle_expires_at = MIN(?, absolute_expires_at)
           WHERE id = ? AND revoked_at IS NULL`,
        )
        .bind(now, now + IDLE_SESSION_SECONDS, row.session_id)
        .run();
    }
    return namedEditorUser(row, row.session_id);
  }

  if (await namedAccountExists()) return null;
  return verifyLegacyEditorToken(token);
}

export async function revokeEditorSessionFromCookie(
  cookieHeader: string | null,
  requestId?: string,
) {
  if (!cookieHeader) return;
  const token = readCookie(cookieHeader, EDITOR_COOKIE_NAME);
  if (!token || !/^es2_[A-Za-z0-9_-]{43}$/u.test(token)) return;
  await ensureDatabase();
  const now = nowSeconds();
  const tokenHash = await sha256Hex(token);
  const d1 = getD1();
  const row = await d1
    .prepare(
      `SELECT id, account_id FROM editor_sessions
       WHERE token_hash = ? AND revoked_at IS NULL LIMIT 1`,
    )
    .bind(tokenHash)
    .first<{ id: string; account_id: string }>();
  if (!row) return;
  await d1.batch([
    d1
      .prepare(
        `UPDATE editor_sessions
         SET revoked_at = ?, revoked_by = ?, revoke_reason = ?
         WHERE id = ? AND revoked_at IS NULL`,
      )
      .bind(now, row.account_id, '编辑主动退出', row.id),
    auditStatement(d1, {
      actorId: row.account_id,
      action: 'editor.session.logout',
      targetType: 'editor_session',
      targetId: row.id,
      reason: '编辑主动结束当前会话',
      requestId: requestId ?? crypto.randomUUID(),
      now,
    }),
  ]);
}

export async function getEditorLoginMode(): Promise<EditorLoginMode> {
  await ensureDatabase();
  const bootstrapCreated = await ensureBootstrapEditor();
  if (await namedAccountExists()) return { mode: 'named', bootstrapCreated };
  if (legacyEditorSecrets()) return { mode: 'legacy', bootstrapCreated: false };
  return { mode: 'unconfigured', bootstrapCreated: false };
}

export async function editorLoginConfigured() {
  return (await getEditorLoginMode()).mode !== 'unconfigured';
}

export function editorLoginRequested() {
  return Boolean(
    getRuntimeValue('EDITOR_BOOTSTRAP_EMAIL')?.trim() ||
    getRuntimeValue('EDITOR_LOGIN_SECRET')?.trim(),
  );
}

export function hasEditorPermission(
  user: LocalEditorUser,
  permission: EditorPermission,
) {
  return user.permissions.includes(permission);
}

export function permissionsForRoles(roles: readonly EditorRole[]) {
  return [...new Set(roles.flatMap((role) => ROLE_PERMISSIONS[role]))];
}

export function isEditorRole(value: unknown): value is EditorRole {
  return EDITOR_ROLES.includes(value as EditorRole);
}

export function editorCookieHeader(token: string, expiresAt: number) {
  return `${EDITOR_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${Math.max(0, expiresAt - nowSeconds())}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearEditorCookieHeader() {
  return `${EDITOR_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

export function parseEditorReturnTo(value: string | undefined) {
  if (!value || value.length > 500 || !value.startsWith('/editor'))
    return '/editor';
  if (value.startsWith('//') || value.startsWith('/editor/login'))
    return '/editor';
  try {
    const url = new URL(value, 'https://app.local');
    return url.origin === 'https://app.local'
      ? `${url.pathname}${url.search}${url.hash}`
      : '/editor';
  } catch {
    return '/editor';
  }
}

export async function provisionEditorAccount(input: {
  email: string;
  displayName: string;
  roles: EditorRole[];
  actorId: string;
  requestId: string;
}) {
  await ensureDatabase();
  const config = namedEditorSecrets();
  if (!config)
    throw new AppError(
      503,
      'editor_security_not_configured',
      '账号密钥未配置。',
    );
  const email = normalizeEditorEmail(input.email);
  const displayName = input.displayName.trim().slice(0, 80);
  if (!/^\S+@\S+\.\S+$/u.test(email) || displayName.length < 2) {
    throw new AppError(
      400,
      'invalid_editor_account',
      '请填写有效的姓名和邮箱。',
    );
  }
  const roles = [...new Set(input.roles)];
  if (!roles.length || roles.some((role) => !isEditorRole(role))) {
    throw new AppError(400, 'invalid_editor_roles', '至少选择一个有效角色。');
  }
  const password = humanInitialPassword();
  const totpSecret = generateTotpSecret();
  const recoveryCodes = generateRecoveryCodes();
  const accountId = crypto.randomUUID();
  const factorId = crypto.randomUUID();
  const now = nowSeconds();
  const credential = await createPasswordCredential(
    password,
    config.passwordPepper,
  );
  const encryptedSecret = await encryptTotpSecret({
    secret: totpSecret,
    encryptionKey: config.mfaKey,
    accountId,
    factorId,
  });
  const d1 = getD1();
  const statements: D1PreparedStatement[] = [
    d1
      .prepare(
        `INSERT INTO editor_accounts
          (id, email, display_name, password_salt, password_hash,
           password_iterations, status, session_version, must_change_password,
           failed_login_count, locked_until, last_login_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', 1, 1, 0, NULL, NULL, ?, ?)`,
      )
      .bind(
        accountId,
        email,
        displayName,
        credential.salt,
        credential.hash,
        credential.iterations,
        now,
        now,
      ),
    d1
      .prepare(
        `INSERT INTO editor_totp_factors
          (id, account_id, label, encrypted_secret, key_version,
           last_used_counter, verified_at, revoked_at, created_at)
         VALUES (?, ?, 'Authenticator', ?, 1, NULL, ?, NULL, ?)`,
      )
      .bind(factorId, accountId, encryptedSecret, now, now),
  ];
  for (const role of roles) {
    statements.push(
      d1
        .prepare(
          `INSERT INTO editor_role_grants
            (account_id, role, granted_by, granted_at, revoked_by, revoked_at)
           VALUES (?, ?, ?, ?, NULL, NULL)`,
        )
        .bind(accountId, role, input.actorId, now),
    );
  }
  for (const recoveryCode of recoveryCodes) {
    statements.push(
      d1
        .prepare(
          `INSERT INTO editor_recovery_codes
            (account_id, code_hash, created_at, used_at)
           VALUES (?, ?, ?, NULL)`,
        )
        .bind(
          accountId,
          await sha256Hex(normalizeRecoveryCode(recoveryCode)),
          now,
        ),
    );
  }
  statements.push(
    auditStatement(d1, {
      actorId: input.actorId,
      action: 'editor.account.create',
      targetType: 'editor_account',
      targetId: accountId,
      reason: '创建具名编辑账号并授予初始角色',
      requestId: input.requestId,
      metadata: { roles },
      now,
    }),
  );
  try {
    await d1.batch(statements);
  } catch (error) {
    if (String(error).includes('UNIQUE')) {
      throw new AppError(409, 'editor_email_exists', '该邮箱已有编辑账号。');
    }
    throw error;
  }
  return {
    account: { id: accountId, email, displayName, roles },
    activation: {
      initialPassword: password,
      totpSecret,
      totpUri: buildTotpUri({ email, secret: totpSecret }),
      recoveryCodes,
    },
  };
}

export async function listEditorAccounts() {
  await ensureDatabase();
  const result = await getD1()
    .prepare(
      `SELECT a.id, a.email, a.display_name, a.status, a.must_change_password,
              a.last_login_at, a.created_at,
              GROUP_CONCAT(DISTINCT CASE WHEN g.revoked_at IS NULL THEN g.role END) AS roles,
              COUNT(DISTINCT CASE WHEN s.revoked_at IS NULL
                    AND s.idle_expires_at > unixepoch()
                    AND s.absolute_expires_at > unixepoch() THEN s.id END) AS active_sessions
       FROM editor_accounts a
       LEFT JOIN editor_role_grants g ON g.account_id = a.id
       LEFT JOIN editor_sessions s ON s.account_id = a.id
       GROUP BY a.id
       ORDER BY a.status ASC, a.display_name ASC`,
    )
    .all<{
      id: string;
      email: string;
      display_name: string;
      status: 'active' | 'disabled';
      must_change_password: number;
      last_login_at: number | null;
      created_at: number;
      roles: string | null;
      active_sessions: number;
    }>();
  return result.results.map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    status: row.status,
    mustChangePassword: Boolean(row.must_change_password),
    lastLoginAt: row.last_login_at === null ? null : Number(row.last_login_at),
    createdAt: Number(row.created_at),
    roles: (row.roles?.split(',').filter(isEditorRole) ?? []) as EditorRole[],
    activeSessions: Number(row.active_sessions),
  }));
}

export async function updateEditorAccount(input: {
  accountId: string;
  status: 'active' | 'disabled';
  roles: EditorRole[];
  actorId: string;
  requestId: string;
  reason: string;
}) {
  await ensureDatabase();
  const roles = [...new Set(input.roles)];
  if (!roles.length || roles.some((role) => !isEditorRole(role))) {
    throw new AppError(400, 'invalid_editor_roles', '至少保留一个有效角色。');
  }
  const reason = input.reason.trim().slice(0, 300);
  if (reason.length < 6) {
    throw new AppError(
      400,
      'account_change_reason_required',
      '变更理由至少需要 6 个字符。',
    );
  }
  const d1 = getD1();
  const account = await d1
    .prepare('SELECT id, status FROM editor_accounts WHERE id = ? LIMIT 1')
    .bind(input.accountId)
    .first<{ id: string; status: 'active' | 'disabled' }>();
  if (!account)
    throw new AppError(404, 'editor_account_not_found', '找不到该编辑账号。');

  const activeAdmins = await d1
    .prepare(
      `SELECT COUNT(DISTINCT a.id) AS total
       FROM editor_accounts a JOIN editor_role_grants g ON g.account_id = a.id
       WHERE a.status = 'active' AND g.role = 'account_admin'
         AND g.revoked_at IS NULL`,
    )
    .first<{ total: number }>();
  const targetIsActiveAdmin = await d1
    .prepare(
      `SELECT 1 AS present FROM editor_role_grants
       WHERE account_id = ? AND role = 'account_admin' AND revoked_at IS NULL`,
    )
    .bind(input.accountId)
    .first<{ present: number }>();
  if (
    targetIsActiveAdmin &&
    Number(activeAdmins?.total ?? 0) <= 1 &&
    (input.status !== 'active' || !roles.includes('account_admin'))
  ) {
    throw new AppError(
      409,
      'last_account_admin',
      '不能停用或移除最后一名账号管理员。',
    );
  }

  const now = nowSeconds();
  const current = await d1
    .prepare(
      `SELECT role FROM editor_role_grants
       WHERE account_id = ? AND revoked_at IS NULL`,
    )
    .bind(input.accountId)
    .all<{ role: string }>();
  const currentRoles = current.results
    .map((row) => row.role)
    .filter(isEditorRole);
  const changed =
    account.status !== input.status ||
    currentRoles.length !== roles.length ||
    currentRoles.some((role) => !roles.includes(role));
  if (!changed) return { updated: false };

  const statements: D1PreparedStatement[] = [
    d1
      .prepare(
        `UPDATE editor_accounts
         SET status = ?, session_version = session_version + 1, updated_at = ?
         WHERE id = ?`,
      )
      .bind(input.status, now, input.accountId),
  ];
  for (const role of EDITOR_ROLES) {
    if (roles.includes(role)) {
      statements.push(
        d1
          .prepare(
            `INSERT INTO editor_role_grants
              (account_id, role, granted_by, granted_at, revoked_by, revoked_at)
             VALUES (?, ?, ?, ?, NULL, NULL)
             ON CONFLICT(account_id, role) DO UPDATE SET
               granted_by = excluded.granted_by,
               granted_at = excluded.granted_at,
               revoked_by = NULL,
               revoked_at = NULL`,
          )
          .bind(input.accountId, role, input.actorId, now),
      );
    } else {
      statements.push(
        d1
          .prepare(
            `UPDATE editor_role_grants SET revoked_by = ?, revoked_at = ?
             WHERE account_id = ? AND role = ? AND revoked_at IS NULL`,
          )
          .bind(input.actorId, now, input.accountId, role),
      );
    }
  }
  statements.push(
    auditStatement(d1, {
      actorId: input.actorId,
      action: 'editor.account.update',
      targetType: 'editor_account',
      targetId: input.accountId,
      reason,
      requestId: input.requestId,
      metadata: { status: input.status, roles },
      now,
    }),
  );
  await d1.batch(statements);
  return { updated: true };
}

export async function listOwnEditorSessions(accountId: string) {
  await ensureDatabase();
  const result = await getD1()
    .prepare(
      `SELECT id, issued_at, last_seen_at, idle_expires_at,
              absolute_expires_at, revoked_at
       FROM editor_sessions WHERE account_id = ?
       ORDER BY issued_at DESC LIMIT 20`,
    )
    .bind(accountId)
    .all<{
      id: string;
      issued_at: number;
      last_seen_at: number;
      idle_expires_at: number;
      absolute_expires_at: number;
      revoked_at: number | null;
    }>();
  return result.results.map((row) => ({
    id: row.id,
    issuedAt: Number(row.issued_at),
    lastSeenAt: Number(row.last_seen_at),
    idleExpiresAt: Number(row.idle_expires_at),
    absoluteExpiresAt: Number(row.absolute_expires_at),
    revokedAt: row.revoked_at === null ? null : Number(row.revoked_at),
  }));
}

export async function revokeOwnEditorSession(input: {
  accountId: string;
  sessionId: string;
  actorId: string;
  requestId: string;
}) {
  await ensureDatabase();
  const now = nowSeconds();
  const d1 = getD1();
  const result = await d1
    .prepare(
      `UPDATE editor_sessions
       SET revoked_at = ?, revoked_by = ?, revoke_reason = '编辑从安全设置撤销会话'
       WHERE id = ? AND account_id = ? AND revoked_at IS NULL`,
    )
    .bind(now, input.actorId, input.sessionId, input.accountId)
    .run();
  if (Number(result.meta.changes ?? 0) !== 1) {
    throw new AppError(
      404,
      'editor_session_not_found',
      '该会话已结束或不存在。',
    );
  }
  await d1
    .prepare(
      `INSERT INTO audit_events
        (id, actor_id, action, target_type, target_id, reason, request_id,
         metadata_json, created_at)
       VALUES (?, ?, 'editor.session.revoke', 'editor_session', ?,
               '编辑从安全设置撤销会话', ?, NULL, ?)`,
    )
    .bind(
      `audit-${crypto.randomUUID()}`,
      input.actorId,
      input.sessionId,
      input.requestId,
      now,
    )
    .run();
}

export async function revokeAllOwnEditorSessions(input: {
  accountId: string;
  actorId: string;
  requestId: string;
}) {
  await ensureDatabase();
  const now = nowSeconds();
  const d1 = getD1();
  await d1.batch([
    d1
      .prepare(
        `UPDATE editor_sessions
         SET revoked_at = ?, revoked_by = ?, revoke_reason = '编辑撤销全部会话'
         WHERE account_id = ? AND revoked_at IS NULL`,
      )
      .bind(now, input.actorId, input.accountId),
    auditStatement(d1, {
      actorId: input.actorId,
      action: 'editor.session.revoke_all',
      targetType: 'editor_account',
      targetId: input.accountId,
      reason: '编辑撤销全部活跃会话',
      requestId: input.requestId,
      now,
    }),
  ]);
}

export async function changeOwnEditorPassword(input: {
  user: LocalEditorUser;
  currentPassword: string;
  newPassword: string;
  mfaCode: string;
  requestId: string;
}) {
  if (input.user.legacy) {
    throw new AppError(409, 'legacy_account', '共享本地账号不能修改密码。');
  }
  const config = namedEditorSecrets();
  if (!config)
    throw new AppError(
      503,
      'editor_security_not_configured',
      '账号密钥未配置。',
    );
  try {
    validatePassword(input.newPassword);
  } catch {
    throw new AppError(400, 'password_too_short', '新密码至少需要 14 个字符。');
  }
  if (input.currentPassword === input.newPassword) {
    throw new AppError(400, 'password_unchanged', '新密码不能与当前密码相同。');
  }
  const d1 = getD1();
  const account = await d1
    .prepare(
      `SELECT a.password_salt, a.password_hash, a.password_iterations,
              f.id AS factor_id, f.encrypted_secret, f.last_used_counter
       FROM editor_accounts a
       JOIN editor_totp_factors f ON f.account_id = a.id AND f.revoked_at IS NULL
       WHERE a.id = ? AND a.status = 'active' LIMIT 1`,
    )
    .bind(input.user.userId)
    .first<{
      password_salt: string;
      password_hash: string;
      password_iterations: number;
      factor_id: string;
      encrypted_secret: string;
      last_used_counter: number | null;
    }>();
  if (
    !account ||
    !(await verifyPassword(input.currentPassword, config.passwordPepper, {
      salt: account.password_salt,
      hash: account.password_hash,
      iterations: Number(account.password_iterations),
    }))
  ) {
    throw new AppError(401, 'reauthentication_failed', '当前密码不正确。');
  }
  const secret = await decryptTotpSecret({
    encryptedSecret: account.encrypted_secret,
    encryptionKey: config.mfaKey,
    accountId: input.user.userId,
    factorId: account.factor_id,
  });
  const counter = await findValidTotpCounter({
    secret,
    code: input.mfaCode,
    lastUsedCounter: account.last_used_counter,
  });
  if (counter === null) {
    throw new AppError(401, 'reauthentication_failed', '双重验证码不正确。');
  }
  const replayGuard = await d1
    .prepare(
      `UPDATE editor_totp_factors SET last_used_counter = ?
       WHERE id = ? AND (last_used_counter IS NULL OR last_used_counter < ?)`,
    )
    .bind(counter, account.factor_id, counter)
    .run();
  if (Number(replayGuard.meta.changes ?? 0) !== 1) {
    throw new AppError(409, 'mfa_code_replayed', '该验证码已经使用。');
  }
  const credential = await createPasswordCredential(
    input.newPassword,
    config.passwordPepper,
  );
  const now = nowSeconds();
  await d1.batch([
    d1
      .prepare(
        `UPDATE editor_accounts
         SET password_salt = ?, password_hash = ?, password_iterations = ?,
             must_change_password = 0, session_version = session_version + 1,
             updated_at = ? WHERE id = ?`,
      )
      .bind(
        credential.salt,
        credential.hash,
        credential.iterations,
        now,
        input.user.userId,
      ),
    auditStatement(d1, {
      actorId: input.user.userId,
      action: 'editor.account.password_change',
      targetType: 'editor_account',
      targetId: input.user.userId,
      reason: '编辑完成重新验证并修改密码',
      requestId: input.requestId,
      now,
    }),
  ]);
}

export async function regenerateOwnRecoveryCodes(input: {
  user: LocalEditorUser;
  currentPassword: string;
  mfaCode: string;
  requestId: string;
}) {
  if (input.user.legacy) {
    throw new AppError(409, 'legacy_account', '共享本地账号没有恢复码。');
  }
  const config = namedEditorSecrets();
  if (!config) {
    throw new AppError(
      503,
      'editor_security_not_configured',
      '账号密钥未配置。',
    );
  }
  const d1 = getD1();
  const account = await d1
    .prepare(
      `SELECT a.password_salt, a.password_hash, a.password_iterations,
              f.id AS factor_id, f.encrypted_secret, f.last_used_counter
       FROM editor_accounts a
       JOIN editor_totp_factors f
         ON f.account_id = a.id AND f.revoked_at IS NULL
       WHERE a.id = ? AND a.status = 'active' LIMIT 1`,
    )
    .bind(input.user.userId)
    .first<{
      password_salt: string;
      password_hash: string;
      password_iterations: number;
      factor_id: string;
      encrypted_secret: string;
      last_used_counter: number | null;
    }>();
  if (
    !account ||
    !(await verifyPassword(input.currentPassword, config.passwordPepper, {
      salt: account.password_salt,
      hash: account.password_hash,
      iterations: Number(account.password_iterations),
    }))
  ) {
    throw new AppError(401, 'reauthentication_failed', '当前密码不正确。');
  }
  const secret = await decryptTotpSecret({
    encryptedSecret: account.encrypted_secret,
    encryptionKey: config.mfaKey,
    accountId: input.user.userId,
    factorId: account.factor_id,
  });
  const counter = await findValidTotpCounter({
    secret,
    code: input.mfaCode,
    lastUsedCounter: account.last_used_counter,
  });
  if (counter === null) {
    throw new AppError(401, 'reauthentication_failed', '双重验证码不正确。');
  }
  const replayGuard = await d1
    .prepare(
      `UPDATE editor_totp_factors SET last_used_counter = ?
       WHERE id = ? AND revoked_at IS NULL
         AND (last_used_counter IS NULL OR last_used_counter < ?)`,
    )
    .bind(counter, account.factor_id, counter)
    .run();
  if (Number(replayGuard.meta.changes ?? 0) !== 1) {
    throw new AppError(409, 'mfa_code_replayed', '该验证码已经使用。');
  }

  const codes = generateRecoveryCodes();
  const now = nowSeconds();
  const statements: D1PreparedStatement[] = [
    d1
      .prepare('DELETE FROM editor_recovery_codes WHERE account_id = ?')
      .bind(input.user.userId),
  ];
  for (const code of codes) {
    statements.push(
      d1
        .prepare(
          `INSERT INTO editor_recovery_codes
            (account_id, code_hash, created_at, used_at)
           VALUES (?, ?, ?, NULL)`,
        )
        .bind(
          input.user.userId,
          await sha256Hex(normalizeRecoveryCode(code)),
          now,
        ),
    );
  }
  statements.push(
    auditStatement(d1, {
      actorId: input.user.userId,
      action: 'editor.account.recovery_codes_regenerated',
      targetType: 'editor_account',
      targetId: input.user.userId,
      reason: '编辑重新验证后生成一组新的恢复码',
      requestId: input.requestId,
      now,
    }),
  );
  await d1.batch(statements);
  return { codes };
}

type NamedAccountRow = {
  id: string;
  email: string;
  display_name: string;
  password_salt: string;
  password_hash: string;
  password_iterations: number;
  status: string;
  session_version: number;
  must_change_password: number;
  failed_login_count: number;
  locked_until: number | null;
  factor_id: string | null;
  encrypted_secret: string | null;
  last_used_counter: number | null;
};

type NamedSessionRow = Pick<
  NamedAccountRow,
  | 'id'
  | 'email'
  | 'display_name'
  | 'status'
  | 'session_version'
  | 'must_change_password'
> & {
  session_id: string;
  last_seen_at: number;
  absolute_expires_at: number;
};

async function namedEditorUser(
  account: Pick<
    NamedAccountRow,
    'id' | 'email' | 'display_name' | 'must_change_password'
  >,
  sessionId: string,
): Promise<LocalEditorUser> {
  const grants = await getD1()
    .prepare(
      `SELECT role FROM editor_role_grants
       WHERE account_id = ? AND revoked_at IS NULL ORDER BY role`,
    )
    .bind(account.id)
    .all<{ role: string }>();
  const roles = grants.results
    .map((row) => row.role)
    .filter(isEditorRole) as EditorRole[];
  return {
    userId: account.id,
    sessionId,
    displayName: account.display_name,
    email: account.email,
    fullName: account.display_name,
    roles,
    permissions: permissionsForRoles(roles),
    mustChangePassword: Boolean(account.must_change_password),
    legacy: false,
  };
}

async function ensureBootstrapEditor() {
  if (await namedAccountExists()) return false;
  const config = namedEditorSecrets();
  const email = normalizeEditorEmail(
    getRuntimeValue('EDITOR_BOOTSTRAP_EMAIL') ?? '',
  );
  const displayName =
    getRuntimeValue('EDITOR_BOOTSTRAP_NAME')?.trim().slice(0, 80) ||
    '产品管理员';
  const password = getRuntimeValue('EDITOR_BOOTSTRAP_PASSWORD') ?? '';
  const totpSecret = (getRuntimeValue('EDITOR_BOOTSTRAP_TOTP_SECRET') ?? '')
    .trim()
    .toUpperCase();
  if (!config || !email || !password || !totpSecret) return false;
  if (
    !/^\S+@\S+\.\S+$/u.test(email) ||
    !/^[A-Z2-7]{16,128}$/u.test(totpSecret)
  ) {
    throw new AppError(
      503,
      'editor_bootstrap_invalid',
      '首个编辑账号配置无效。',
    );
  }
  let credential;
  try {
    credential = await createPasswordCredential(
      password,
      config.passwordPepper,
    );
  } catch {
    throw new AppError(
      503,
      'editor_bootstrap_invalid',
      '首个编辑账号密码至少需要 14 个字符。',
    );
  }
  const accountId = crypto.randomUUID();
  const factorId = crypto.randomUUID();
  const now = nowSeconds();
  const encryptedSecret = await encryptTotpSecret({
    secret: totpSecret,
    encryptionKey: config.mfaKey,
    accountId,
    factorId,
  });
  const d1 = getD1();
  const statements: D1PreparedStatement[] = [
    d1
      .prepare(
        `INSERT INTO editor_accounts
          (id, email, display_name, password_salt, password_hash,
           password_iterations, status, session_version, must_change_password,
           failed_login_count, locked_until, last_login_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', 1, 0, 0, NULL, NULL, ?, ?)`,
      )
      .bind(
        accountId,
        email,
        displayName,
        credential.salt,
        credential.hash,
        credential.iterations,
        now,
        now,
      ),
    d1
      .prepare(
        `INSERT INTO editor_totp_factors
          (id, account_id, label, encrypted_secret, key_version,
           last_used_counter, verified_at, revoked_at, created_at)
         VALUES (?, ?, 'Authenticator', ?, 1, NULL, ?, NULL, ?)`,
      )
      .bind(factorId, accountId, encryptedSecret, now, now),
  ];
  for (const role of EDITOR_ROLES) {
    statements.push(
      d1
        .prepare(
          `INSERT INTO editor_role_grants
            (account_id, role, granted_by, granted_at, revoked_by, revoked_at)
           VALUES (?, ?, 'system:bootstrap', ?, NULL, NULL)`,
        )
        .bind(accountId, role, now),
    );
  }
  statements.push(
    auditStatement(d1, {
      actorId: 'system:bootstrap',
      action: 'editor.account.bootstrap',
      targetType: 'editor_account',
      targetId: accountId,
      reason: '创建首个具名管理员账号',
      requestId: crypto.randomUUID(),
      metadata: { roles: EDITOR_ROLES },
      now,
    }),
  );
  try {
    await d1.batch(statements);
    return true;
  } catch (error) {
    if (await namedAccountExists()) return false;
    throw error;
  }
}

async function recordFailedLogin(
  account: NamedAccountRow,
  reason: string,
  requestId?: string,
) {
  const now = nowSeconds();
  const nextCount = Number(account.failed_login_count) + 1;
  const lockedUntil = nextCount >= 8 ? now + 15 * 60 : null;
  const d1 = getD1();
  await d1.batch([
    d1
      .prepare(
        `UPDATE editor_accounts
         SET failed_login_count = ?, locked_until = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(nextCount, lockedUntil, now, account.id),
    auditStatement(d1, {
      actorId: account.id,
      action: 'editor.session.login_failed',
      targetType: 'editor_account',
      targetId: account.id,
      reason: '编辑登录验证失败',
      requestId: requestId ?? crypto.randomUUID(),
      metadata: { reason, locked: lockedUntil !== null },
      now,
    }),
  ]);
}

async function burnLoginTiming(password: string, pepper: string) {
  await verifyPassword(password || 'invalid-password', pepper, {
    salt: 'p_Ef7thkxdhWzLnCGLf39A',
    hash: 'V-d9gTgKH3i8BkMUv9VnuOHxQBI4dRSPI7KeTYP1nXQ',
    iterations: 600_000,
  });
}

async function namedAccountExists() {
  const row = await getD1()
    .prepare('SELECT 1 AS present FROM editor_accounts LIMIT 1')
    .first<{ present: number }>();
  return Boolean(row);
}

function namedEditorSecrets() {
  const passwordPepper =
    getRuntimeValue('EDITOR_PASSWORD_PEPPER')?.trim() ?? '';
  const mfaKey = getRuntimeValue('EDITOR_MFA_KEY_V1')?.trim() ?? '';
  if (
    passwordPepper.length < 32 ||
    mfaKey.length < 32 ||
    passwordPepper === mfaKey
  ) {
    return null;
  }
  return { passwordPepper, mfaKey };
}

async function createLegacyEditorSession(loginSecret: string) {
  const config = legacyEditorSecrets();
  if (!config) {
    throw new AppError(
      503,
      'editor_login_not_configured',
      '编辑登录尚未配置。',
    );
  }
  if (!(await secretsMatch(config.login, loginSecret))) {
    throw new AppError(401, 'invalid_editor_credentials', '编辑口令不正确。');
  }
  const expiresAt = nowSeconds() + ABSOLUTE_SESSION_SECONDS;
  const nonce = randomToken(16);
  const payload = `${expiresAt}.${nonce}`;
  const signature = await legacySign(config.session, payload);
  return {
    token: `es1_${payload}.${signature}`,
    expiresAt,
    user: await legacyEditorUser(config.session),
  };
}

async function verifyLegacyEditorToken(token: string) {
  const config = legacyEditorSecrets();
  if (!config) return null;
  const match =
    /^es1_([0-9]{10})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/u.exec(token);
  if (!match || Number(match[1]) <= nowSeconds()) return null;
  const expected = await legacySign(config.session, `${match[1]}.${match[2]}`);
  if (!(await secretsMatch(expected, match[3]))) return null;
  return legacyEditorUser(config.session);
}

function legacyEditorSecrets() {
  if (getRuntimeValue('EDITOR_ENABLE_LEGACY_LOGIN') !== 'true') return null;
  const login = getRuntimeValue('EDITOR_LOGIN_SECRET')?.trim() ?? '';
  const session = getRuntimeValue('EDITOR_SESSION_SECRET')?.trim() ?? '';
  if (login.length < 32 || session.length < 32 || login === session)
    return null;
  return { login, session };
}

async function legacyEditorUser(
  sessionSecret: string,
): Promise<LocalEditorUser> {
  const actor = (await legacySign(sessionSecret, 'editor-actor-v1')).slice(
    0,
    16,
  );
  const roles = [...EDITOR_ROLES];
  return {
    userId: `local-editor:${actor}`,
    sessionId: null,
    displayName: '本地演示编辑',
    email: 'local-editor@app',
    fullName: '本地演示编辑',
    roles,
    permissions: permissionsForRoles(roles),
    mustChangePassword: false,
    legacy: true,
  };
}

async function legacySign(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(value),
  );
  let binary = '';
  for (const byte of new Uint8Array(signature))
    binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

function auditStatement(
  d1: D1Database,
  input: {
    actorId: string;
    action: string;
    targetType: string;
    targetId: string;
    reason: string;
    requestId: string;
    metadata?: Record<string, unknown>;
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
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.now,
    );
}

function humanInitialPassword() {
  return `${randomToken(9)}-${randomToken(9)}-A7!`;
}

function normalizeRecoveryCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z2-7]/gu, '');
}

function readCookie(cookieHeader: string, name: string) {
  for (const item of cookieHeader.split(';')) {
    const [candidate, ...rest] = item.trim().split('=');
    if (candidate !== name) continue;
    try {
      return decodeURIComponent(rest.join('='));
    } catch {
      return null;
    }
  }
  return null;
}

function nowSeconds() {
  return Math.floor(Date.now() / 1_000);
}
