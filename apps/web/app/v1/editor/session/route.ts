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
    if (typeof body.email === 'string' && body.email.trim()) {
      await enforceRateLimit(
        request,
        'editor-session-account',
        8,
        600,
        body.email,
      );
    }
    const result = await createEditorSession({
      email: typeof body.email === 'string' ? body.email : '',
      password: typeof body.password === 'string' ? body.password : '',
      mfaCode: typeof body.mfaCode === 'string' ? body.mfaCode : '',
      legacySecret: typeof body.secret === 'string' ? body.secret : '',
      requestId,
    });
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
