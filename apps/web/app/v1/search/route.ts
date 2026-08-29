import { publicJson } from '@/lib/http';
import { searchAnswerCards } from '@/lib/repository';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get('q') ?? '').trim().slice(0, 160);
  const topicSlug = url.searchParams.get('topic')?.trim().slice(0, 100);
  const scopeIds = url.searchParams
    .getAll('scope')
    .map((value) => value.trim().slice(0, 100))
    .filter(Boolean)
    .slice(0, 20);
  const cards = await searchAnswerCards({ query, topicSlug, scopeIds });
  return publicJson({
    data: cards,
    meta: { query, count: cards.length, retrieval: 'keyword_alias_v1' },
    request_id: crypto.randomUUID(),
  });
}
