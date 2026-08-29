import { getEditorApiAuth } from '@/lib/authz';
import { saveCatalogTopic } from '@/lib/editor-catalog';
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
      readJsonBody(request, 12_000),
    ]);
    const result = await saveCatalogTopic({
      id,
      slug: typeof body.slug === 'string' ? body.slug : '',
      titleZh: typeof body.titleZh === 'string' ? body.titleZh : '',
      titleEn: typeof body.titleEn === 'string' ? body.titleEn : null,
      description: typeof body.description === 'string' ? body.description : '',
      status: body.status === 'hidden' ? 'hidden' : 'active',
      aliases: Array.isArray(body.aliases)
        ? body.aliases.filter(
            (item): item is string => typeof item === 'string',
          )
        : [],
      actorId: auth.user.userId,
      requestId,
    });
    return noStoreJson({ data: result, request_id: requestId });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
