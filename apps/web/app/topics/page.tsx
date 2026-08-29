import { Layers3 } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { listTopics } from '@/lib/repository';
import { topicVisualFor } from '@/lib/topic-presentation';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '主题' };

export default async function TopicsPage() {
  const topics = await listTopics();
  return (
    <main
      id="main-content"
      className="mx-auto max-w-5xl px-4 pb-8 pt-6 sm:px-6 sm:py-12 lg:px-8"
    >
      <header className="flex items-center gap-3">
        <span className="grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
          <Layers3 aria-hidden="true" className="size-6" />
        </span>
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-4xl">
            主题
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">按常见任务浏览</p>
        </div>
      </header>

      <div className="mt-7 grid grid-cols-2 gap-3 sm:mt-10 sm:gap-4">
        {topics.map((topic) => {
          const visual = topicVisualFor(topic.slug);
          const Icon = visual.icon;
          return (
            <Link
              key={topic.id}
              href={`/topics/${topic.slug}`}
              className={cn(
                'min-h-40 rounded-2xl p-4 outline-none transition-transform active:scale-[.98] focus-visible:ring-3 focus-visible:ring-ring/40 sm:min-h-52 sm:p-6',
                visual.surfaceClassName,
              )}
            >
              <span
                className={cn(
                  'grid size-11 place-items-center rounded-2xl shadow-sm sm:size-13',
                  visual.iconClassName,
                )}
              >
                <Icon aria-hidden="true" className="size-5 sm:size-6" />
              </span>
              <h2 className="mt-5 font-heading text-lg font-semibold sm:mt-7 sm:text-2xl">
                {topic.titleZh}
              </h2>
              <p className="mt-1 text-xs font-semibold text-foreground/60">
                {topic.cardCount} 张答案
              </p>
              <p className="mt-3 hidden text-sm leading-6 text-foreground/65 sm:block">
                {topic.description}
              </p>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
