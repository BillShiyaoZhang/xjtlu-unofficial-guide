import { noStoreJson, readJsonBody } from '@/lib/http';
import { assertMaintenanceBearer } from '@/lib/internal-auth';
import { errorResponse } from '@/lib/mutations';
import { recordRecoveryDrill } from '@/lib/operations';

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    await assertMaintenanceBearer(request);
    const body = await readJsonBody(request, 8_000);
    if (!['running', 'succeeded', 'failed'].includes(String(body.status))) {
      return noStoreJson(
        {
          error: { code: 'invalid_drill_status', message: '演练状态无效。' },
          request_id: requestId,
        },
        { status: 400 },
      );
    }
    const result = await recordRecoveryDrill({
      id: typeof body.id === 'string' ? body.id : undefined,
      backupRunId:
        typeof body.backupRunId === 'string' ? body.backupRunId : null,
      status: body.status as 'running' | 'succeeded' | 'failed',
      startedAt: Number(body.startedAt),
      completedAt: body.completedAt == null ? null : Number(body.completedAt),
      foreignKeyCheckPassed:
        typeof body.foreignKeyCheckPassed === 'boolean'
          ? body.foreignKeyCheckPassed
          : null,
      smokeCheckPassed:
        typeof body.smokeCheckPassed === 'boolean'
          ? body.smokeCheckPassed
          : null,
      details:
        body.details &&
        typeof body.details === 'object' &&
        !Array.isArray(body.details)
          ? (body.details as Record<string, unknown>)
          : undefined,
    });
    return noStoreJson({ data: result, request_id: requestId });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
