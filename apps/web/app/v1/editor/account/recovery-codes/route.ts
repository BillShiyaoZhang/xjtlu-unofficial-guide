import { getEditorApiAuth } from '@/lib/authz';
import { regenerateOwnRecoveryCodes } from '@/lib/editor-session';
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
    await enforceRateLimit(
      request,
      'editor-recovery-code-regenerate',
      4,
      3_600,
    );
    const body = await readJsonBody(request, 4_000);
    const result = await regenerateOwnRecoveryCodes({
      user: auth.user,
      currentPassword:
        typeof body.currentPassword === 'string' ? body.currentPassword : '',
      mfaCode: typeof body.mfaCode === 'string' ? body.mfaCode : '',
      requestId,
    });
    return noStoreJson({ data: result, request_id: requestId });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
