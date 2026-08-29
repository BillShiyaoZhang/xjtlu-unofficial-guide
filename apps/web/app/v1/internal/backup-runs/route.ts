import { noStoreJson, readJsonBody } from '@/lib/http';
import { assertMaintenanceBearer } from '@/lib/internal-auth';
import { errorResponse } from '@/lib/mutations';
import { recordBackupEvidence } from '@/lib/operations';

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    await assertMaintenanceBearer(request);
    const body = await readJsonBody(request, 8_000);
    if (!['running', 'succeeded', 'failed'].includes(String(body.status))) {
      return noStoreJson(
        {
          error: { code: 'invalid_backup_status', message: '备份状态无效。' },
          request_id: requestId,
        },
        { status: 400 },
      );
    }
    const result = await recordBackupEvidence({
      id: typeof body.id === 'string' ? body.id : undefined,
      status: body.status as 'running' | 'succeeded' | 'failed',
      snapshotReference:
        typeof body.snapshotReference === 'string'
          ? body.snapshotReference
          : null,
      checksumSha256:
        typeof body.checksumSha256 === 'string' ? body.checksumSha256 : null,
      startedAt: Number(body.startedAt),
      completedAt: body.completedAt == null ? null : Number(body.completedAt),
      expiresAt: body.expiresAt == null ? null : Number(body.expiresAt),
      verifiedAt: body.verifiedAt == null ? null : Number(body.verifiedAt),
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
