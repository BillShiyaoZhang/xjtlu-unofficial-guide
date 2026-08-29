import { getEditorUser } from '@/lib/authz';
import { AppError } from '@/lib/errors';
import { assertSameOrigin } from '@/lib/http';
import {
  queryPrincipal,
  recordMeasuredSearch,
  recordMeasuredSearchError,
} from '@/lib/measurement';
import { errorResponse } from '@/lib/mutations';
import { getPilotSessionFromRequest } from '@/lib/pilot';
import { sealSearchView } from '@/lib/pilot-crypto';
import { enforceRateLimit } from '@/lib/rate-limit';
import { listScopes, listTopics, searchAnswerCards } from '@/lib/repository';

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  let appFormRequest = false;
  try {
    assertSameOrigin(request);
    const contentType = request.headers.get('content-type') ?? '';
    if (
      !contentType.includes('application/x-www-form-urlencoded') &&
      !contentType.includes('multipart/form-data')
    ) {
      throw new AppError(415, 'form_required', '搜索请求必须来自应用内表单。');
    }
    appFormRequest = true;
    await enforceRateLimit(request, 'measured-search', 60, 600);
    const announcedLength = Number(request.headers.get('content-length') ?? 0);
    if (announcedLength > 12_000) {
      throw new AppError(413, 'payload_too_large', '搜索请求过大。');
    }
    const form = await request.formData();
    const query = String(form.get('q') ?? '')
      .trim()
      .slice(0, 160);
    if (!query) {
      return redirectTo(request, '/search');
    }

    const clearFilters = form.get('action') === 'clear';
    const requestedTopic = clearFilters
      ? ''
      : String(form.get('topic') ?? '').slice(0, 100);
    const requestedScopes = clearFilters
      ? []
      : form
          .getAll('scope')
          .filter((item): item is string => typeof item === 'string');
    const [topics, scopes, session, editorUser] = await Promise.all([
      listTopics(),
      listScopes(),
      getPilotSessionFromRequest(request),
      getEditorUser(),
    ]);
    const topic = topics.some((item) => item.slug === requestedTopic)
      ? requestedTopic
      : '';
    const validScopes = new Set(scopes.map((item) => item.id));
    const scopeIds = [
      ...new Set(requestedScopes.filter((item) => validScopes.has(item))),
    ].slice(0, 8);
    const principal = queryPrincipal(session, Boolean(editorUser));
    const existingQueryEventId =
      form.get('intent') === 'refine' || clearFilters
        ? String(form.get('queryEventId') ?? '')
        : null;
    let cards;
    try {
      cards = await searchAnswerCards({
        query,
        topicSlug: topic || undefined,
        scopeIds,
      });
    } catch {
      try {
        await recordMeasuredSearchError({
          query,
          topic,
          scopeIds,
          principal,
          existingQueryEventId,
        });
      } catch {
        // A retrieval-wide storage outage can also prevent recording the error.
      }
      return redirectTo(request, '/search?error=retrieval');
    }
    const queryEventId = await recordMeasuredSearch({
      query,
      topic,
      scopeIds,
      cards,
      principal,
      existingQueryEventId,
    });
    const view = await sealSearchView({
      query,
      topic,
      scopeIds,
      queryEventId,
      ownerSessionId: session?.id ?? null,
    });
    return redirectTo(request, `/search?v=${encodeURIComponent(view)}`);
  } catch (error) {
    if (appFormRequest) {
      const reason =
        error instanceof AppError
          ? error.code === 'rate_limited'
            ? 'rate'
            : error.status >= 500
              ? 'unavailable'
              : 'invalid'
          : 'unavailable';
      return redirectTo(request, `/search?error=${reason}`);
    }
    return errorResponse(error, requestId);
  }
}

function redirectTo(request: Request, path: string) {
  const headers = new Headers({
    Location: new URL(path, request.url).toString(),
    'Cache-Control': 'private, no-store',
  });
  return new Response(null, { status: 303, headers });
}
