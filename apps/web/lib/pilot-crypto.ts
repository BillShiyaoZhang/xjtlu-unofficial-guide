import { getRuntimeValue } from '@/db';

import { AppError } from './errors';
import { isUuid } from './pilot-contract';

export { isUuid, PILOT_NOTICE_VERSION } from './pilot-contract';

export const PILOT_COOKIE_NAME = '__Host-xg_pilot';

export type SearchView = {
  query: string;
  topic: string;
  scopeIds: string[];
  queryEventId: string;
  ownerSessionId?: string | null;
};

const SEARCH_VIEW_MAX_AGE_SECONDS = 60 * 60;

export function requirePilotSecret(): string {
  const secret = getRuntimeValue('PILOT_SECRET')?.trim() ?? '';
  if (secret.length < 32) {
    throw new AppError(
      503,
      'pilot_not_configured',
      '试点会话尚未配置，请联系编辑人员。',
    );
  }
  return secret;
}

export async function hmacHex(label: string, value: string): Promise<string> {
  const signature = await hmacBytes(label, value);
  return [...signature]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function derivePilotSessionToken(
  inviteCode: string,
): Promise<string> {
  return `ps1_${toBase64Url(await hmacBytes('pilot-session-v1', inviteCode))}`;
}

export async function sealSearchView(view: SearchView): Promise<string> {
  const key = await searchViewKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(
    JSON.stringify({ ...view, issuedAt: nowSeconds() }),
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext,
  );
  return `sv1_${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`;
}

export async function openSearchView(
  value: string,
  ownerSessionId: string | null = null,
): Promise<SearchView | null> {
  const match = /^sv1_([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{20,1200})$/u.exec(
    value,
  );
  if (!match) return null;
  try {
    const key = await searchViewKey();
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64Url(match[1]) },
      key,
      fromBase64Url(match[2]),
    );
    const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as Record<
      string,
      unknown
    >;
    const query = typeof parsed.query === 'string' ? parsed.query : '';
    const topic = typeof parsed.topic === 'string' ? parsed.topic : '';
    const scopeIds = Array.isArray(parsed.scopeIds)
      ? parsed.scopeIds.filter(
          (item): item is string => typeof item === 'string',
        )
      : [];
    const queryEventId =
      typeof parsed.queryEventId === 'string' ? parsed.queryEventId : '';
    const sealedOwner =
      typeof parsed.ownerSessionId === 'string'
        ? parsed.ownerSessionId
        : parsed.ownerSessionId === null || parsed.ownerSessionId === undefined
          ? null
          : 'invalid';
    const issuedAt = Number(parsed.issuedAt);
    const now = nowSeconds();
    if (
      !query ||
      query.length > 160 ||
      topic.length > 100 ||
      scopeIds.length > 8 ||
      !isUuid(queryEventId) ||
      !Number.isInteger(issuedAt) ||
      issuedAt > now + 300 ||
      issuedAt < now - SEARCH_VIEW_MAX_AGE_SECONDS ||
      (sealedOwner !== null && !isUuid(sealedOwner)) ||
      (sealedOwner !== null && sealedOwner !== ownerSessionId)
    ) {
      return null;
    }
    return {
      query,
      topic,
      scopeIds,
      queryEventId,
      ownerSessionId: sealedOwner,
    };
  } catch {
    return null;
  }
}

export function pilotCookieHeader(token: string, maxAgeSeconds: number) {
  return `${PILOT_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearPilotCookieHeader() {
  return `${PILOT_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

export function readPilotCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name !== PILOT_COOKIE_NAME) continue;
    try {
      const value = decodeURIComponent(rest.join('='));
      return /^ps1_[A-Za-z0-9_-]{43}$/u.test(value) ? value : null;
    } catch {
      return null;
    }
  }
  return null;
}

async function hmacBytes(label: string, value: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(requirePilotSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signed = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${label}\0${value}`),
  );
  return new Uint8Array(signed);
}

async function searchViewKey() {
  const material = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`search-view-v1\0${requirePilotSecret()}`),
  );
  return crypto.subtle.importKey('raw', material, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

function toBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

function fromBase64Url(value: string) {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(normalized + padding);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function nowSeconds() {
  return Math.floor(Date.now() / 1_000);
}
