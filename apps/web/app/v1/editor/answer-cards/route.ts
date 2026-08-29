import { getEditorApiAuth } from '@/lib/authz';
import {
  assertSameOrigin,
  editorAuthResponse,
  noStoreJson,
  readJsonBody,
} from '@/lib/http';
import { createAnswerCardDraft, errorResponse } from '@/lib/mutations';

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const auth = await getEditorApiAuth();
  if (!auth.ok) return editorAuthResponse(auth);
  try {
    assertSameOrigin(request);
    const payload = await readJsonBody(request, 64_000);
    const result = await createAnswerCardDraft({
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
