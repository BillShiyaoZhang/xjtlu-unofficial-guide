import { assertSameOrigin, noStoreJson, readJsonBody } from '@/lib/http';
import { errorResponse, submitFeedback } from '@/lib/mutations';
import { getPilotSessionFromRequest } from '@/lib/pilot';
import { enforceRateLimit } from '@/lib/rate-limit';

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    await enforceRateLimit(request, 'feedback-write', 30, 600);
    const body = (await readJsonBody(request, 4_000)) as Record<
      string,
      unknown
    >;
    const result = await submitFeedback({
      cardRevisionId:
        typeof body.cardRevisionId === 'string' ? body.cardRevisionId : '',
      queryEventId:
        typeof body.queryEventId === 'string' ? body.queryEventId : null,
      pilotSession: await getPilotSessionFromRequest(request),
      outcome: body.outcome,
      idempotencyKey: request.headers.get('idempotency-key'),
    });
    return noStoreJson(
      { data: result.data, replayed: result.replayed, request_id: requestId },
      { status: result.replayed ? 200 : 201 },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
