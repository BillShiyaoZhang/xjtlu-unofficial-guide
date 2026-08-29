import { AppError } from './errors';

type WindowEntry = { count: number; resetAt: number };

const windows = new Map<string, WindowEntry>();
const clientSalt = crypto.getRandomValues(new Uint8Array(16));
let nextSweepAt = 0;

export async function enforceRateLimit(
  request: Request,
  scope: string,
  limit: number,
  windowSeconds: number,
) {
  const now = Date.now();
  if (now >= nextSweepAt) {
    for (const [key, entry] of windows) {
      if (entry.resetAt <= now) windows.delete(key);
    }
    nextSweepAt = now + 60_000;
  }

  const claimedClient =
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',', 1)[0]?.trim() ??
    'unknown-client';
  const client = await ephemeralClientFingerprint(claimedClient);
  const key = `${scope}:${client}`;
  const current = windows.get(key);
  if (!current || current.resetAt <= now) {
    if (!current && windows.size >= 2_048) {
      const oldest = windows.keys().next().value;
      if (oldest) windows.delete(oldest);
    }
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

async function ephemeralClientFingerprint(value: string) {
  const encoded = new TextEncoder().encode(value.slice(0, 256));
  const material = new Uint8Array(clientSalt.length + encoded.length);
  material.set(clientSalt);
  material.set(encoded, clientSalt.length);
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', material),
  );
  return [...digest.subarray(0, 16)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
