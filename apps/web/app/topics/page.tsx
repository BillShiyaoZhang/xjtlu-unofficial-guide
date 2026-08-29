import type { Metadata } from 'next';
import Link from 'next/link';

import { listTopics } from '@/lib/repository';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '主题' };

export default async function TopicsPage() {
  const topics = await listTopics();
  return (
    <main
      id="main-content"
      className="mx-auto max-w-5xl px-4 py-7 sm:px-6 sm:py-12 lg:px-8"
    >
      <header className="max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
          浏览
        </p>
        <h1 className="mt-2 font-heading text-[2rem] font-semibold tracking-tight sm:text-4xl">
          主题目录
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground sm:mt-4 sm:text-base sm:leading-7">
          话题只用于导航，不代表现实世界中的事实。公开话题由编辑根据试点范围维护。
        </p>
      </header>
      <div className="mt-7 grid grid-cols-2 gap-3 sm:mt-10 sm:gap-4">
        {topics.map((topic) => (
          <Link
            key={topic.id}
            href={`/topics/${topic.slug}`}
            className="rounded-2xl border border-border bg-card p-4 outline-none transition-colors hover:border-primary/30 focus-visible:ring-3 focus-visible:ring-ring/40 sm:rounded-xl sm:p-6"
          >
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">
              {topic.titleEn}
            </p>
            <h2 className="mt-2 font-heading text-lg font-semibold sm:text-2xl">
              {topic.titleZh}
            </h2>
            <p className="mt-2 line-clamp-3 text-xs leading-5 text-muted-foreground sm:mt-3 sm:text-sm sm:leading-6">
              {topic.description}
            </p>
            <p className="mt-4 text-xs font-semibold text-primary sm:mt-5">
              {topic.cardCount} 张当前答案
            </p>
          </Link>
        ))}
      </div>
    </main>
  );
}
