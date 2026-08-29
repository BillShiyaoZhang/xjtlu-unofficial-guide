import { ArrowRight, ChevronRight, Compass } from 'lucide-react';
import Link from 'next/link';

import { SearchBox } from '@/components/search-box';
import { formatDate } from '@/lib/presentation';
import { listTopics, searchAnswerCards } from '@/lib/repository';
import { topicVisualFor } from '@/lib/topic-presentation';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const quickQueries = [
  { label: 'e-Bridge', query: 'e-Bridge 登录' },
  { label: 'Learning Mall', query: 'Learning Mall 帮助' },
  { label: '学生服务', query: '学生服务入口' },
];

export default async function Home() {
  const [topics, cards] = await Promise.all([
    listTopics(),
    searchAnswerCards({ limit: 4 }),
  ]);

  return (
    <main
      id="main-content"
      className="mx-auto max-w-7xl px-4 pb-5 pt-4 sm:px-6 sm:pt-8 lg:px-8"
    >
      <section className="grid gap-4 lg:grid-cols-[minmax(0,.9fr)_minmax(420px,1.1fr)] lg:items-stretch lg:gap-6">
        <div className="relative min-h-[12.5rem] overflow-hidden rounded-[1.75rem] border border-primary/10 bg-[#e8eee6] shadow-[0_12px_36px_rgb(31_55_46/8%)] sm:min-h-[18rem]">
          <img
            src="/home-verification-journey.webp"
            alt="学生的问题依次经过两份来源，最终得到核验结果"
            className="absolute inset-0 size-full object-cover"
            loading="eager"
          />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#183b33]/85 via-[#183b33]/45 to-transparent px-5 pb-4 pt-14 text-white sm:px-7 sm:pb-6">
            <p className="flex items-center gap-2 text-sm font-semibold sm:text-base">
              <Compass aria-hidden="true" className="size-4" />
              从问题，到有来源的答案
            </p>
          </div>
        </div>

        <div className="rounded-[1.75rem] border border-border bg-card/90 p-4 shadow-[0_10px_32px_rgb(40_47_43/6%)] sm:p-7 lg:flex lg:flex-col lg:justify-center">
          <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-4xl">
            今天想确认什么？
          </h1>
          <div className="mt-4 sm:mt-6">
            <SearchBox />
          </div>
          <div
            aria-label="常用搜索"
            className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {quickQueries.map((item) => (
              <form
                key={item.query}
                action="/search/start"
                method="post"
                className="shrink-0"
              >
                <input type="hidden" name="q" value={item.query} />
                <input type="hidden" name="intent" value="new" />
                <button
                  type="submit"
                  className="rounded-full border border-border bg-background/80 px-3 py-2 text-xs font-semibold text-foreground/80 outline-none active:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40"
                >
                  {item.label}
                </button>
              </form>
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="topics-heading" className="py-8 sm:py-12">
        <div className="flex items-center justify-between gap-3">
          <h2
            id="topics-heading"
            className="font-heading text-xl font-semibold tracking-tight sm:text-3xl"
          >
            常用主题
          </h2>
          <Link
            href="/topics"
            className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
          >
            全部 <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:mt-6 lg:grid-cols-4">
          {topics.slice(0, 4).map((topic) => {
            const visual = topicVisualFor(topic.slug);
            const Icon = visual.icon;
            return (
              <Link
                key={topic.id}
                href={`/topics/${topic.slug}`}
                className={cn(
                  'group min-h-32 rounded-2xl p-4 outline-none transition-transform active:scale-[.98] focus-visible:ring-3 focus-visible:ring-ring/40 sm:min-h-44 sm:p-5',
                  visual.surfaceClassName,
                )}
              >
                <span
                  className={cn(
                    'grid size-10 place-items-center rounded-2xl shadow-sm sm:size-12',
                    visual.iconClassName,
                  )}
                >
                  <Icon aria-hidden="true" className="size-5 sm:size-6" />
                </span>
                <h3 className="mt-4 font-heading text-lg font-semibold sm:mt-6 sm:text-xl">
                  {topic.titleZh}
                </h3>
                <p className="mt-1 text-xs font-semibold text-foreground/60">
                  {topic.cardCount} 张答案
                </p>
                <p className="mt-2 hidden text-sm leading-6 text-foreground/65 sm:block">
                  {topic.description}
                </p>
              </Link>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="recent-heading" className="pb-8 sm:pb-12">
        <div className="flex items-center justify-between gap-3">
          <h2
            id="recent-heading"
            className="font-heading text-xl font-semibold tracking-tight sm:text-3xl"
          >
            最近核验
          </h2>
          <Link
            href="/search"
            className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
          >
            查看全部 <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
        <div className="mt-4 overflow-hidden rounded-2xl bg-card shadow-[0_8px_28px_rgb(40_47_43/6%)] ring-1 ring-foreground/10 sm:mt-6 sm:grid sm:grid-cols-2 sm:gap-px sm:bg-border">
          {cards.map((card) => (
            <Link
              key={card.id}
              href={`/answers/${card.slug}?tab=home`}
              className="group flex min-h-24 items-center gap-3 border-b border-border bg-card px-4 py-4 outline-none last:border-b-0 focus-visible:z-10 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/40 sm:min-h-32 sm:border-b-0 sm:p-5"
            >
              <span
                aria-hidden="true"
                className={cn(
                  'size-2.5 shrink-0 rounded-full ring-4',
                  card.status.tone === 'current' &&
                    'bg-emerald-700 ring-emerald-700/10',
                  card.status.tone === 'warning' &&
                    'bg-amber-600 ring-amber-600/10',
                  card.status.tone === 'danger' && 'bg-red-700 ring-red-700/10',
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-semibold text-muted-foreground">
                  <span>{card.topicTitle}</span>
                  <span aria-hidden="true">·</span>
                  <span
                    className={cn(
                      card.status.tone === 'current' && 'text-emerald-800',
                      card.status.tone === 'warning' && 'text-amber-800',
                      card.status.tone === 'danger' && 'text-red-800',
                    )}
                  >
                    {card.status.label}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{formatDate(card.verifiedAt)} 核验</span>
                </span>
                <span className="mt-1.5 line-clamp-2 block font-heading text-[15px] font-semibold leading-6 sm:text-lg">
                  {card.title}
                </span>
              </span>
              <ChevronRight
                aria-hidden="true"
                className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
              />
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
