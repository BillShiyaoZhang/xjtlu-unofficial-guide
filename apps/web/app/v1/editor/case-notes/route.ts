import { getEditorApiAuth } from '@/lib/authz';
import { addCaseNote } from '@/lib/editor-cases';
import {
  assertSameOrigin,
  editorAuthResponse,
  noStoreJson,
  readJsonBody,
} from '@/lib/http';
import { errorResponse } from '@/lib/mutations';

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const auth = await getEditorApiAuth('safety:manage');
  if (!auth.ok) return editorAuthResponse(auth);
  try {
    assertSameOrigin(request);
    const body = await readJsonBody(request, 4_000);
    if (body.targetType !== 'report' && body.targetType !== 'research_intake') {
      return noStoreJson(
        {
          error: { code: 'invalid_case_type', message: '处置记录类型无效。' },
          request_id: requestId,
        },
        { status: 400 },
      );
    }
    const result = await addCaseNote({
      targetType: body.targetType,
      targetId: typeof body.targetId === 'string' ? body.targetId : '',
      body: typeof body.body === 'string' ? body.body : '',
      actorId: auth.user.userId,
      requestId,
    });
    return noStoreJson(
      { data: result, request_id: requestId },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
