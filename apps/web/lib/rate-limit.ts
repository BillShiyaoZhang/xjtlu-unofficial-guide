import { AppError } from './errors';

type WindowEntry = { count: number; resetAt: number };

const windows = new Map<string, WindowEntry>();

export function enforceRateLimit(
  request: Request,
  scope: string,
  limit: number,
  windowSeconds: number,
) {
  const now = Date.now();
  if (windows.size > 2_048) {
    for (const [key, entry] of windows) {
      if (entry.resetAt <= now) windows.delete(key);
    }
  }

  const client =
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',', 1)[0]?.trim() ??
    'unknown-client';
  const key = `${scope}:${client}`;
  const current = windows.get(key);
  if (!current || current.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowSeconds * 1_000 });
    return;
  }
  if (current.count >= limit) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((current.resetAt - now) / 1_000),
    );
    throw new AppError(429, 'rate_limited', '请求过于频繁，请稍后再试。', {
      retryAfterSeconds,
    });
  }
  current.count += 1;
}
