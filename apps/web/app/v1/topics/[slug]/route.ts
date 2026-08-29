import { publicJson } from '@/lib/http';
import { listTopics, searchAnswerCards } from '@/lib/repository';

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  const topics = await listTopics();
  const topic = topics.find((item) => item.slug === slug);
  if (!topic) {
    return Response.json(
      { error: { code: 'topic_not_found', message: '找不到该话题。' } },
      { status: 404 },
    );
  }
  const cards = await searchAnswerCards({ topicSlug: slug });
  return publicJson({
    data: { topic, cards },
    request_id: crypto.randomUUID(),
  });
}
