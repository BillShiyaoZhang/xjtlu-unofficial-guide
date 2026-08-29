import {
  createEditorSession,
  editorCookieHeader,
  parseEditorReturnTo,
} from '@/lib/editor-session';
import { assertSameOrigin, noStoreJson, readJsonBody } from '@/lib/http';
import { errorResponse } from '@/lib/mutations';
import { enforceRateLimit } from '@/lib/rate-limit';

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    await enforceRateLimit(request, 'editor-session-login', 8, 600);
    const body = await readJsonBody(request, 4_000);
    const result = await createEditorSession(
      typeof body.secret === 'string' ? body.secret : '',
    );
    const returnTo = parseEditorReturnTo(
      typeof body.returnTo === 'string' ? body.returnTo : undefined,
    );
    return noStoreJson(
      {
        data: { authenticated: true, returnTo },
        request_id: requestId,
      },
      {
        headers: {
          'Set-Cookie': editorCookieHeader(result.token, result.expiresAt),
        },
      },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
