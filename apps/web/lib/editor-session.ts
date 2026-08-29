import { getRuntimeValue } from '@/db';

import { AppError } from './errors';

export const EDITOR_COOKIE_NAME = '__Host-xg_editor';
const EDITOR_SESSION_SECONDS = 8 * 3_600;

export type LocalEditorUser = {
  userId: string;
  displayName: string;
  email: string;
  fullName: string | null;
};

export async function createEditorSession(loginSecret: string) {
  const config = editorSecrets();
  if (!config) {
    throw new AppError(
      503,
      'editor_login_not_configured',
      '本地编辑登录尚未配置。',
    );
  }
  if (!(await secretsMatch(config.login, loginSecret))) {
    throw new AppError(401, 'invalid_editor_secret', '编辑口令不正确。');
  }
  const expiresAt = nowSeconds() + EDITOR_SESSION_SECONDS;
  const nonce = toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  const payload = `${expiresAt}.${nonce}`;
  const signature = await sign(config.session, payload);
  return {
    token: `es1_${payload}.${signature}`,
    expiresAt,
    user: await localEditorUser(config.session),
  };
}

export async function getLocalEditorFromCookieHeader(
  cookieHeader: string | null,
): Promise<LocalEditorUser | null> {
  const config = editorSecrets();
  if (!config || !cookieHeader) return null;
  const token = readCookie(cookieHeader, EDITOR_COOKIE_NAME);
  const match =
    /^es1_([0-9]{10})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/u.exec(
      token ?? '',
    );
  if (!match || Number(match[1]) <= nowSeconds()) return null;
  const expected = await sign(config.session, `${match[1]}.${match[2]}`);
  if (!(await secretsMatch(expected, match[3]))) return null;
  return localEditorUser(config.session);
}

export function editorCookieHeader(token: string, expiresAt: number) {
  return `${EDITOR_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${Math.max(0, expiresAt - nowSeconds())}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearEditorCookieHeader() {
  return `${EDITOR_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

export function editorLoginConfigured() {
  return editorSecrets() !== null;
}

export function editorLoginRequested() {
  return Boolean(
    getRuntimeValue('EDITOR_LOGIN_SECRET')?.trim() ||
    getRuntimeValue('EDITOR_SESSION_SECRET')?.trim(),
  );
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

function editorSecrets() {
  const login = getRuntimeValue('EDITOR_LOGIN_SECRET')?.trim() ?? '';
  const session = getRuntimeValue('EDITOR_SESSION_SECRET')?.trim() ?? '';
  if (login.length < 32 || session.length < 32 || login === session)
    return null;
  return { login, session };
}

async function localEditorUser(sessionSecret: string) {
  const actor = (await sign(sessionSecret, 'editor-actor-v1')).slice(0, 16);
  return {
    userId: `local-editor:${actor}`,
    displayName: '本地编辑',
    email: 'local-editor@app',
    fullName: '本地编辑',
  } satisfies LocalEditorUser;
}

async function sign(secret: string, value: string) {
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
  return toBase64Url(new Uint8Array(signature));
}

async function secretsMatch(expected: string, actual: string) {
  const [expectedDigest, actualDigest] = await Promise.all([
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(expected)),
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(actual)),
  ]);
  let difference = 0;
  const expectedBytes = new Uint8Array(expectedDigest);
  const actualBytes = new Uint8Array(actualDigest);
  for (let index = 0; index < expectedBytes.length; index += 1) {
    difference |= expectedBytes[index] ^ actualBytes[index];
  }
  return difference === 0;
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

function toBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

function nowSeconds() {
  return Math.floor(Date.now() / 1_000);
}
