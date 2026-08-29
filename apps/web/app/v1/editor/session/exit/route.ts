import {
  clearEditorCookieHeader,
  revokeEditorSessionFromCookie,
} from '@/lib/editor-session';
import { assertSameOrigin, noStoreJson, readJsonBody } from '@/lib/http';
import { errorResponse } from '@/lib/mutations';

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    await readJsonBody(request, 1_000);
    await revokeEditorSessionFromCookie(
      request.headers.get('cookie'),
      requestId,
    );
    return noStoreJson(
      { data: { authenticated: false }, request_id: requestId },
      { headers: { 'Set-Cookie': clearEditorCookieHeader() } },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
