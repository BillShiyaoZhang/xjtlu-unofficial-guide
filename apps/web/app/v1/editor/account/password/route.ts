import { getEditorApiAuth } from '@/lib/authz';
import {
  changeOwnEditorPassword,
  clearEditorCookieHeader,
} from '@/lib/editor-session';
import {
  assertSameOrigin,
  editorAuthResponse,
  noStoreJson,
  readJsonBody,
} from '@/lib/http';
import { errorResponse } from '@/lib/mutations';
import { enforceRateLimit } from '@/lib/rate-limit';

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const auth = await getEditorApiAuth();
  if (!auth.ok) return editorAuthResponse(auth);
  try {
    assertSameOrigin(request);
    await enforceRateLimit(request, 'editor-password-change', 6, 3_600);
    const body = await readJsonBody(request, 4_000);
    await changeOwnEditorPassword({
      user: auth.user,
      currentPassword:
        typeof body.currentPassword === 'string' ? body.currentPassword : '',
      newPassword: typeof body.newPassword === 'string' ? body.newPassword : '',
      mfaCode: typeof body.mfaCode === 'string' ? body.mfaCode : '',
      requestId,
    });
    return noStoreJson(
      { data: { changed: true, signInAgain: true }, request_id: requestId },
      { headers: { 'Set-Cookie': clearEditorCookieHeader() } },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
