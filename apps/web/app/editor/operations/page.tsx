import {
  Activity,
  CheckCircle2,
  DatabaseBackup,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import type { Metadata } from 'next';

import { EditorAccessDenied } from '@/components/editor-access-denied';
import { EditorNav } from '@/components/editor-nav';
import { Badge } from '@/components/ui/badge';
import { requireEditorPage } from '@/lib/authz';
import { getOperationsSnapshot } from '@/lib/operations';
import { formatDateTime } from '@/lib/presentation';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '运行状态' };

export default async function EditorOperationsPage() {
  const { user, allowed } = await requireEditorPage(
    '/editor/operations',
    'operations:manage',
  );
  if (!allowed) return <EditorAccessDenied email={user.email} />;
  const snapshot = await getOperationsSnapshot();
  return (
    <main
      id="main-content"
      className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8"
    >
      <EditorNav
        displayName={user.displayName}
        permissions={user.permissions}
      />
      <header className="mb-8 flex items-center gap-4">
        <span
          className={`grid size-12 place-items-center rounded-2xl ${snapshot.ready ? 'bg-emerald-500/10 text-emerald-700' : 'bg-amber-500/10 text-amber-800'}`}
        >
          {snapshot.ready ? <CheckCircle2 /> : <ShieldAlert />}
        </span>
        <div>
          <h1 className="font-heading text-3xl font-semibold">运行状态</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {snapshot.ready ? '正式运行检查全部通过' : '仍有正式运行条件未满足'}
          </p>
        </div>
      </header>

      <section
        aria-label="当前计数"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <Stat label="逾期报告" value={snapshot.counts.overdueReports} />
        <Stat label="逾期私有载荷" value={snapshot.counts.overdueIntakes} />
        <Stat label="活跃编辑会话" value={snapshot.counts.activeSessions} />
        <Stat label="活跃限流窗口" value={snapshot.counts.activeRateWindows} />
      </section>

      <section className="mt-10">
        <h2 className="font-heading text-2xl font-semibold">正式运行检查</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {snapshot.readiness.map((check) => (
            <div
              key={check.key}
              className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 text-sm"
            >
              {check.ok ? (
                <CheckCircle2 className="size-5 shrink-0 text-emerald-700" />
              ) : (
                <XCircle className="size-5 shrink-0 text-destructive" />
              )}
              <span>{check.label}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        <RunList
          icon={Activity}
          title="保留与完整性任务"
          rows={snapshot.maintenanceRuns.map((run) => ({
            id: run.id,
            status: run.status,
            startedAt: run.startedAt,
            completedAt: run.completedAt,
          }))}
        />
        <RunList
          icon={DatabaseBackup}
          title="备份证明"
          rows={snapshot.backupRuns.map((run) => ({
            id: run.id,
            status: run.status,
            startedAt: run.startedAt,
            completedAt: run.completedAt,
          }))}
        />
      </div>
      <div className="mt-8">
        <RunList
          icon={DatabaseBackup}
          title="恢复演练"
          rows={snapshot.recoveryDrills.map((run) => ({
            id: run.id,
            status: run.status,
            startedAt: run.startedAt,
            completedAt: run.completedAt,
          }))}
        />
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="font-heading text-3xl font-semibold">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

function RunList({
  icon: Icon,
  title,
  rows,
}: {
  icon: typeof Activity;
  title: string;
  rows: Array<{
    id: string;
    status: string;
    startedAt: number;
    completedAt: number | null;
  }>;
}) {
  return (
    <section>
      <div className="flex items-center gap-2">
        <Icon className="size-5 text-primary" />
        <h2 className="font-heading text-2xl font-semibold">{title}</h2>
      </div>
      <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
        {rows.length ? (
          rows.map((row) => (
            <div
              key={row.id}
              className="flex items-center justify-between gap-4 border-b border-border p-4 last:border-b-0"
            >
              <div>
                <p className="font-mono text-xs">{row.id.slice(0, 18)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatDateTime(row.startedAt)}
                  {row.completedAt
                    ? ` → ${formatDateTime(row.completedAt)}`
                    : ''}
                </p>
              </div>
              <Badge
                variant={
                  row.status === 'succeeded'
                    ? 'secondary'
                    : row.status === 'failed'
                      ? 'destructive'
                      : 'outline'
                }
              >
                {row.status}
              </Badge>
            </div>
          ))
        ) : (
          <p className="p-5 text-sm text-muted-foreground">尚无运行证明</p>
        )}
      </div>
    </section>
  );
}
