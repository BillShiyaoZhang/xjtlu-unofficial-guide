import { assertSameOrigin, noStoreJson, readJsonBody } from '@/lib/http';
import { errorResponse } from '@/lib/mutations';
import {
  getPilotWithdrawalSubject,
  getPilotSessionFromRequest,
  withdrawPilotParticipation,
} from '@/lib/pilot';
import { clearPilotCookieHeader } from '@/lib/pilot-crypto';
import { enforceRateLimit } from '@/lib/rate-limit';

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const body = await readJsonBody(request, 2_000);
    if (body.confirm !== 'withdraw') {
      return noStoreJson(
        {
          error: {
            code: 'withdrawal_confirmation_required',
            message: '撤回操作需要明确确认。',
          },
          request_id: requestId,
        },
        { status: 400 },
      );
    }
    const session = await getPilotSessionFromRequest(request);
    const subject = session
      ? {
          participantId: session.participantId,
          actorId: `pilot-session:${session.id}`,
        }
      : await (async () => {
          await enforceRateLimit(request, 'pilot-withdrawal-code', 8, 600);
          return getPilotWithdrawalSubject(
            typeof body.inviteCode === 'string' ? body.inviteCode : '',
          );
        })();
    await withdrawPilotParticipation(subject);
    const headers = new Headers({
      'Set-Cookie': clearPilotCookieHeader(),
    });
    return noStoreJson(
      { data: { withdrawn: true }, request_id: requestId },
      { headers },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
