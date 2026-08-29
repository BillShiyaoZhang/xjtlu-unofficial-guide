import { getEditorApiAuth } from '@/lib/authz';
import {
  assertSameOrigin,
  editorAuthResponse,
  noStoreJson,
  parseIfMatch,
} from '@/lib/http';
import { errorResponse } from '@/lib/mutations';
import { revokePilotInvitation } from '@/lib/pilot';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = crypto.randomUUID();
  const auth = await getEditorApiAuth();
  if (!auth.ok) return editorAuthResponse(auth);
  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    const invitation = await revokePilotInvitation({
      invitationId: id,
      expectedVersion: parseIfMatch(request),
      actorId: auth.user.userId,
    });
    return noStoreJson({
      data: invitation,
      object_version: invitation.lockVersion,
      request_id: requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
