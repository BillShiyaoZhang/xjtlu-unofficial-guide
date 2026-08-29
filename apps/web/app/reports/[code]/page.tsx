import { CheckCircle2, Circle, Clock3 } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ReportReferenceActions } from '@/components/report-reference-actions';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import {
  formatDateTime,
  reportAffectedAreaLabel,
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
  const completed = report.status === 'resolved' || report.status === 'closed';
  const timeline = [
    { label: '已收到', at: report.created_at, done: true },
    {
      label: '编辑复核中',
      at: report.reviewing_at,
      done: report.reviewing_at !== null,
    },
    {
      label: report.status === 'closed' ? '已关闭' : '已完成',
      at: report.resolved_at,
      done: completed,
    },
  ];
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
        <p className="mt-2 text-sm text-muted-foreground">
          保存这个页面即可随时回来查看；页面不会显示内部审核信息。
        </p>
        <div className="mt-5">
          <ReportReferenceActions code={report.public_code} />
        </div>
        <ol
          aria-label="报告处理进度"
          className="mt-7 grid overflow-hidden rounded-xl border border-border bg-muted/35 sm:grid-cols-3"
        >
          {timeline.map((step, index) => (
            <li
              key={step.label}
              className="flex min-h-20 items-center gap-3 border-b border-border p-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"
            >
              {step.done ? (
                <CheckCircle2
                  aria-hidden="true"
                  className="size-5 shrink-0 text-emerald-700"
                />
              ) : (
                <Circle
                  aria-hidden="true"
                  className="size-5 shrink-0 text-muted-foreground/45"
                />
              )}
              <div>
                <p className="text-sm font-semibold">
                  {index + 1}. {step.label}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {step.at ? formatDateTime(step.at) : '等待处理'}
                </p>
              </div>
            </li>
          ))}
        </ol>
        <dl className="mt-7 grid gap-5 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold text-muted-foreground">
              问题类型
            </dt>
            <dd className="mt-1">{reportTypeLabel(report.type)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-muted-foreground">
              最近更新
            </dt>
            <dd className="mt-1">{formatDateTime(report.updated_at)}</dd>
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
          {!report.card_title && report.affected_area ? (
            <div className="sm:col-span-2">
              <dt className="text-xs font-semibold text-muted-foreground">
                受影响区域
              </dt>
              <dd className="mt-1">
                {reportAffectedAreaLabel(report.affected_area)}
              </dd>
            </div>
          ) : null}
        </dl>
        <div className="mt-7 flex gap-3 rounded-lg bg-muted/55 p-4 text-sm leading-6 text-muted-foreground">
          <Clock3 className="mt-0.5 size-4 shrink-0 text-primary" />
          <p>
            {report.public_response ??
              (report.status === 'reviewing'
                ? '编辑正在核查。完成后，这里会显示公开处理说明。'
                : '报告已进入队列，编辑开始核查后会更新进度。')}
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
