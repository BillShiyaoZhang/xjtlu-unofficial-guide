import { ensureDatabase } from '@/db/bootstrap';
import { getD1, getRuntimeValue } from '@/db';

import { AppError } from './errors';

export async function enforceRateLimit(
  request: Request,
  scope: string,
  limit: number,
  windowSeconds: number,
  identifier?: string,
) {
  await ensureDatabase();
  const now = Math.floor(Date.now() / 1_000);
  const source = identifier
    ? `identity:${identifier.trim().toLocaleLowerCase('en-US').slice(0, 254)}`
    : trustedClientIdentity(request);
  const keyHash = await bucketHash(scope, source);
  const row = await getD1()
    .prepare(
      `INSERT INTO rate_limit_windows
        (scope, key_hash, window_started_at, count, expires_at)
       VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(scope, key_hash) DO UPDATE SET
         window_started_at = CASE
           WHEN rate_limit_windows.expires_at <= excluded.window_started_at
           THEN excluded.window_started_at
           ELSE rate_limit_windows.window_started_at END,
         count = CASE
           WHEN rate_limit_windows.expires_at <= excluded.window_started_at
           THEN 1 ELSE rate_limit_windows.count + 1 END,
         expires_at = CASE
           WHEN rate_limit_windows.expires_at <= excluded.window_started_at
           THEN excluded.expires_at ELSE rate_limit_windows.expires_at END
       RETURNING count, expires_at`,
    )
    .bind(scope.slice(0, 100), keyHash, now, now + windowSeconds)
    .first<{ count: number; expires_at: number }>();
  if (!row) {
    throw new AppError(503, 'rate_limit_unavailable', '请求保护暂时不可用。');
  }
  if (Number(row.count) > limit) {
    throw new AppError(429, 'rate_limited', '请求过于频繁，请稍后再试。', {
      retryAfterSeconds: Math.max(1, Number(row.expires_at) - now),
    });
  }
}

function trustedClientIdentity(request: Request) {
  const cloudflareAddress = request.headers.get('cf-connecting-ip')?.trim();
  if (cloudflareAddress) return `cf:${cloudflareAddress.slice(0, 64)}`;
  return 'local-or-unattributed-client';
}

async function bucketHash(scope: string, value: string) {
  const secret =
    getRuntimeValue('EDITOR_RATE_LIMIT_SECRET')?.trim() ||
    getRuntimeValue('PILOT_SECRET')?.trim() ||
    'local-development-rate-limit-key';
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(`${scope}\0${value}`),
    ),
  );
  return [...signature.subarray(0, 20)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
