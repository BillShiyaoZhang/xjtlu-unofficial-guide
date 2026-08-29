import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AnswerCardPreview } from '@/components/answer-card-preview';
import { listTopics, searchAnswerCards } from '@/lib/repository';

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
      className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8"
    >
      <header className="max-w-3xl border-b border-border pb-8">
        <p
          lang="en"
          className="text-xs font-semibold uppercase tracking-[0.16em] text-primary"
        >
          {topic.titleEn ?? 'Topic'}
        </p>
        <h1 className="mt-2 font-heading text-4xl font-semibold tracking-tight sm:text-5xl">
          {topic.titleZh}
        </h1>
        <p className="mt-4 text-lg leading-8 text-muted-foreground">
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
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          {cards.map((card) => (
            <AnswerCardPreview key={card.id} card={card} />
          ))}
        </div>
      </section>
    </main>
  );
}
