import { getEditorApiAuth } from '@/lib/authz';
import {
  assertSameOrigin,
  editorAuthResponse,
  noStoreJson,
  parseIfMatch,
  readJsonBody,
} from '@/lib/http';
import { createAnswerCardRevision, errorResponse } from '@/lib/mutations';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = crypto.randomUUID();
  const auth = await getEditorApiAuth();
  if (!auth.ok) return editorAuthResponse(auth);
  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    const payload = await readJsonBody(request, 64_000);
    const result = await createAnswerCardRevision({
      cardId: id,
      expectedCardVersion: parseIfMatch(request),
      payload,
      actorId: auth.user.userId,
      idempotencyKey: request.headers.get('idempotency-key'),
    });
    return noStoreJson(
      {
        data: result.data,
        replayed: result.replayed,
        object_version: result.data.lockVersion,
        request_id: requestId,
      },
      { status: result.replayed ? 200 : 201 },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
