import { ArrowLeft, SearchX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AnswerCardPreview } from '@/components/answer-card-preview';
import { buttonVariants } from '@/components/ui/button';
import { listTopics, searchAnswerCards } from '@/lib/repository';
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
      <header className="max-w-3xl border-b border-border pb-8">
        <p
          lang="en"
          className="text-xs font-semibold uppercase tracking-[0.16em] text-primary"
        >
          {topic.titleEn ?? 'Topic'}
        </p>
        <h1 className="mt-2 font-heading text-[2rem] font-semibold tracking-tight sm:text-5xl">
          {topic.titleZh}
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground sm:mt-4 sm:text-lg sm:leading-8">
          {topic.description}
        </p>
      </header>
      <section aria-labelledby="topic-answers" className="mt-9">
        <div className="flex items-baseline justify-between gap-3">
          <h2
            id="topic-answers"
            className="font-heading text-2xl font-semibold"
          >
            当前答案
          </h2>
          <p className="text-sm text-muted-foreground">{cards.length} 张</p>
        </div>
        {cards.length ? (
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            {cards.map((card) => (
              <AnswerCardPreview key={card.id} card={card} />
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
