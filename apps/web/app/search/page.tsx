import { SearchX } from 'lucide-react';
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

  return (
    <main
      id="main-content"
      className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-14 lg:px-8"
    >
      <header className="max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
          查找
        </p>
        <h1 className="mt-2 font-heading text-[2rem] font-semibold tracking-tight sm:text-5xl">
          查找已核验答案
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground sm:mt-4 sm:text-base sm:leading-7">
          输入问题或系统名称，也可以按话题和适用范围缩小结果。
        </p>
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

      <section aria-labelledby="results-heading" className="mt-8 sm:mt-10">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
          <h2
            id="results-heading"
            className="min-w-0 break-words font-heading text-xl font-semibold sm:text-2xl"
          >
            {query ? `“${query}”的结果` : '当前答案'}
          </h2>
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {cards.length} 张答案卡
          </p>
        </div>
        {cards.length ? (
          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            {cards.map((card) => (
              <AnswerCardPreview key={card.id} card={card} />
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
              调整关键词或筛选范围；受邀且已线下确认成年的研究参与者也可以提交私有问题线索。
            </p>
            <Link
              href="/research-intake"
              className={cn(
                buttonVariants({ variant: 'outline', size: 'lg' }),
                'mt-5 min-h-11',
              )}
            >
              了解私有线索入口
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
