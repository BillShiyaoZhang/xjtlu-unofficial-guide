import {
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  FileWarning,
  Lightbulb,
  LockKeyhole,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { getPilotActivity } from '@/lib/pilot';
import { getPilotSessionForPage } from '@/lib/pilot-server';
import {
  formatDateTime,
  reportStatusLabel,
  reportTypeLabel,
} from '@/lib/presentation';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: '我的活动',
  robots: { index: false, follow: false },
};

type ActivityView = 'all' | 'reports' | 'intakes';

export default async function PilotActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const view = parseView(params.view);
  const session = await getPilotSessionForPage();

  if (!session) {
    return (
      <main
        id="main-content"
        className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-16"
      >
        <section className="rounded-2xl border border-border bg-card p-6 text-center shadow-sm sm:p-9">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-muted text-muted-foreground">
            <LockKeyhole aria-hidden="true" className="size-6" />
          </span>
          <h1 className="mt-5 font-heading text-2xl font-semibold">
            需要有效的试点会话
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            我的活动只在这台设备的有效会话中显示。
          </p>
          <Link
            href={`/pilot?returnTo=${encodeURIComponent('/pilot/activity')}`}
            className={cn(buttonVariants({ size: 'lg' }), 'mt-6 min-h-11')}
          >
            前往研究试点
          </Link>
        </section>
      </main>
    );
  }

  const activity = await getPilotActivity(session);
  const total = activity.reports.length + activity.intakes.length;
  return (
    <main
      id="main-content"
      className="mx-auto max-w-3xl px-4 py-7 sm:px-6 sm:py-12 lg:px-8"
    >
      <header className="flex items-center gap-3">
        <span className="grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
          <ClipboardList aria-hidden="true" className="size-6" />
        </span>
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-4xl">
            我的活动
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {total} 条记录 · 仅当前试点会话可见
          </p>
        </div>
      </header>

      <nav
        aria-label="活动类型"
        className="mt-7 grid grid-cols-3 rounded-xl bg-muted p-1"
      >
        {[
          ['all', '全部', total],
          ['reports', '问题报告', activity.reports.length],
          ['intakes', '研究线索', activity.intakes.length],
        ].map(([key, label, count]) => (
          <Link
            key={key}
            href={
              key === 'all' ? '/pilot/activity' : `/pilot/activity?view=${key}`
            }
            aria-current={view === key ? 'page' : undefined}
            className={cn(
              'flex min-h-11 items-center justify-center gap-1 rounded-lg px-2 text-sm font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/40',
              view === key
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground',
            )}
          >
            {label}
            <span className="text-xs">{count}</span>
          </Link>
        ))}
      </nav>

      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        匿名隐私报告不会关联到活动列表，请使用提交时保存的报告编号查看。
      </p>

      {total === 0 ? (
        <section className="mt-6 rounded-2xl border border-dashed border-border bg-card/60 p-8 text-center">
          <CheckCircle2
            aria-hidden="true"
            className="mx-auto size-8 text-primary"
          />
          <h2 className="mt-4 font-heading text-xl font-semibold">暂无记录</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            提交问题报告或研究线索后，处理进度会出现在这里。
          </p>
        </section>
      ) : null}

      {view !== 'intakes' && activity.reports.length ? (
        <section aria-labelledby="activity-reports" className="mt-7">
          <div className="flex items-center justify-between gap-3">
            <h2
              id="activity-reports"
              className="font-heading text-xl font-semibold"
            >
              问题报告
            </h2>
            <span className="text-sm text-muted-foreground">
              {activity.reports.length}
            </span>
          </div>
          <div className="mt-3 space-y-3">
            {activity.reports.map((report) => (
              <article
                key={report.code}
                className="rounded-2xl border border-border bg-card p-5 shadow-sm"
              >
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-amber-500/15 text-amber-800">
                    <FileWarning aria-hidden="true" className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">
                        {reportTypeLabel(report.type)}
                      </h3>
                      <Badge variant="secondary">
                        {reportStatusLabel(report.status)}
                      </Badge>
                    </div>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      {report.code} · {formatDateTime(report.updatedAt)}
                    </p>
                  </div>
                </div>
                <p className="mt-4 rounded-xl bg-muted/55 p-3 text-sm leading-6 text-foreground/75">
                  {report.publicResponse ??
                    reportProgressMessage(report.status)}
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Link
                    href={`/reports/${report.code}`}
                    className="inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-primary"
                  >
                    查看处理页
                    <ArrowRight aria-hidden="true" className="size-4" />
                  </Link>
                  {report.resolution ? (
                    <Link
                      href={`/answers/${report.resolution.slug}?tab=more`}
                      className="inline-flex min-h-10 items-center text-sm font-semibold text-primary"
                    >
                      {report.resolution.title}
                    </Link>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {view !== 'reports' && activity.intakes.length ? (
        <section aria-labelledby="activity-intakes" className="mt-8">
          <div className="flex items-center justify-between gap-3">
            <h2
              id="activity-intakes"
              className="font-heading text-xl font-semibold"
            >
              研究线索
            </h2>
            <span className="text-sm text-muted-foreground">
              {activity.intakes.length}
            </span>
          </div>
          <div className="mt-3 space-y-3">
            {activity.intakes.map((intake) => (
              <article
                key={intake.reference}
                className="rounded-2xl border border-border bg-card p-5 shadow-sm"
              >
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
                    <Lightbulb aria-hidden="true" className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">
                        {intake.kind === 'question' ? '问题线索' : '材料线索'}
                      </h3>
                      <Badge variant="outline">
                        {intakeStatusLabel(intake.status)}
                      </Badge>
                    </div>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      {intake.reference} · {formatDateTime(intake.submittedAt)}
                    </p>
                  </div>
                </div>
                {intake.decisionCode ? (
                  <p className="mt-4 rounded-xl bg-muted/55 p-3 text-sm leading-6 text-foreground/75">
                    处理结果：{intakeDecisionLabel(intake.decisionCode)}
                  </p>
                ) : null}
                {intake.linkedAnswer ? (
                  <Link
                    href={`/answers/${intake.linkedAnswer.slug}?tab=more`}
                    className="mt-3 inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-primary"
                  >
                    查看产出的公开答案
                    <ArrowRight aria-hidden="true" className="size-4" />
                  </Link>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}

function parseView(value: string | string[] | undefined): ActivityView {
  return value === 'reports' || value === 'intakes' ? value : 'all';
}

function intakeStatusLabel(status: string) {
  return (
    {
      submitted: '已收到',
      screening: '筛选中',
      actioned: '已采用',
      rejected: '未采用',
      expired: '已到期',
    }[status] ?? status
  );
}

function intakeDecisionLabel(code: string) {
  return (
    {
      draft_created: '已转为新答案草稿',
      linked_existing: '已关联现有答案',
      rejected_out_of_scope: '不在当前指南范围',
      rejected_insufficient: '信息暂不足以采用',
      duplicate: '与已有线索重复',
    }[code] ?? '处理已完成'
  );
}

function reportProgressMessage(status: string) {
  if (status === 'reviewing') return '编辑正在核查，完成后会显示公开处理说明。';
  if (status === 'resolved' || status === 'closed') {
    return '处理已完成，请打开处理页查看最新状态。';
  }
  return '报告已进入队列。';
}
