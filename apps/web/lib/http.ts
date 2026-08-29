import type { EditorAuthResult } from './authz';
import { AppError } from './errors.ts';

export async function readJsonBody(request: Request, maxBytes = 64_000) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLocaleLowerCase().includes('application/json')) {
    throw new AppError(415, 'json_required', '请求必须使用 application/json。');
  }
  const announcedLength = Number(request.headers.get('content-length') ?? 0);
  if (announcedLength > maxBytes) {
    throw new AppError(413, 'payload_too_large', '请求内容过大。');
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new AppError(413, 'payload_too_large', '请求内容过大。');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new AppError(400, 'invalid_json', '请求内容不是有效 JSON。');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AppError(400, 'invalid_payload', '请求内容必须是 JSON 对象。');
  }
  return parsed as Record<string, unknown>;
}

export function assertSameOrigin(request: Request) {
  if (request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new AppError(403, 'cross_site_rejected', '不接受跨站写请求。');
  }
  const origin = request.headers.get('origin');
  if (!origin) throw new AppError(403, 'origin_required', '缺少来源校验信息。');
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    throw new AppError(403, 'invalid_origin', '请求来源无效。');
  }
  if (originUrl.origin !== new URL(request.url).origin) {
    throw new AppError(403, 'cross_origin_rejected', '不接受跨站写请求。');
  }
}

export function parseIfMatch(request: Request): number {
  const value = request.headers.get('if-match')?.trim();
  if (!value)
    throw new AppError(428, 'if_match_required', '该操作需要 If-Match 版本。');
  const normalized = value.replace(/^W\//u, '').replace(/^"|"$/gu, '');
  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new AppError(
      400,
      'invalid_if_match',
      'If-Match 必须是非负整数版本。',
    );
  }
  return parsed;
}

export function editorAuthResponse(
  result: Exclude<EditorAuthResult, { ok: true }>,
) {
  const headers = new Headers({ 'Cache-Control': 'private, no-store' });
  return Response.json(
    {
      error: {
        code: result.code,
        message:
          result.status === 401
            ? '请先登录编辑工作台。'
            : '当前账号不在编辑白名单中。',
      },
      request_id: crypto.randomUUID(),
    },
    { status: result.status, headers },
  );
}

export function publicJson(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set(
    'Cache-Control',
    'public, max-age=30, stale-while-revalidate=120',
  );
  return Response.json(data, { ...init, headers });
}

export function noStoreJson(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set('Cache-Control', 'private, no-store');
  return Response.json(data, { ...init, headers });
}
