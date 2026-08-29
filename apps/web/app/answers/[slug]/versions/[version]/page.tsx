import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AnswerDetail } from '@/components/answer-detail';
import {
  parseMobileReturnTo,
  parseMobileTabContext,
} from '@/lib/mobile-navigation';
import { getAnswerVersion } from '@/lib/repository';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '历史答案版本' };

export default async function AnswerVersionPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; version: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug, version }, query] = await Promise.all([params, searchParams]);
  const parsedVersion = Number(version);
  if (!Number.isInteger(parsedVersion) || parsedVersion < 1) notFound();
  const card = await getAnswerVersion(slug, parsedVersion);
  if (!card) notFound();
  const sourceTab = parseMobileTabContext(
    typeof query.tab === 'string' ? query.tab : undefined,
  );
  const returnTo = parseMobileReturnTo(
    typeof query.from === 'string' ? query.from : undefined,
  );
  return (
    <AnswerDetail
      card={card}
      sourceTab={sourceTab}
      returnTo={returnTo}
      historical={
        !card.history.find(
          (item) => item.isCurrent && item.versionNumber === parsedVersion,
        )
      }
    />
  );
}
