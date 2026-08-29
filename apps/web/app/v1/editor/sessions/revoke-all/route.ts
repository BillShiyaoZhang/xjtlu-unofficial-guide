import { getEditorApiAuth } from '@/lib/authz';
import {
  clearEditorCookieHeader,
  revokeAllOwnEditorSessions,
} from '@/lib/editor-session';
import {
  assertSameOrigin,
  editorAuthResponse,
  noStoreJson,
  readJsonBody,
} from '@/lib/http';
import { errorResponse } from '@/lib/mutations';

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const auth = await getEditorApiAuth();
  if (!auth.ok) return editorAuthResponse(auth);
  try {
    assertSameOrigin(request);
    await readJsonBody(request, 1_000);
    await revokeAllOwnEditorSessions({
      accountId: auth.user.userId,
      actorId: auth.user.userId,
      requestId,
    });
    return noStoreJson(
      { data: { revoked: true }, request_id: requestId },
      { headers: { 'Set-Cookie': clearEditorCookieHeader() } },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
