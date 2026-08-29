import { ensureDatabase, runDatabaseMaintenance } from '@/db/bootstrap';
import { noStoreJson } from '@/lib/http';
import { assertMaintenanceBearer } from '@/lib/internal-auth';
import { errorResponse } from '@/lib/mutations';
import { enforceRateLimit } from '@/lib/rate-limit';

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    await enforceRateLimit(request, 'maintenance-run', 5, 600);
    await assertMaintenanceBearer(request);
    await ensureDatabase();
    const summary = await runDatabaseMaintenance(true);
    return noStoreJson({
      data: { completed: true, ...summary },
      request_id: requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
