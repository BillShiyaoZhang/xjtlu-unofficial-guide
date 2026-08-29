import { getEditorApiAuth } from '@/lib/authz';
import {
  assertSameOrigin,
  editorAuthResponse,
  noStoreJson,
  readJsonBody,
} from '@/lib/http';
import { errorResponse } from '@/lib/mutations';
import { createPilotInvitation } from '@/lib/pilot';
import { enforceRateLimit } from '@/lib/rate-limit';

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const auth = await getEditorApiAuth();
  if (!auth.ok) return editorAuthResponse(auth);
  try {
    assertSameOrigin(request);
    await enforceRateLimit(request, 'pilot-invitation-issue', 20, 600);
    const body = await readJsonBody(request, 8_000);
    const result = await createPilotInvitation({
      inviteCode: typeof body.inviteCode === 'string' ? body.inviteCode : '',
      participantRef:
        typeof body.participantRef === 'string' ? body.participantRef : '',
      mode: body.mode,
      recruitmentChannel: body.recruitmentChannel,
      isTest: body.isTest === true,
      adultVerified: body.adultVerified === true,
      actorId: auth.user.userId,
    });
    return noStoreJson(
      {
        data: result.invitation,
        replayed: result.replayed,
        request_id: requestId,
      },
      { status: result.replayed ? 200 : 201 },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
