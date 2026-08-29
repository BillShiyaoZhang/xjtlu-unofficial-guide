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
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,.65fr)] lg:items-end lg:px-8">
          <div className="relative max-w-3xl">
            <Badge
              variant="outline"
              className="mb-6 border-primary/20 bg-card/60 px-3 py-1 text-primary"
            >
              阶段 1 · 编辑维护 · 公开只读
            </Badge>
            <h1 className="max-w-3xl text-balance font-heading text-4xl font-semibold leading-[1.08] tracking-[-0.025em] sm:text-6xl lg:text-7xl">
              先核对来源，
              <br className="hidden sm:block" />
              再做决定
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-muted-foreground sm:text-lg">
              查找新生到校、校园账号和办事入口。每张答案都标出适用范围、核验时间、复核期限和逐句来源。
            </p>
            <div className="mt-9 max-w-2xl">
              <p className="mb-2 text-sm font-semibold text-foreground">
                你想确认什么？
              </p>
              <SearchBox />
            </div>
          </div>
          <aside className="relative border-l-2 border-primary/25 pl-6 lg:mb-2">
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
        className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8"
      >
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
              Pilot scope
            </p>
            <h2
              id="topics-heading"
              className="mt-2 font-heading text-3xl font-semibold tracking-tight"
            >
              从常见任务开始
            </h2>
          </div>
          <Link
            href="/topics"
            className={cn(
              buttonVariants({ variant: 'ghost' }),
              'hidden sm:inline-flex',
            )}
          >
            查看全部主题 <ArrowRight />
          </Link>
        </div>
        <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {topics.map((topic, index) => (
            <Link
              key={topic.id}
              href={`/topics/${topic.slug}`}
              className="group min-h-44 rounded-xl border border-border bg-card/75 p-5 shadow-sm outline-none transition-colors hover:border-primary/35 hover:bg-card focus-visible:ring-3 focus-visible:ring-ring/40"
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
              <h3 className="mt-7 font-heading text-xl font-semibold">
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
