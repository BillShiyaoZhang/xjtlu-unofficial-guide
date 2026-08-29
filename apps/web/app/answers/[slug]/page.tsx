import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AnswerDetail } from '@/components/answer-detail';
import {
  parseMobileReturnTo,
  parseMobileTabContext,
} from '@/lib/mobile-navigation';
import { getAnswerBySlug } from '@/lib/repository';
import { openSearchView } from '@/lib/pilot-crypto';
import { getPilotSessionForPage } from '@/lib/pilot-server';

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
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const card = await getAnswerBySlug(slug);
  if (!card) notFound();
  const sourceTab = parseMobileTabContext(
    typeof query.tab === 'string' ? query.tab : undefined,
  );
  const returnTo = parseMobileReturnTo(
    typeof query.from === 'string' ? query.from : undefined,
  );
  const pilotSession = await getPilotSessionForPage();
  const searchUrl = new URL(returnTo ?? '/search', 'https://app.local');
  const sealedView =
    searchUrl.pathname === '/search' ? searchUrl.searchParams.get('v') : null;
  const view = sealedView
    ? await openSearchView(sealedView, pilotSession?.id ?? null)
    : null;
  const queryEventId = view?.queryEventId;
  return (
    <AnswerDetail
      card={card}
      sourceTab={sourceTab}
      returnTo={returnTo}
      queryEventId={queryEventId}
    />
  );
}
