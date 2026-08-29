import { assertSameOrigin, noStoreJson } from '@/lib/http';
import { errorResponse } from '@/lib/mutations';
import { exitPilotSession, getPilotSessionFromRequest } from '@/lib/pilot';
import { clearPilotCookieHeader } from '@/lib/pilot-crypto';

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const session = await getPilotSessionFromRequest(request);
    if (session) await exitPilotSession(session);
    const headers = new Headers({
      'Set-Cookie': clearPilotCookieHeader(),
    });
    return noStoreJson(
      { data: { active: false }, request_id: requestId },
      { headers },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
