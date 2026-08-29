import { assertSameOrigin, noStoreJson, readJsonBody } from '@/lib/http';
import { recordAnswerOpen } from '@/lib/measurement';
import { errorResponse } from '@/lib/mutations';
import { getPilotSessionFromRequest } from '@/lib/pilot';
import { enforceRateLimit } from '@/lib/rate-limit';

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    await enforceRateLimit(request, 'answer-open-write', 120, 600);
    const body = await readJsonBody(request, 4_000);
    const recorded = await recordAnswerOpen({
      queryEventId:
        typeof body.queryEventId === 'string' ? body.queryEventId : '',
      cardRevisionId:
        typeof body.cardRevisionId === 'string' ? body.cardRevisionId : '',
      session: await getPilotSessionFromRequest(request),
    });
    return noStoreJson({
      data: { recorded },
      request_id: requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
