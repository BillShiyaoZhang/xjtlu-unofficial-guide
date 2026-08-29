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
      className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8"
    >
      <header className="max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
          Topics
        </p>
        <h1 className="mt-2 font-heading text-4xl font-semibold tracking-tight">
          主题目录
        </h1>
        <p className="mt-4 leading-7 text-muted-foreground">
          话题只用于导航，不代表现实世界中的事实。公开话题由编辑根据试点范围维护。
        </p>
      </header>
      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {topics.map((topic) => (
          <Link
            key={topic.id}
            href={`/topics/${topic.slug}`}
            className="rounded-xl border border-border bg-card p-6 outline-none transition-colors hover:border-primary/30 focus-visible:ring-3 focus-visible:ring-ring/40"
          >
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">
              {topic.titleEn}
            </p>
            <h2 className="mt-2 font-heading text-2xl font-semibold">
              {topic.titleZh}
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {topic.description}
            </p>
            <p className="mt-5 text-xs font-semibold text-primary">
              {topic.cardCount} 张当前答案
            </p>
          </Link>
        ))}
      </div>
    </main>
  );
}
