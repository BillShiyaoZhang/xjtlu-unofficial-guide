import { Search as SearchIcon, SearchX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { AnswerCardPreview } from '@/components/answer-card-preview';
import { SearchControls } from '@/components/search-controls';
import { buttonVariants } from '@/components/ui/button';
import { listScopes, listTopics, searchAnswerCards } from '@/lib/repository';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: '查找答案' };

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = typeof params.q === 'string' ? params.q.slice(0, 160) : '';
  const topic = typeof params.topic === 'string' ? params.topic : '';
  const rawScopes = Array.isArray(params.scope)
    ? params.scope
    : typeof params.scope === 'string'
      ? [params.scope]
      : [];
  const [topics, scopes, cards] = await Promise.all([
    listTopics(),
    listScopes(),
    searchAnswerCards({
      query,
      topicSlug: topic || undefined,
      scopeIds: rawScopes,
    }),
  ]);
  const returnParams = new URLSearchParams();
  if (query) returnParams.set('q', query);
  if (topic) returnParams.set('topic', topic);
  for (const scope of rawScopes) returnParams.append('scope', scope);
  const returnQuery = returnParams.toString();
  const returnTo = `/search${returnQuery ? `?${returnQuery}` : ''}`;

  return (
    <main
      id="main-content"
      className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-14 lg:px-8"
    >
      <header className="flex items-center gap-3">
        <span className="grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
          <SearchIcon aria-hidden="true" className="size-6" />
        </span>
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-4xl">
            查找
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            搜问题、系统或办事项
          </p>
        </div>
      </header>

      <SearchControls
        query={query}
        topic={topic}
        selectedScopes={rawScopes}
        topics={topics.map((item) => ({
          slug: item.slug,
          titleZh: item.titleZh,
        }))}
        scopes={scopes.map((item) => ({
          id: item.id,
          labelZh: item.labelZh,
        }))}
      />

      <section aria-labelledby="results-heading" className="mt-7 sm:mt-10">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
          <h2
            id="results-heading"
            className="min-w-0 break-words font-heading text-xl font-semibold sm:text-2xl"
          >
            {query ? `“${query}”` : '全部答案'}
          </h2>
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {cards.length} 张
          </p>
        </div>
        {cards.length ? (
          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            {cards.map((card) => (
              <AnswerCardPreview
                key={card.id}
                card={card}
                sourceTab="search"
                returnTo={returnTo}
              />
            ))}
          </div>
        ) : (
          <div className="mt-8 rounded-xl border border-dashed border-border bg-card/55 p-8 text-center sm:p-12">
            <SearchX
              aria-hidden="true"
              className="mx-auto size-8 text-muted-foreground"
            />
            <h3 className="mt-4 font-heading text-xl font-semibold">
              暂时没有匹配的已核验答案
            </h3>
            <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
              换个关键词，或清除筛选条件后再试。
            </p>
            <Link
              href="/search"
              className={cn(
                buttonVariants({ variant: 'outline', size: 'lg' }),
                'mt-5 min-h-11',
              )}
            >
              清除并重试
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
