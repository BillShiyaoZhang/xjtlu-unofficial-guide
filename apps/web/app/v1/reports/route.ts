import { readJsonBody } from '@/lib/http';
import { errorResponse, submitReport } from '@/lib/mutations';
import { enforceRateLimit } from '@/lib/rate-limit';

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    enforceRateLimit(request, 'report-write', 10, 600);
    const body = (await readJsonBody(request, 4_000)) as Record<
      string,
      unknown
    >;
    const result = await submitReport({
      cardId: typeof body.cardId === 'string' ? body.cardId : null,
      type: body.type,
      inviteSecret:
        typeof body.inviteSecret === 'string' ? body.inviteSecret : '',
      adultAttested: body.adultAttested === true,
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
