import {
  ArrowRight,
  Clock3,
  FileCheck2,
  Layers3,
  SearchCheck,
} from 'lucide-react';
import Link from 'next/link';

import { AnswerCardPreview } from '@/components/answer-card-preview';
import { SearchBox } from '@/components/search-box';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { listTopics, searchAnswerCards } from '@/lib/repository';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const quickQueries = [
  { label: 'e-Bridge 登录', query: 'e-Bridge 登录' },
  { label: 'Learning Mall', query: 'Learning Mall 帮助' },
  { label: '学生服务入口', query: '学生服务入口' },
];

export default async function Home() {
  const [topics, cards] = await Promise.all([
    listTopics(),
    searchAnswerCards({ limit: 4 }),
  ]);
  return (
    <main id="main-content">
      <section className="relative overflow-hidden border-b border-border/70">
        <div
          aria-hidden="true"
          className="absolute -right-24 top-10 size-80 rounded-full bg-primary/7 blur-3xl"
        />
        <div className="mx-auto grid max-w-7xl gap-10 px-4 pb-9 pt-7 sm:px-6 sm:py-20 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,.65fr)] lg:items-end lg:px-8 lg:py-24">
          <div className="relative max-w-3xl">
            <Badge
              variant="outline"
              className="mb-4 border-primary/20 bg-card/70 px-3 py-1 text-primary sm:mb-6"
            >
              人工核验 · 逐句来源 · 公开只读
            </Badge>
            <h1 className="max-w-3xl text-balance font-heading text-[2.35rem] font-semibold leading-[1.08] tracking-[-0.025em] sm:text-6xl lg:text-7xl">
              先核对来源，
              <br className="hidden sm:block" />
              再做决定
            </h1>
            <p className="mt-4 max-w-2xl text-[15px] leading-7 text-muted-foreground sm:mt-6 sm:text-lg sm:leading-8">
              查找新生到校、校园账号和办事入口。每张答案都标出适用范围、核验时间、复核期限和逐句来源。
            </p>
            <div className="mt-6 max-w-2xl sm:mt-9">
              <p className="mb-2 text-sm font-semibold text-foreground">
                今天想确认什么？
              </p>
              <SearchBox />
              <div
                aria-label="常用搜索"
                className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                <span className="shrink-0 py-2 text-xs text-muted-foreground">
                  试试
                </span>
                {quickQueries.map((item) => (
                  <Link
                    key={item.query}
                    href={`/search?q=${encodeURIComponent(item.query)}`}
                    className="shrink-0 rounded-full border border-border bg-card/75 px-3 py-2 text-xs font-semibold text-foreground/80 outline-none active:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          </div>
          <aside className="relative hidden border-l-2 border-primary/25 pl-6 lg:mb-2 lg:block">
            <p className="font-heading text-xl font-semibold leading-8">
              不是另一个信息流，
              <br />
              而是一套核验路径。
            </p>
            <ol className="mt-5 space-y-4 text-sm text-muted-foreground">
              <li className="flex gap-3">
                <SearchCheck className="mt-0.5 size-4 shrink-0 text-primary" />
                先按问题和范围查找
              </li>
              <li className="flex gap-3">
                <FileCheck2 className="mt-0.5 size-4 shrink-0 text-primary" />
                再读结论与逐句来源
              </li>
              <li className="flex gap-3">
                <Clock3 className="mt-0.5 size-4 shrink-0 text-primary" />
                最后检查核验与复核日期
              </li>
            </ol>
          </aside>
        </div>
      </section>

      <section
        aria-labelledby="topics-heading"
        className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8"
      >
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
              常用入口
            </p>
            <h2
              id="topics-heading"
              className="mt-2 font-heading text-2xl font-semibold tracking-tight sm:text-3xl"
            >
              从常见任务开始
            </h2>
          </div>
          <Link
            href="/topics"
            className={cn(
              buttonVariants({ variant: 'ghost' }),
              'min-h-11 px-2 text-sm',
            )}
          >
            查看全部 <ArrowRight />
          </Link>
        </div>
        <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {topics.map((topic, index) => (
            <Link
              key={topic.id}
              href={`/topics/${topic.slug}`}
              className="group min-h-40 rounded-2xl border border-border bg-card/80 p-4 shadow-sm outline-none transition-colors hover:border-primary/35 hover:bg-card focus-visible:ring-3 focus-visible:ring-ring/40 sm:min-h-44 sm:rounded-xl sm:p-5"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-muted-foreground">
                  0{index + 1}
                </span>
                <Layers3
                  aria-hidden="true"
                  className="size-4 text-primary transition-transform group-hover:rotate-6"
                />
              </div>
              <h3 className="mt-5 font-heading text-lg font-semibold sm:mt-7 sm:text-xl">
                {topic.titleZh}
              </h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {topic.description}
              </p>
              <p className="mt-4 text-xs font-semibold text-primary">
                {topic.cardCount} 张当前答案
              </p>
            </Link>
          ))}
        </div>
      </section>

      <section
        aria-labelledby="recent-heading"
        className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8"
      >
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            Reviewed answers
          </p>
          <h2
            id="recent-heading"
            className="mt-2 font-heading text-3xl font-semibold tracking-tight"
          >
            最近核验的答案
          </h2>
          <p className="mt-3 leading-7 text-muted-foreground">
            当前为本地阶段 1 演示种子内容；外部来源均明确标出是否归档。
          </p>
        </div>
        <div className="mt-8 grid gap-5 lg:grid-cols-2">
          {cards.map((card) => (
            <AnswerCardPreview key={card.id} card={card} />
          ))}
        </div>
      </section>
    </main>
  );
}
