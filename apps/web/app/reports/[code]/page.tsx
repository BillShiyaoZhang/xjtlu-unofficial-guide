import { Clock3 } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import {
  formatDateTime,
  reportStatusLabel,
  reportTypeLabel,
} from '@/lib/presentation';
import { getReportByCode } from '@/lib/repository';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '报告状态' };

export default async function ReportStatusPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const report = await getReportByCode(code);
  if (!report) notFound();
  return (
    <main
      id="main-content"
      className="mx-auto max-w-2xl px-4 py-14 sm:px-6 lg:px-8"
    >
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Badge variant="secondary">{reportStatusLabel(report.status)}</Badge>
          <span className="font-mono text-sm text-muted-foreground">
            {report.public_code}
          </span>
        </div>
        <h1 className="mt-6 font-heading text-3xl font-semibold">
          报告处理状态
        </h1>
        <dl className="mt-7 grid gap-5 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold text-muted-foreground">
              问题类型
            </dt>
            <dd className="mt-1">{reportTypeLabel(report.type)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-muted-foreground">
              提交时间
            </dt>
            <dd className="mt-1">{formatDateTime(report.created_at)}</dd>
          </div>
          {report.card_title ? (
            <div className="sm:col-span-2">
              <dt className="text-xs font-semibold text-muted-foreground">
                相关答案
              </dt>
              <dd className="mt-1">
                {report.card_slug ? (
                  <Link
                    className="text-primary underline-offset-4 hover:underline"
                    href={`/answers/${report.card_slug}`}
                  >
                    {report.card_title}
                  </Link>
                ) : (
                  report.card_title
                )}
              </dd>
            </div>
          ) : null}
        </dl>
        <div className="mt-7 flex gap-3 rounded-lg bg-muted/55 p-4 text-sm leading-6 text-muted-foreground">
          <Clock3 className="mt-0.5 size-4 shrink-0 text-primary" />
          <p>
            {report.public_response ??
              '编辑尚未发布处理说明。该编号只显示公开状态，不暴露内部审核信息。'}
          </p>
        </div>
        <Link
          href="/search"
          className={cn(
            buttonVariants({ variant: 'outline', size: 'lg' }),
            'mt-7 min-h-11',
          )}
        >
          返回查找答案
        </Link>
      </div>
    </main>
  );
}
