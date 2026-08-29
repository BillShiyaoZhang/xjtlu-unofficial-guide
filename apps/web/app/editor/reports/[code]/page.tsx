import { AlertTriangle } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ReportCaseActions } from '@/components/editor-case-actions';
import { EditorAccessDenied } from '@/components/editor-access-denied';
import { EditorNav } from '@/components/editor-nav';
import { Badge } from '@/components/ui/badge';
import { requireEditorPage } from '@/lib/authz';
import { getEditorReport } from '@/lib/editor-cases';
import { formatDateTime, reportTypeLabel } from '@/lib/presentation';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '报告处置' };

export default async function EditorReportPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const { user, allowed } = await requireEditorPage(
    `/editor/reports/${code}`,
    'safety:manage',
  );
  if (!allowed) return <EditorAccessDenied email={user.email} />;
  const report = await getEditorReport(code, user.userId);
  if (!report) notFound();
  return (
    <main
      id="main-content"
      className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8"
    >
      <EditorNav
        displayName={user.displayName}
        permissions={user.permissions}
      />
      <header className="rounded-2xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs text-primary">
              {report.publicCode}
            </p>
            <h1 className="mt-2 font-heading text-3xl font-semibold">
              {reportTypeLabel(report.type)} · {report.cardTitle ?? '全站'}
            </h1>
          </div>
          <div className="flex gap-2">
            <Badge
              variant={
                report.priority === 'critical' ? 'destructive' : 'secondary'
              }
            >
              {report.priority}
            </Badge>
            <Badge variant="outline">{report.status}</Badge>
          </div>
        </div>
        <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">提交</dt>
            <dd className="mt-1">{formatDateTime(report.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">SLA</dt>
            <dd className="mt-1">
              {report.slaDueAt ? formatDateTime(report.slaDueAt) : '未设置'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">负责人</dt>
            <dd className="mt-1 font-mono text-xs">
              {report.assigneeEditorId ?? '待认领'}
            </dd>
          </div>
        </dl>
      </header>
      <div className="mt-7">
        <ReportCaseActions
          id={report.id}
          code={report.publicCode}
          status={report.status}
          lockVersion={report.lockVersion}
        />
      </div>
      <Notes notes={report.notes} />
    </main>
  );
}

function Notes({
  notes,
}: {
  notes: Array<{
    id: string;
    body: string;
    authorEditorId: string;
    createdAt: number;
  }>;
}) {
  return (
    <section className="mt-8">
      <div className="flex items-center gap-2 border-b border-border pb-3">
        <AlertTriangle className="size-4 text-primary" />
        <h2 className="font-heading text-xl font-semibold">处置记录</h2>
      </div>
      <div className="mt-4 space-y-3">
        {notes.length ? (
          notes.map((note) => (
            <article
              key={note.id}
              className="rounded-xl border border-border bg-card p-4"
            >
              <p className="whitespace-pre-wrap text-sm leading-6">
                {note.body}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {formatDateTime(note.createdAt)} ·{' '}
                {note.authorEditorId.slice(0, 16)}
              </p>
            </article>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">暂无内部记录</p>
        )}
      </div>
    </section>
  );
}
