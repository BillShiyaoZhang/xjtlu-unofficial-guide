import { assertSameOrigin, noStoreJson, readJsonBody } from '@/lib/http';
import { errorResponse } from '@/lib/mutations';
import { getPilotSessionFromRequest, redeemPilotInvitation } from '@/lib/pilot';
import { pilotCookieHeader } from '@/lib/pilot-crypto';
import { enforceRateLimit } from '@/lib/rate-limit';

export async function GET(request: Request) {
  const session = await getPilotSessionFromRequest(request);
  return noStoreJson({
    data: session
      ? {
          active: true,
          expiresAt: new Date(session.expiresAt * 1_000).toISOString(),
          noticeVersion: session.noticeVersion,
          testSession: session.isTest,
        }
      : { active: false },
  });
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    await enforceRateLimit(request, 'pilot-session-redeem', 8, 600);
    const body = await readJsonBody(request, 8_000);
    const currentSession = await getPilotSessionFromRequest(request);
    const result = await redeemPilotInvitation({
      inviteCode: typeof body.inviteCode === 'string' ? body.inviteCode : '',
      noticeVersion: body.noticeVersion,
      accepted: body.accepted === true,
      currentSession,
    });
    const headers = new Headers();
    headers.set(
      'Set-Cookie',
      pilotCookieHeader(
        result.token,
        result.session.expiresAt - Math.floor(Date.now() / 1_000),
      ),
    );
    return noStoreJson(
      {
        data: {
          active: true,
          expiresAt: new Date(result.session.expiresAt * 1_000).toISOString(),
          noticeVersion: result.session.noticeVersion,
          testSession: result.session.isTest,
        },
        replayed: result.replayed,
        request_id: requestId,
      },
      { status: result.replayed ? 200 : 201, headers },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
