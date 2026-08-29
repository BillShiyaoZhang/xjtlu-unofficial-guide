import { getRuntimeValue } from '@/db';

import { secretsMatch } from './editor-crypto';
import { AppError } from './errors';

export async function assertMaintenanceBearer(request: Request) {
  const configured = getRuntimeValue('MAINTENANCE_SECRET')?.trim() ?? '';
  if (configured.length < 32) {
    throw new AppError(503, 'maintenance_not_configured', '维护凭证尚未配置。');
  }
  const authorization = request.headers.get('authorization') ?? '';
  const provided = authorization.startsWith('Bearer ')
    ? authorization.slice(7)
    : '';
  if (!(await secretsMatch(configured, provided))) {
    throw new AppError(401, 'invalid_maintenance_token', '维护凭证无效。');
  }
}
