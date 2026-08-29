import { getEditorApiAuth } from '@/lib/authz';
import {
  isEditorRole,
  listEditorAccounts,
  provisionEditorAccount,
} from '@/lib/editor-session';
import {
  assertSameOrigin,
  editorAuthResponse,
  noStoreJson,
  readJsonBody,
} from '@/lib/http';
import { errorResponse } from '@/lib/mutations';
import { enforceRateLimit } from '@/lib/rate-limit';

export async function GET() {
  const auth = await getEditorApiAuth('accounts:manage');
  if (!auth.ok) return editorAuthResponse(auth);
  return noStoreJson({
    data: await listEditorAccounts(),
    request_id: crypto.randomUUID(),
  });
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const auth = await getEditorApiAuth('accounts:manage');
  if (!auth.ok) return editorAuthResponse(auth);
  try {
    assertSameOrigin(request);
    await enforceRateLimit(request, 'editor-account-create', 10, 3_600);
    const body = await readJsonBody(request, 8_000);
    const roles = Array.isArray(body.roles)
      ? body.roles.filter(isEditorRole)
      : [];
    const result = await provisionEditorAccount({
      email: typeof body.email === 'string' ? body.email : '',
      displayName: typeof body.displayName === 'string' ? body.displayName : '',
      roles,
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
