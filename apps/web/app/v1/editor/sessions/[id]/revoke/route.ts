import { getEditorApiAuth } from '@/lib/authz';
import {
  clearEditorCookieHeader,
  revokeOwnEditorSession,
} from '@/lib/editor-session';
import {
  assertSameOrigin,
  editorAuthResponse,
  noStoreJson,
  readJsonBody,
} from '@/lib/http';
import { errorResponse } from '@/lib/mutations';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = crypto.randomUUID();
  const auth = await getEditorApiAuth();
  if (!auth.ok) return editorAuthResponse(auth);
  try {
    assertSameOrigin(request);
    await readJsonBody(request, 1_000);
    const { id } = await context.params;
    await revokeOwnEditorSession({
      accountId: auth.user.userId,
      sessionId: id,
      actorId: auth.user.userId,
      requestId,
    });
    return noStoreJson(
      { data: { revoked: true }, request_id: requestId },
      id === auth.user.sessionId
        ? { headers: { 'Set-Cookie': clearEditorCookieHeader() } }
        : undefined,
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
