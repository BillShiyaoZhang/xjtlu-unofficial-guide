import {
  ArrowRight,
  Lightbulb,
  Search as SearchIcon,
  SearchX,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { AnswerCardPreview } from '@/components/answer-card-preview';
import { SearchControls } from '@/components/search-controls';
import { buttonVariants } from '@/components/ui/button';
import { rankSearchCandidate } from '@/lib/domain';
import { openSearchView } from '@/lib/pilot-crypto';
import { getPilotSessionForPage } from '@/lib/pilot-server';
import { listScopes, listTopics, searchAnswerCards } from '@/lib/repository';
import { topicVisualFor } from '@/lib/topic-presentation';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: '查找答案' };

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const errorCode =
    typeof params.error === 'string' &&
    ['retrieval', 'rate', 'unavailable', 'invalid'].includes(params.error)
      ? params.error
      : '';
  const sealedView = typeof params.v === 'string' ? params.v : '';
  const pilotSession = sealedView ? await getPilotSessionForPage() : null;
  const view = sealedView
    ? await openSearchView(sealedView, pilotSession?.id ?? null)
    : null;
  const query = view?.query ?? '';
  const requestedTopic = view?.topic ?? '';
  const requestedScopes = view?.scopeIds ?? [];
  const queryEventId = view?.queryEventId ?? '';
  const [topics, scopes] = await Promise.all([listTopics(), listScopes()]);
  const topic = topics.some((item) => item.slug === requestedTopic)
    ? requestedTopic
    : '';
  const validScopeIds = new Set(scopes.map((item) => item.id));
  const selectedScopes = [
    ...new Set(requestedScopes.filter((id) => validScopeIds.has(id))),
  ].slice(0, 8);
  const filtersAdjusted = Boolean(sealedView && !view);
  const cards = filtersAdjusted
    ? []
    : await searchAnswerCards({
        query,
        topicSlug: topic || undefined,
        scopeIds: selectedScopes,
      });
  const suggestedTopics = query
    ? topics
        .map((item) => ({
          item,
          score: rankSearchCandidate(
            {
              id: item.id,
              title: item.titleZh,
              summary: item.description,
              searchText: `${item.titleEn ?? ''} ${item.description}`,
              topicTitle: item.titleZh,
            },
            query,
          ),
        }))
        .sort(
          (left, right) =>
            right.score - left.score ||
            right.item.cardCount - left.item.cardCount,
        )
        .slice(0, 3)
        .map(({ item }) => item)
    : [];
  const returnTo = sealedView
    ? `/search?v=${encodeURIComponent(sealedView)}`
    : '/search';
  const intakeParams = new URLSearchParams({ kind: 'question' });
  if (sealedView) intakeParams.set('v', sealedView);

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
        queryEventId={queryEventId}
        topic={topic}
        selectedScopes={selectedScopes}
        topics={topics.map((item) => ({
          slug: item.slug,
          titleZh: item.titleZh,
        }))}
        scopes={scopes.map((item) => ({
          id: item.id,
          labelZh: item.labelZh,
        }))}
      />

      {errorCode ? (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-red-700/15 bg-red-500/10 px-4 py-3 text-sm text-red-950"
        >
          {errorCode === 'rate'
            ? '操作有些频繁，请稍后再试。'
            : errorCode === 'invalid'
              ? '这次搜索请求无效，请检查后重试。'
              : '暂时无法完成检索，请稍后重试。'}
        </p>
      ) : null}

      {filtersAdjusted ? (
        <p
          role="status"
          className="mt-4 rounded-xl border border-amber-700/15 bg-amber-500/10 px-4 py-3 text-sm text-amber-950"
        >
          这个搜索链接已过期或不属于当前试点会话。原问题不会显示，请重新查找。
        </p>
      ) : null}

      <section aria-labelledby="results-heading" className="mt-7 sm:mt-10">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
          <h2
            id="results-heading"
            className="min-w-0 break-words font-heading text-xl font-semibold sm:text-2xl"
          >
            {filtersAdjusted
              ? '搜索链接已失效'
              : query
                ? `“${query}”`
                : '全部答案'}
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
          <div className="mt-8 overflow-hidden rounded-2xl border border-border bg-card shadow-[0_8px_28px_rgb(40_47_43/6%)]">
            <div className="p-6 text-center sm:p-10">
              <SearchX
                aria-hidden="true"
                className="mx-auto size-8 text-muted-foreground"
              />
              <h3 className="mt-4 font-heading text-xl font-semibold">
                暂时没有匹配的已核验答案
              </h3>
              <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
                先看看可能相关的话题；如果仍然不是你要找的，受邀参与者可以把这个问题送进私有编辑队列。
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <Link
                  href="/search"
                  className={cn(
                    buttonVariants({ variant: 'outline', size: 'lg' }),
                    'min-h-11',
                  )}
                >
                  清除并重试
                </Link>
                {query && !filtersAdjusted ? (
                  <Link
                    href={`/research-intake?${intakeParams.toString()}`}
                    className={cn(buttonVariants({ size: 'lg' }), 'min-h-11')}
                  >
                    <Lightbulb aria-hidden="true" />
                    提交这个问题线索
                  </Link>
                ) : null}
              </div>
            </div>
            {suggestedTopics.length ? (
              <nav
                aria-label="可能相关的话题"
                className="grid gap-px border-t border-border bg-border sm:grid-cols-3"
              >
                {suggestedTopics.map((item) => {
                  const visual = topicVisualFor(item.slug);
                  const Icon = visual.icon;
                  return (
                    <Link
                      key={item.id}
                      href={`/topics/${item.slug}`}
                      className="group flex min-h-24 items-center gap-3 bg-card px-4 py-4 outline-none focus-visible:z-10 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/40"
                    >
                      <span
                        className={cn(
                          'grid size-10 shrink-0 place-items-center rounded-2xl',
                          visual.iconClassName,
                        )}
                      >
                        <Icon aria-hidden="true" className="size-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-heading font-semibold">
                          {item.titleZh}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {item.cardCount} 张答案
                        </span>
                      </span>
                      <ArrowRight
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                      />
                    </Link>
                  );
                })}
              </nav>
            ) : null}
          </div>
        )}
      </section>
    </main>
  );
}
