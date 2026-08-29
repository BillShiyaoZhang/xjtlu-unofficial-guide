import { getEditorApiAuth } from '@/lib/authz';
import { isEditorRole, updateEditorAccount } from '@/lib/editor-session';
import {
  assertSameOrigin,
  editorAuthResponse,
  noStoreJson,
  readJsonBody,
} from '@/lib/http';
import { errorResponse } from '@/lib/mutations';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = crypto.randomUUID();
  const auth = await getEditorApiAuth('accounts:manage');
  if (!auth.ok) return editorAuthResponse(auth);
  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    const body = await readJsonBody(request, 8_000);
    if (body.status !== 'active' && body.status !== 'disabled') {
      return noStoreJson(
        {
          error: { code: 'invalid_account_status', message: '账号状态无效。' },
          request_id: requestId,
        },
        { status: 400 },
      );
    }
    const roles = Array.isArray(body.roles)
      ? body.roles.filter(isEditorRole)
      : [];
    const result = await updateEditorAccount({
      accountId: id,
      status: body.status,
      roles,
      actorId: auth.user.userId,
      requestId,
      reason: typeof body.reason === 'string' ? body.reason : '',
    });
    return noStoreJson({ data: result, request_id: requestId });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
