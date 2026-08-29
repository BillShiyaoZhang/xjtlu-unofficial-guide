import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AnswerDetail } from '@/components/answer-detail';
import { getAnswerBySlug } from '@/lib/repository';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const card = await getAnswerBySlug(slug);
  return { title: card?.title ?? '答案' };
}

export default async function AnswerPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const card = await getAnswerBySlug(slug);
  if (!card) notFound();
  return <AnswerDetail card={card} />;
}
