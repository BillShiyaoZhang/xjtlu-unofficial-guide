import { getEditorApiAuth } from '@/lib/authz';
import {
  assertSameOrigin,
  editorAuthResponse,
  noStoreJson,
  parseIfMatch,
  readJsonBody,
} from '@/lib/http';
import { errorResponse, setAnswerCardVisibility } from '@/lib/mutations';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = crypto.randomUUID();
  const auth = await getEditorApiAuth();
  if (!auth.ok) return editorAuthResponse(auth);
  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    const body = await readJsonBody(request, 8_000);
    if (body.status !== 'hidden' && body.status !== 'published') {
      return noStoreJson(
        {
          error: { code: 'invalid_status', message: '答案卡公开状态无效。' },
          request_id: requestId,
        },
        { status: 400 },
      );
    }
    const result = await setAnswerCardVisibility({
      cardId: id,
      status: body.status,
      reason: typeof body.reason === 'string' ? body.reason : '',
      expectedCardVersion: parseIfMatch(request),
      actorId: auth.user.userId,
      idempotencyKey: request.headers.get('idempotency-key'),
    });
    return noStoreJson({
      data: result.data,
      replayed: result.replayed,
      object_version: result.data.lockVersion,
      request_id: requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
