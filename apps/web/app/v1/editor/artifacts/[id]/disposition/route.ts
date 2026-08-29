import { getEditorApiAuth } from '@/lib/authz';
import {
  setArtifactDisposition,
  type CatalogArtifact,
} from '@/lib/editor-catalog';
import {
  assertSameOrigin,
  editorAuthResponse,
  noStoreJson,
  readJsonBody,
} from '@/lib/http';
import { errorResponse } from '@/lib/mutations';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = crypto.randomUUID();
  const auth = await getEditorApiAuth('content:visibility');
  if (!auth.ok) return editorAuthResponse(auth);
  try {
    assertSameOrigin(request);
    const [{ id }, body] = await Promise.all([
      context.params,
      readJsonBody(request, 4_000),
    ]);
    const result = await setArtifactDisposition({
      artifactId: id,
      status: String(body.status) as CatalogArtifact['status'],
      reason: typeof body.reason === 'string' ? body.reason : '',
      actorId: auth.user.userId,
      requestId,
    });
    return noStoreJson({ data: result, request_id: requestId });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
