import {
  Activity,
  AlertTriangle,
  FileClock,
  Inbox,
  LibraryBig,
  MousePointerClick,
  Plus,
  ScrollText,
  SearchX,
  Target,
  Users,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EditorAccessDenied } from '@/components/editor-access-denied';
import { EditorNav } from '@/components/editor-nav';
import { PilotInvitationManager } from '@/components/pilot-invitation-manager';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { requireEditorPage } from '@/lib/authz';
import { hasEditorPermission } from '@/lib/editor-session';
import { getPilotAdminSnapshot, type PilotMetricSet } from '@/lib/pilot';
import {
  formatDate,
  formatDateTime,
  reportAffectedAreaLabel,
  reportTypeLabel,
} from '@/lib/presentation';
import { getEditorDashboard } from '@/lib/repository';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '编辑工作台' };

export default async function EditorDashboardPage() {
  const { user, allowed } = await requireEditorPage('/editor');
  if (!allowed) return <EditorAccessDenied email={user.email} />;
  const canContent = hasEditorPermission(user, 'content:read');
  const canSafety = hasEditorPermission(user, 'safety:manage');
  const canPilot = hasEditorPermission(user, 'pilot:manage');
  const canAudit =
    hasEditorPermission(user, 'operations:manage') ||
    hasEditorPermission(user, 'accounts:manage');
  const [dashboard, pilot] = await Promise.all([
    getEditorDashboard(user.userId, {
      content: canContent,
      safety: canSafety,
      audit: canAudit,
    }),
    canPilot ? getPilotAdminSnapshot(user.userId) : Promise.resolve(null),
  ]);
  return (
    <main
      id="main-content"
      className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8"
    >
      <EditorNav
        displayName={user.displayName}
        permissions={user.permissions}
      />
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
        {hasEditorPermission(user, 'content:edit') ? (
          <Link
            href="/editor/cards/new"
            className={cn(buttonVariants({ size: 'lg' }), 'min-h-11')}
          >
            <Plus />
            新建答案卡
          </Link>
        ) : null}
      </header>

      <section
        aria-label="队列摘要"
        className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        {canContent ? (
          <>
            <Summary
              icon={LibraryBig}
              label="答案卡总数"
              value={dashboard.queueCounts.totalCards}
            />
            <Summary
              icon={FileClock}
              label="待发布草稿"
              value={dashboard.queueCounts.draftCards}
            />
            <Summary
              icon={AlertTriangle}
              label="逾期待复核"
              value={dashboard.queueCounts.overdueCards}
              tone={dashboard.queueCounts.overdueCards ? 'warning' : 'default'}
            />
          </>
        ) : null}
        {canSafety ? (
          <Summary
            icon={Inbox}
            label="待处理报告 / 线索"
            value={
              dashboard.queueCounts.openReports +
              dashboard.queueCounts.openIntakes
            }
          />
        ) : null}
      </section>

      {pilot ? (
        <>
          <section aria-labelledby="pilot-metrics-heading" className="mt-10">
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
              <div>
                <h2
                  id="pilot-metrics-heading"
                  className="font-heading text-2xl font-semibold"
                >
                  试点指标
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  仅“正式成年研究队列”用于继续 / 停止判断；未反馈按未解决。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">规则 explicit-submit-v2</Badge>
                <Badge
                  variant={
                    pilot.metricWindow.configured ? 'secondary' : 'outline'
                  }
                >
                  {pilot.metricWindow.configured &&
                  pilot.metricWindow.startAt !== null &&
                  pilot.metricWindow.endAt !== null
                    ? `${formatDate(pilot.metricWindow.startAt)}—${formatDate(
                        pilot.metricWindow.endAt - 1,
                      )}`
                    : '未冻结窗口 · 全部历史预览'}
                </Badge>
              </div>
            </div>
            {!pilot.metricWindow.configured ? (
              <p className="mt-4 rounded-xl border border-amber-700/20 bg-amber-500/10 px-4 py-3 text-xs leading-5 text-amber-950">
                尚未配置四周试点起止时间，下面数字只能用于本地探索，不能据此判断继续或停止。
              </p>
            ) : null}
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                icon={Activity}
                label="合格查询"
                value={`${pilot.formal.queries} / 150`}
                detail="明确提交且非测试流量"
              />
              <MetricCard
                icon={SearchX}
                label="零结果率"
                value={ratio(pilot.formal.zeroResults, pilot.formal.completed)}
                detail={`${pilot.formal.zeroResults} / ${pilot.formal.completed} 次完成检索`}
              />
              <MetricCard
                icon={MousePointerClick}
                label="反馈覆盖率"
                value={ratio(pilot.formal.responded, pilot.formal.queries)}
                detail={`${pilot.formal.responded} / ${pilot.formal.queries} 次查询`}
              />
              <MetricCard
                icon={Target}
                label="全查询解决率"
                value={ratio(pilot.formal.resolved, pilot.formal.queries)}
                detail={`${pilot.formal.resolved} / ${pilot.formal.queries} · 闸门 60%`}
                tone={
                  pilot.metricWindow.configured &&
                  pilot.formal.queries > 0 &&
                  pilot.formal.resolved / pilot.formal.queries >= 0.6
                    ? 'positive'
                    : 'default'
                }
              />
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
              <MetricCard
                icon={Users}
                label="去重成年参与者"
                value={`${pilot.participants} / 50`}
                detail="窗口内有合格查询且未撤回"
                compact
              />
              <MetricCard
                icon={MousePointerClick}
                label="答案打开率"
                value={ratio(pilot.formal.opened, pilot.formal.queries)}
                detail={`${pilot.formal.opened} / ${pilot.formal.queries}`}
                compact
              />
              <MetricCard
                icon={Activity}
                label="参与者分享率"
                value={ratio(pilot.sharingParticipants, pilot.participants)}
                detail={`${pilot.sharingParticipants} / ${pilot.participants} 人 · ${pilot.formal.shared} 次查询分享 · 闸门 20%`}
                tone={
                  pilot.metricWindow.configured &&
                  pilot.participants > 0 &&
                  pilot.sharingParticipants / pilot.participants >= 0.2
                    ? 'positive'
                    : 'default'
                }
                compact
              />
              <MetricCard
                icon={Target}
                label="Top 3 确认有效率"
                value={ratio(
                  pilot.formal.topThreeResolved,
                  pilot.formal.queries,
                )}
                detail={`${pilot.formal.topThreeResolved} / ${pilot.formal.queries}`}
                compact
              />
              <MetricCard
                icon={Target}
                label="回应者解决率"
                value={ratio(pilot.formal.resolved, pilot.formal.responded)}
                detail={`${pilot.formal.resolved} / ${pilot.formal.responded} · 仅诊断`}
                compact
              />
              <MetricCard
                icon={AlertTriangle}
                label="检索错误率"
                value={ratio(
                  pilot.formal.retrievalErrors,
                  pilot.formal.queries,
                )}
                detail={`${pilot.formal.retrievalErrors} / ${pilot.formal.queries}`}
                compact
              />
            </div>
            <AnonymousMetrics metrics={pilot.anonymous} />
          </section>

          <section
            aria-labelledby="pilot-invitations-heading"
            className="mt-12"
          >
            <div className="border-b border-border pb-4">
              <h2
                id="pilot-invitations-heading"
                className="font-heading text-2xl font-semibold"
              >
                试点邀请
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                研究编号与邀请代码只在签发后显示一次；数据库不保存原文。
              </p>
            </div>
            <div className="mt-5">
              <PilotInvitationManager invitations={pilot.invitations} />
            </div>
          </section>
        </>
      ) : null}

      {canContent ? (
        <section aria-labelledby="cards-heading" className="mt-10">
          <div className="flex items-center justify-between border-b border-border pb-4">
            <h2
              id="cards-heading"
              className="font-heading text-2xl font-semibold"
            >
              答案卡与修订
            </h2>
            <Link
              href="/editor/content"
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
            >
              查看全部 {dashboard.queueCounts.totalCards} 张
            </Link>
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
      ) : null}

      {canSafety ? (
        <div className="mt-12 grid gap-8 xl:grid-cols-2">
          <section aria-labelledby="reports-heading">
            <div className="flex items-center justify-between gap-3">
              <h2
                id="reports-heading"
                className="font-heading text-2xl font-semibold"
              >
                问题报告
              </h2>
              <Link
                href="/editor/reports"
                className={cn(
                  buttonVariants({ variant: 'outline', size: 'sm' }),
                )}
              >
                查看全部
              </Link>
            </div>
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
                          {report.cardTitle ??
                            reportAffectedAreaLabel(report.affectedArea) ??
                            '全站'}
                        </h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          提交于 {formatDateTime(report.createdAt)}
                        </p>
                      </div>
                      <Badge
                        variant={
                          report.type === 'privacy'
                            ? 'destructive'
                            : 'secondary'
                        }
                      >
                        {report.status}
                      </Badge>
                    </div>
                    <Link
                      href={`/editor/reports/${report.publicCode}`}
                      className={cn(
                        buttonVariants({ variant: 'outline', size: 'sm' }),
                        'mt-4',
                      )}
                    >
                      打开处置
                    </Link>
                  </article>
                ))
              ) : (
                <Empty text="暂无待处理报告" />
              )}
            </div>
          </section>
          <section aria-labelledby="intakes-heading">
            <div className="flex items-center justify-between gap-3">
              <h2
                id="intakes-heading"
                className="font-heading text-2xl font-semibold"
              >
                私有研究线索
              </h2>
              <Link
                href="/editor/intakes"
                className={cn(
                  buttonVariants({ variant: 'outline', size: 'sm' }),
                )}
              >
                查看全部
              </Link>
            </div>
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
                          {intake.kind === 'question' ? '问题线索' : '材料线索'}{' '}
                          · {intake.contextScope}
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
                    <Link
                      href={`/editor/intakes/${intake.id}`}
                      className={cn(
                        buttonVariants({ variant: 'outline', size: 'sm' }),
                        'mt-4',
                      )}
                    >
                      打开处置
                    </Link>
                  </article>
                ))
              ) : (
                <Empty text="暂无待处理私有线索" />
              )}
            </div>
          </section>
        </div>
      ) : null}

      {canAudit ? (
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
      ) : null}
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

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  compact = false,
  tone = 'default',
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  detail: string;
  compact?: boolean;
  tone?: 'default' | 'positive';
}) {
  return (
    <div
      className={cn(
        'rounded-xl border bg-card p-4',
        tone === 'positive' ? 'border-emerald-700/25' : 'border-border',
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          'size-4',
          tone === 'positive' ? 'text-emerald-700' : 'text-primary',
        )}
      />
      <p
        className={cn(
          'mt-3 font-heading font-semibold',
          compact ? 'text-2xl' : 'text-3xl',
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-sm font-semibold">{label}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function AnonymousMetrics({ metrics }: { metrics: PilotMetricSet }) {
  return (
    <details className="mt-4 rounded-xl border border-border bg-muted/35">
      <summary className="min-h-12 cursor-pointer px-4 py-3 text-sm font-semibold">
        公开匿名事件级诊断
      </summary>
      <div className="grid gap-3 border-t border-border p-4 text-sm sm:grid-cols-4">
        <p>
          查询 <strong>{metrics.queries}</strong>
        </p>
        <p>
          零结果 <strong>{metrics.zeroResults}</strong>
        </p>
        <p>
          有反馈 <strong>{metrics.responded}</strong>
        </p>
        <p>
          已解决 <strong>{metrics.resolved}</strong>
        </p>
        <p className="text-xs text-muted-foreground sm:col-span-4">
          这里只计算独立查询事件；不计算人数、复用率，也不建立公开用户画像。
        </p>
      </div>
    </details>
  );
}

function ratio(numerator: number, denominator: number) {
  if (!denominator) return '—';
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}
