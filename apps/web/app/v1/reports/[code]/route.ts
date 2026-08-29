import { noStoreJson } from '@/lib/http';
import { errorResponse } from '@/lib/mutations';
import { getReportByCode } from '@/lib/repository';
import { enforceRateLimit } from '@/lib/rate-limit';

export async function GET(
  request: Request,
  context: { params: Promise<{ code: string }> },
) {
  try {
    await enforceRateLimit(request, 'report-status-read', 60, 600);
  } catch (error) {
    return errorResponse(error);
  }
  const { code } = await context.params;
  const report = await getReportByCode(code);
  if (!report) {
    return Response.json(
      { error: { code: 'report_not_found', message: '找不到该报告编号。' } },
      { status: 404 },
    );
  }
  return noStoreJson({
    data: {
      code: report.public_code,
      type: report.type,
      status: report.status,
      publicResponse: report.public_response,
      createdAt: report.created_at,
      reviewingAt: report.reviewing_at,
      updatedAt: report.updated_at,
      resolvedAt: report.resolved_at,
      card: report.card_slug
        ? { slug: report.card_slug, title: report.card_title }
        : null,
    },
    object_version: report.lock_version,
    request_id: crypto.randomUUID(),
  });
}
