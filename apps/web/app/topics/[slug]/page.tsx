import { ArrowLeft, SearchX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AnswerCardPreview } from '@/components/answer-card-preview';
import { buttonVariants } from '@/components/ui/button';
import { listTopics, searchAnswerCards } from '@/lib/repository';
import { topicVisualFor } from '@/lib/topic-presentation';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const topic = (await listTopics()).find((item) => item.slug === slug);
  return { title: topic?.titleZh ?? '主题' };
}

export default async function TopicPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [topics, cards] = await Promise.all([
    listTopics(),
    searchAnswerCards({ topicSlug: slug }),
  ]);
  const topic = topics.find((item) => item.slug === slug);
  if (!topic) notFound();
  const visual = topicVisualFor(topic.slug);
  const Icon = visual.icon;
  return (
    <main
      id="main-content"
      className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-12 lg:px-8"
    >
      <Link
        href="/topics"
        className={cn(
          buttonVariants({ variant: 'ghost', size: 'sm' }),
          '-ml-2 min-h-11',
        )}
      >
        <ArrowLeft aria-hidden="true" />
        全部主题
      </Link>
      <header
        className={cn(
          'mt-1 max-w-3xl rounded-[1.75rem] p-5 sm:p-8',
          visual.surfaceClassName,
        )}
      >
        <span
          className={cn(
            'grid size-12 place-items-center rounded-2xl shadow-sm sm:size-14',
            visual.iconClassName,
          )}
        >
          <Icon aria-hidden="true" className="size-6 sm:size-7" />
        </span>
        <h1 className="mt-6 font-heading text-[2rem] font-semibold tracking-tight sm:text-5xl">
          {topic.titleZh}
        </h1>
        <p className="mt-3 hidden text-base leading-7 text-foreground/65 sm:block">
          {topic.description}
        </p>
      </header>
      <section aria-labelledby="topic-answers" className="mt-7 sm:mt-9">
        <div className="flex items-baseline justify-between gap-3">
          <h2
            id="topic-answers"
            className="font-heading text-2xl font-semibold"
          >
            答案
          </h2>
          <p className="text-sm text-muted-foreground">{cards.length} 张</p>
        </div>
        {cards.length ? (
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            {cards.map((card) => (
              <AnswerCardPreview key={card.id} card={card} sourceTab="topics" />
            ))}
          </div>
        ) : (
          <div className="mt-6 rounded-2xl border border-dashed border-border bg-card/60 p-8 text-center">
            <SearchX
              aria-hidden="true"
              className="mx-auto size-7 text-muted-foreground"
            />
            <p className="mt-3 font-semibold">这个主题暂时没有公开答案</p>
            <Link
              href="/search"
              className={cn(
                buttonVariants({ variant: 'outline', size: 'lg' }),
                'mt-5 min-h-11',
              )}
            >
              查找其他答案
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
