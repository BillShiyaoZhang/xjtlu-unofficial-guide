import { getEditorApiAuth } from '@/lib/authz';
import { editorAuthResponse, noStoreJson } from '@/lib/http';
import { getEditorDashboard } from '@/lib/repository';

export async function GET() {
  const auth = await getEditorApiAuth();
  if (!auth.ok) return editorAuthResponse(auth);
  return noStoreJson({
    data: await getEditorDashboard(auth.user.userId),
    request_id: crypto.randomUUID(),
  });
}
