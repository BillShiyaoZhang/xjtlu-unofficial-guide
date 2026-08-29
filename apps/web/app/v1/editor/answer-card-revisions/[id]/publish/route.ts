import { getEditorApiAuth } from '@/lib/authz';
import {
  assertSameOrigin,
  editorAuthResponse,
  noStoreJson,
  parseIfMatch,
  readJsonBody,
} from '@/lib/http';
import { errorResponse, publishAnswerCardRevision } from '@/lib/mutations';

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
    const body = (await readJsonBody(request, 8_000)) as Record<
      string,
      unknown
    >;
    const result = await publishAnswerCardRevision({
      revisionId: id,
      expectedCardVersion: parseIfMatch(request),
      reviewerId: auth.user.userId,
      reason: typeof body.reason === 'string' ? body.reason : '',
      idempotencyKey: request.headers.get('idempotency-key'),
    });
    return noStoreJson(
      {
        data: result.data,
        replayed: result.replayed,
        object_version: result.data.lockVersion,
        request_id: requestId,
      },
      { status: 200 },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
