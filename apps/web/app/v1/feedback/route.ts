import { readJsonBody } from '@/lib/http';
import { errorResponse, submitFeedback } from '@/lib/mutations';
import { enforceRateLimit } from '@/lib/rate-limit';

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    enforceRateLimit(request, 'feedback-write', 30, 600);
    const body = (await readJsonBody(request, 4_000)) as Record<
      string,
      unknown
    >;
    const result = await submitFeedback({
      cardRevisionId:
        typeof body.cardRevisionId === 'string' ? body.cardRevisionId : '',
      outcome: body.outcome,
      idempotencyKey: request.headers.get('idempotency-key'),
    });
    return Response.json(
      { data: result.data, replayed: result.replayed, request_id: requestId },
      { status: result.replayed ? 200 : 201 },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
