import {
  AlertTriangle,
  FileClock,
  Inbox,
  Plus,
  ScrollText,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EditorAccessDenied } from '@/components/editor-access-denied';
import { EditorNav } from '@/components/editor-nav';
import {
  IntakeActions,
  ReportActions,
} from '@/components/editor-queue-actions';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { requireEditorPage } from '@/lib/authz';
import {
  formatDate,
  formatDateTime,
  reportTypeLabel,
} from '@/lib/presentation';
import { getEditorDashboard } from '@/lib/repository';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '编辑工作台' };

export default async function EditorDashboardPage() {
  const { user, allowed } = await requireEditorPage('/editor');
  if (!allowed) return <EditorAccessDenied email={user.email} />;
  const dashboard = await getEditorDashboard(user.userId);
  const overdue = dashboard.cards.filter((card) => card.isOverdue);
  const drafts = dashboard.cards.filter((card) => card.hasUnpublishedDraft);

  return (
    <main
      id="main-content"
      className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8"
    >
      <EditorNav displayName={user.displayName} />
      <header className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            Editor workspace
          </p>
          <h1 className="mt-2 font-heading text-4xl font-semibold tracking-tight">
            阶段 1 编辑工作台
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            登录身份与编辑授权分离；所有敏感队列读取和发布操作都会写审计记录。
          </p>
        </div>
        <Link
          href="/editor/cards/new"
          className={cn(buttonVariants({ size: 'lg' }), 'min-h-11')}
        >
          <Plus />
          新建答案卡
        </Link>
      </header>

      <section aria-label="队列摘要" className="mt-8 grid gap-3 sm:grid-cols-3">
        <Summary icon={FileClock} label="待发布草稿" value={drafts.length} />
        <Summary
          icon={AlertTriangle}
          label="逾期待复核"
          value={overdue.length}
          tone={overdue.length ? 'warning' : 'default'}
        />
        <Summary
          icon={Inbox}
          label="待处理报告 / 线索"
          value={dashboard.reports.length + dashboard.intakes.length}
        />
      </section>

      <section aria-labelledby="cards-heading" className="mt-10">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <h2
            id="cards-heading"
            className="font-heading text-2xl font-semibold"
          >
            答案卡与修订
          </h2>
          <span className="text-xs text-muted-foreground">
            {dashboard.cards.length} 张
          </span>
        </div>
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {dashboard.cards.map((card) => {
            const isOverdue = card.isOverdue;
            return (
              <article
                key={card.id}
                className="rounded-xl border border-border bg-card p-5 shadow-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{card.topicTitle}</Badge>
                  <Badge
                    variant={
                      card.publicationStatus === 'published'
                        ? 'outline'
                        : 'secondary'
                    }
                  >
                    {card.publicationStatus}
                  </Badge>
                  {card.hasUnpublishedDraft ? (
                    <Badge>有未发布草稿</Badge>
                  ) : null}
                  {isOverdue ? (
                    <Badge variant="destructive">已逾期</Badge>
                  ) : null}
                </div>
                <h3 className="mt-4 font-heading text-xl font-semibold">
                  {card.currentTitle ?? card.latestTitle ?? card.slug}
                </h3>
                <dl className="mt-4 grid gap-3 text-xs text-muted-foreground sm:grid-cols-2">
                  <div>
                    <dt className="font-semibold text-foreground/70">
                      对象版本
                    </dt>
                    <dd className="mt-1">{card.lockVersion}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-foreground/70">
                      最新修订
                    </dt>
                    <dd className="mt-1">v{card.latestVersionNumber ?? 0}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="font-semibold text-foreground/70">
                      下次复核
                    </dt>
                    <dd className="mt-1">
                      {card.currentReviewDueAt
                        ? formatDate(card.currentReviewDueAt)
                        : '尚未发布'}
                    </dd>
                  </div>
                </dl>
                <Link
                  href={`/editor/cards/${card.id}`}
                  className={cn(
                    buttonVariants({ variant: 'outline', size: 'lg' }),
                    'mt-5 min-h-11',
                  )}
                >
                  打开编辑与审核
                </Link>
              </article>
            );
          })}
        </div>
      </section>

      <div className="mt-12 grid gap-8 xl:grid-cols-2">
        <section aria-labelledby="reports-heading">
          <h2
            id="reports-heading"
            className="font-heading text-2xl font-semibold"
          >
            问题报告
          </h2>
          <div className="mt-4 space-y-3">
            {dashboard.reports.length ? (
              dashboard.reports.map((report) => (
                <article
                  key={report.publicCode}
                  className="rounded-xl border border-border bg-card p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-xs text-primary">
                        {report.publicCode}
                      </p>
                      <h3 className="mt-1 font-semibold">
                        {reportTypeLabel(report.type)} ·{' '}
                        {report.cardTitle ?? '全站'}
                      </h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        提交于 {formatDateTime(report.createdAt)}
                      </p>
                    </div>
                    <Badge
                      variant={
                        report.type === 'privacy' ? 'destructive' : 'secondary'
                      }
                    >
                      {report.status}
                    </Badge>
                  </div>
                  <div className="mt-4">
                    <ReportActions
                      code={report.publicCode}
                      status={report.status}
                      lockVersion={report.lockVersion}
                    />
                  </div>
                </article>
              ))
            ) : (
              <Empty text="暂无待处理报告" />
            )}
          </div>
        </section>
        <section aria-labelledby="intakes-heading">
          <h2
            id="intakes-heading"
            className="font-heading text-2xl font-semibold"
          >
            私有研究线索
          </h2>
          <div className="mt-4 space-y-3">
            {dashboard.intakes.length ? (
              dashboard.intakes.map((intake) => (
                <article
                  key={intake.id}
                  className="rounded-xl border border-border bg-card p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-xs text-primary">
                        {intake.id}
                      </p>
                      <h3 className="mt-1 font-semibold">
                        {intake.kind === 'question' ? '问题线索' : '材料线索'} ·{' '}
                        {intake.contextScope}
                      </h3>
                    </div>
                    <Badge variant="secondary">{intake.status}</Badge>
                  </div>
                  {intake.body ? (
                    <p className="mt-3 whitespace-pre-wrap rounded-lg bg-muted/55 p-3 text-sm leading-6">
                      {intake.body}
                    </p>
                  ) : null}
                  {intake.sourceUrl ? (
                    <a
                      href={intake.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 block break-all text-sm text-primary underline"
                    >
                      {intake.sourceUrl}
                    </a>
                  ) : null}
                  <p className="mt-3 text-xs text-muted-foreground">
                    载荷最晚清理：{formatDate(intake.expiresAt)}
                  </p>
                  <div className="mt-4">
                    <IntakeActions
                      id={intake.id}
                      status={intake.status}
                      lockVersion={intake.lockVersion}
                    />
                  </div>
                </article>
              ))
            ) : (
              <Empty text="暂无待处理私有线索" />
            )}
          </div>
        </section>
      </div>

      <section aria-labelledby="audit-heading" className="mt-12">
        <div className="flex items-center gap-2">
          <ScrollText className="size-5 text-primary" />
          <h2
            id="audit-heading"
            className="font-heading text-2xl font-semibold"
          >
            最近审计事件
          </h2>
        </div>
        <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-180 text-left text-sm">
            <thead className="bg-muted/65 text-xs text-muted-foreground">
              <tr>
                <th className="p-3">时间</th>
                <th className="p-3">动作</th>
                <th className="p-3">目标</th>
                <th className="p-3">理由</th>
                <th className="p-3">操作者</th>
              </tr>
            </thead>
            <tbody>
              {dashboard.auditEvents.map((event) => (
                <tr key={event.id} className="border-t border-border">
                  <td className="p-3 whitespace-nowrap">
                    {formatDateTime(event.createdAt)}
                  </td>
                  <td className="p-3 font-mono text-xs">{event.action}</td>
                  <td className="p-3">
                    {event.targetType} · {event.targetId}
                  </td>
                  <td className="p-3">{event.reason}</td>
                  <td className="p-3 font-mono text-xs">
                    {event.actorId.slice(0, 16)}…
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function Summary({
  icon: Icon,
  label,
  value,
  tone = 'default',
}: {
  icon: typeof FileClock;
  label: string;
  value: number;
  tone?: 'default' | 'warning';
}) {
  return (
    <div
      className={cn(
        'rounded-xl border bg-card p-5',
        tone === 'warning' ? 'border-amber-600/25' : 'border-border',
      )}
    >
      <Icon
        className={cn(
          'size-5',
          tone === 'warning' ? 'text-amber-700' : 'text-primary',
        )}
      />
      <p className="mt-5 font-heading text-3xl font-semibold">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}
