import { publicJson } from '@/lib/http';
import { getAnswerBySlug } from '@/lib/repository';

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  const card = await getAnswerBySlug(slug);
  if (!card) {
    return Response.json(
      { error: { code: 'answer_not_found', message: '找不到该答案卡。' } },
      { status: 404 },
    );
  }
  return publicJson({ data: card, request_id: crypto.randomUUID() });
}
