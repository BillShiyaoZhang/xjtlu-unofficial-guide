import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AnswerDetail } from '@/components/answer-detail';
import { getAnswerVersion } from '@/lib/repository';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '历史答案版本' };

export default async function AnswerVersionPage({
  params,
}: {
  params: Promise<{ slug: string; version: string }>;
}) {
  const { slug, version } = await params;
  const parsedVersion = Number(version);
  if (!Number.isInteger(parsedVersion) || parsedVersion < 1) notFound();
  const card = await getAnswerVersion(slug, parsedVersion);
  if (!card) notFound();
  return (
    <AnswerDetail
      card={card}
      historical={
        !card.history.find(
          (item) => item.isCurrent && item.versionNumber === parsedVersion,
        )
      }
    />
  );
}
