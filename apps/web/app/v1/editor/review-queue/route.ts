import { getEditorApiAuth } from '@/lib/authz';
import { hasEditorPermission } from '@/lib/editor-session';
import { editorAuthResponse, noStoreJson } from '@/lib/http';
import { getEditorDashboard } from '@/lib/repository';

export async function GET() {
  const auth = await getEditorApiAuth();
  if (!auth.ok) return editorAuthResponse(auth);
  return noStoreJson({
    data: await getEditorDashboard(auth.user.userId, {
      content: hasEditorPermission(auth.user, 'content:read'),
      safety: hasEditorPermission(auth.user, 'safety:manage'),
      audit:
        hasEditorPermission(auth.user, 'operations:manage') ||
        hasEditorPermission(auth.user, 'accounts:manage'),
    }),
    request_id: crypto.randomUUID(),
  });
}
