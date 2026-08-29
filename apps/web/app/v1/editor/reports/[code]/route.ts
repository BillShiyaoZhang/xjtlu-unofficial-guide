import { getEditorApiAuth } from '@/lib/authz';
import {
  assertSameOrigin,
  editorAuthResponse,
  noStoreJson,
  parseIfMatch,
  readJsonBody,
} from '@/lib/http';
import { errorResponse, updateReport } from '@/lib/mutations';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ code: string }> },
) {
  const requestId = crypto.randomUUID();
  const auth = await getEditorApiAuth('safety:manage');
  if (!auth.ok) return editorAuthResponse(auth);
  try {
    assertSameOrigin(request);
    const { code } = await context.params;
    const body = await readJsonBody(request, 8_000);
    if (!['reviewing', 'resolved', 'closed'].includes(String(body.status))) {
      return noStoreJson(
        {
          error: { code: 'invalid_status', message: '报告状态无效。' },
          request_id: requestId,
        },
        { status: 400 },
      );
    }
    const result = await updateReport({
      publicCode: code,
      status: body.status as 'reviewing' | 'resolved' | 'closed',
      publicResponse:
        typeof body.publicResponse === 'string' ? body.publicResponse : null,
      decisionCode:
        typeof body.decisionCode === 'string' ? body.decisionCode : null,
      resolutionCardId:
        typeof body.resolutionCardId === 'string'
          ? body.resolutionCardId
          : null,
      resolutionRevisionId:
        typeof body.resolutionRevisionId === 'string'
          ? body.resolutionRevisionId
          : null,
      actorId: auth.user.userId,
      expectedVersion: parseIfMatch(request),
      idempotencyKey: request.headers.get('idempotency-key'),
      requestId,
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
