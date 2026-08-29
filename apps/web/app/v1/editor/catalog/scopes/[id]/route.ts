import { getEditorApiAuth } from '@/lib/authz';
import { saveCatalogScope } from '@/lib/editor-catalog';
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
  const auth = await getEditorApiAuth('content:edit');
  if (!auth.ok) return editorAuthResponse(auth);
  try {
    assertSameOrigin(request);
    const [{ id }, body] = await Promise.all([
      context.params,
      readJsonBody(request, 8_000),
    ]);
    const result = await saveCatalogScope({
      id,
      dimension: typeof body.dimension === 'string' ? body.dimension : '',
      code: typeof body.code === 'string' ? body.code : '',
      labelZh: typeof body.labelZh === 'string' ? body.labelZh : '',
      labelEn: typeof body.labelEn === 'string' ? body.labelEn : null,
      sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : 0,
      status: body.status === 'hidden' ? 'hidden' : 'active',
      actorId: auth.user.userId,
      requestId,
    });
    return noStoreJson({ data: result, request_id: requestId });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
