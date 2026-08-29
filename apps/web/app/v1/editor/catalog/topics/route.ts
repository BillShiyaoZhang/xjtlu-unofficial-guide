import { getEditorApiAuth } from '@/lib/authz';
import { saveCatalogTopic } from '@/lib/editor-catalog';
import {
  assertSameOrigin,
  editorAuthResponse,
  noStoreJson,
  readJsonBody,
} from '@/lib/http';
import { errorResponse } from '@/lib/mutations';

export async function POST(request: Request) {
  return save(request);
}

async function save(request: Request) {
  const requestId = crypto.randomUUID();
  const auth = await getEditorApiAuth('content:edit');
  if (!auth.ok) return editorAuthResponse(auth);
  try {
    assertSameOrigin(request);
    const body = await readJsonBody(request, 12_000);
    const result = await saveCatalogTopic({
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
    return noStoreJson(
      { data: result, request_id: requestId },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
