import { readJsonBody } from './http';
import { errorResponse, submitResearchIntake } from './mutations';
import { enforceRateLimit } from './rate-limit';

export async function handleResearchIntakeRequest(
  request: Request,
  forcedKind?: 'question' | 'material',
) {
  const requestId = crypto.randomUUID();
  try {
    enforceRateLimit(request, 'research-intake-write', 8, 600);
    const body = (await readJsonBody(request, 16_000)) as Record<
      string,
      unknown
    >;
    const result = await submitResearchIntake({
      inviteSecret:
        typeof body.inviteSecret === 'string' ? body.inviteSecret : '',
      participantRef:
        typeof body.participantRef === 'string' ? body.participantRef : '',
      adultAttested: body.adultAttested === true,
      kind: forcedKind ?? body.kind,
      contextScope:
        typeof body.contextScope === 'string' ? body.contextScope : '',
      body: typeof body.body === 'string' ? body.body : null,
      sourceUrl: typeof body.sourceUrl === 'string' ? body.sourceUrl : null,
      provenanceRole:
        typeof body.provenanceRole === 'string' ? body.provenanceRole : null,
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
