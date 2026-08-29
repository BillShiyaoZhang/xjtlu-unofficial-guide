import { ensureDatabase, runDatabaseMaintenance } from '@/db/bootstrap';
import { getRuntimeValue } from '@/db/index';
import { sha256 } from '@/lib/domain';
import { noStoreJson } from '@/lib/http';
import { AppError, errorResponse } from '@/lib/mutations';
import { enforceRateLimit } from '@/lib/rate-limit';

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    enforceRateLimit(request, 'maintenance-run', 5, 600);
    const configured = getRuntimeValue('MAINTENANCE_SECRET');
    if (!configured) {
      throw new AppError(
        503,
        'maintenance_not_configured',
        '保留期限清理任务尚未配置。',
      );
    }
    const authorization = request.headers.get('authorization') ?? '';
    const provided = authorization.startsWith('Bearer ')
      ? authorization.slice(7)
      : '';
    const [providedHash, configuredHash] = await Promise.all([
      sha256(provided),
      sha256(configured),
    ]);
    if (providedHash !== configuredHash) {
      throw new AppError(401, 'invalid_maintenance_token', '维护凭证无效。');
    }
    await ensureDatabase();
    await runDatabaseMaintenance(true);
    return noStoreJson({ data: { completed: true }, request_id: requestId });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
