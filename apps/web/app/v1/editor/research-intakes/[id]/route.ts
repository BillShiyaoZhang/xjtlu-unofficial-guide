import { getEditorApiAuth } from '@/lib/authz';
import {
  assertSameOrigin,
  editorAuthResponse,
  noStoreJson,
  parseIfMatch,
  readJsonBody,
} from '@/lib/http';
import { errorResponse, updateResearchIntake } from '@/lib/mutations';

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
    const body = await readJsonBody(request, 4_000);
    if (!['screening', 'actioned', 'rejected'].includes(String(body.status))) {
      return noStoreJson(
        {
          error: { code: 'invalid_status', message: '线索状态无效。' },
          request_id: requestId,
        },
        { status: 400 },
      );
    }
    const result = await updateResearchIntake({
      id,
      status: body.status as 'screening' | 'actioned' | 'rejected',
      actorId: auth.user.userId,
      expectedVersion: parseIfMatch(request),
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
