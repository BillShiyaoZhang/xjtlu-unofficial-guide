import { assertSameOrigin, noStoreJson, readJsonBody } from '@/lib/http';
import { errorResponse, submitReport } from '@/lib/mutations';
import { getPilotSessionFromRequest } from '@/lib/pilot';
import { enforceRateLimit } from '@/lib/rate-limit';

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    await enforceRateLimit(request, 'report-write', 10, 600);
    const body = (await readJsonBody(request, 4_000)) as Record<
      string,
      unknown
    >;
    const result = await submitReport({
      cardId: typeof body.cardId === 'string' ? body.cardId : null,
      type: body.type,
      affectedArea: body.affectedArea,
      pilotSession: await getPilotSessionFromRequest(request),
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
