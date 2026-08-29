import type { Metadata } from 'next';

import { ReportForm } from '@/components/report-form';
import { searchAnswerCards } from '@/lib/repository';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '报告问题' };

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const defaultCardId = typeof params.card === 'string' ? params.card : '';
  const cards = await searchAnswerCards({ limit: 100 });
  return (
    <main
      id="main-content"
      className="mx-auto max-w-3xl px-4 py-7 sm:px-6 sm:py-12 lg:px-8"
    >
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
          Report an issue
        </p>
        <h1 className="mt-2 font-heading text-[2rem] font-semibold tracking-tight sm:text-4xl">
          报告答案问题
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground sm:mt-4 sm:text-base sm:leading-7">
          只提交结构化问题类型并获得可追踪编号。报告不会直接更改公开内容，也不参与“可信度投票”。
        </p>
      </header>
      <div className="mt-8">
        <ReportForm
          cards={cards.map((card) => ({ id: card.id, title: card.title }))}
          defaultCardId={defaultCardId}
        />
      </div>
    </main>
  );
}
