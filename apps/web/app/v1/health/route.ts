import { noStoreJson } from '@/lib/http';
import { getSystemHealth } from '@/lib/operations';

export async function GET() {
  try {
    const health = await getSystemHealth();
    return noStoreJson(
      { status: health.healthy ? 'ok' : 'degraded', checks: health },
      { status: health.healthy ? 200 : 503 },
    );
  } catch {
    return noStoreJson(
      { status: 'unavailable', checks: { database: false } },
      { status: 503 },
    );
  }
}
