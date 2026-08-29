import { getEditorApiAuth } from '@/lib/authz';
import { saveCatalogPublisher } from '@/lib/editor-catalog';
import {
  assertSameOrigin,
  editorAuthResponse,
  noStoreJson,
  readJsonBody,
} from '@/lib/http';
import { errorResponse } from '@/lib/mutations';

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const auth = await getEditorApiAuth('content:edit');
  if (!auth.ok) return editorAuthResponse(auth);
  try {
    assertSameOrigin(request);
    const body = await readJsonBody(request, 8_000);
    const verificationStatus =
      body.verificationStatus === 'platform_owned' ||
      body.verificationStatus === 'source_verified'
        ? body.verificationStatus
        : 'unverified';
    const result = await saveCatalogPublisher({
      type: typeof body.type === 'string' ? body.type : '',
      nameZh: typeof body.nameZh === 'string' ? body.nameZh : '',
      nameEn: typeof body.nameEn === 'string' ? body.nameEn : null,
      canonicalUrl:
        typeof body.canonicalUrl === 'string' ? body.canonicalUrl : null,
      verificationStatus,
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
