import { Filter, SearchX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { AnswerCardPreview } from '@/components/answer-card-preview';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
      className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8"
    >
      <header className="max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
          Search
        </p>
        <h1 className="mt-2 font-heading text-4xl font-semibold tracking-tight sm:text-5xl">
          查找已核验答案
        </h1>
        <p className="mt-4 leading-7 text-muted-foreground">
          阶段 1
          使用中英文关键词、别名和结构化范围检索，不使用向量或大模型生成答案。
        </p>
      </header>

      <form action="/search" className="mt-8">
        <div className="grid gap-3 rounded-xl border border-border bg-card p-3 shadow-sm sm:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <label htmlFor="search-page-query" className="sr-only">
              你想确认什么？
            </label>
            <Input
              id="search-page-query"
              name="q"
              type="search"
              defaultValue={query}
              maxLength={160}
              className="min-h-12 border-0 bg-transparent px-3 text-base shadow-none focus-visible:ring-0 sm:text-base"
              placeholder="输入问题、系统名称或办事项"
            />
          </div>
          <Button type="submit" size="lg" className="min-h-12 px-6">
            查找答案
          </Button>
        </div>

        <details
          className="mt-4 rounded-xl border border-border bg-card/70"
          open={Boolean(topic || rawScopes.length)}
        >
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 text-sm font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
            <Filter aria-hidden="true" className="size-4 text-primary" />
            按话题与适用范围筛选
            {topic || rawScopes.length ? (
              <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                已选 {Number(Boolean(topic)) + rawScopes.length}
              </span>
            ) : null}
          </summary>
          <div className="grid gap-6 border-t border-border p-4 md:grid-cols-2">
            <fieldset>
              <legend className="text-sm font-semibold">话题</legend>
              <div className="mt-3 grid gap-2">
                <label className="flex min-h-11 items-center gap-3 rounded-lg px-2 hover:bg-muted">
                  <input
                    type="radio"
                    name="topic"
                    value=""
                    defaultChecked={!topic}
                    className="size-4 accent-primary"
                  />
                  全部话题
                </label>
                {topics.map((item) => (
                  <label
                    key={item.id}
                    className="flex min-h-11 items-center gap-3 rounded-lg px-2 hover:bg-muted"
                  >
                    <input
                      type="radio"
                      name="topic"
                      value={item.slug}
                      defaultChecked={topic === item.slug}
                      className="size-4 accent-primary"
                    />
                    {item.titleZh}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="text-sm font-semibold">
                适用范围（同时满足）
              </legend>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {scopes.map((scope) => (
                  <label
                    key={scope.id}
                    className="flex min-h-11 items-center gap-3 rounded-lg px-2 hover:bg-muted"
                  >
                    <input
                      type="checkbox"
                      name="scope"
                      value={scope.id}
                      defaultChecked={rawScopes.includes(scope.id)}
                      className="size-4 rounded accent-primary"
                    />
                    {scope.labelZh}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex flex-wrap gap-2 md:col-span-2">
              <Button
                type="submit"
                variant="secondary"
                size="lg"
                className="min-h-11"
              >
                应用筛选
              </Button>
              <Link
                href={
                  query ? `/search?q=${encodeURIComponent(query)}` : '/search'
                }
                className={cn(
                  buttonVariants({ variant: 'ghost', size: 'lg' }),
                  'min-h-11',
                )}
              >
                清除筛选
              </Link>
            </div>
          </div>
        </details>
      </form>

      <section aria-labelledby="results-heading" className="mt-10">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
          <h2
            id="results-heading"
            className="font-heading text-2xl font-semibold"
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
