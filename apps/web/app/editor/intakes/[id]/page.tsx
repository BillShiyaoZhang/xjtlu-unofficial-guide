import { Inbox } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { IntakeCaseActions } from '@/components/editor-case-actions';
import { EditorAccessDenied } from '@/components/editor-access-denied';
import { EditorNav } from '@/components/editor-nav';
import { Badge } from '@/components/ui/badge';
import { requireEditorPage } from '@/lib/authz';
import { getEditorIntake } from '@/lib/editor-cases';
import { formatDateTime } from '@/lib/presentation';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '研究线索处置' };

export default async function EditorIntakePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { user, allowed } = await requireEditorPage(
    `/editor/intakes/${id}`,
    'safety:manage',
  );
  if (!allowed) return <EditorAccessDenied email={user.email} />;
  const intake = await getEditorIntake(id, user.userId);
  if (!intake) notFound();
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
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs text-primary">{intake.id}</p>
            <h1 className="mt-2 font-heading text-3xl font-semibold">
              {intake.kind === 'question' ? '问题线索' : '材料线索'} ·{' '}
              {intake.contextScope}
            </h1>
          </div>
          <Badge variant="outline">{intake.status}</Badge>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          提交 {formatDateTime(intake.submittedAt)} · 清理期限{' '}
          {formatDateTime(intake.expiresAt)}
        </p>
        {intake.body ? (
          <p className="mt-5 whitespace-pre-wrap rounded-xl bg-muted/55 p-4 text-sm leading-6">
            {intake.body}
          </p>
        ) : null}
        {intake.sourceUrl ? (
          <a
            href={intake.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-4 block break-all text-sm text-primary underline"
          >
            {intake.sourceUrl}
          </a>
        ) : null}
      </header>
      <div className="mt-7">
        <IntakeCaseActions
          id={intake.id}
          status={intake.status}
          lockVersion={intake.lockVersion}
        />
      </div>
      <section className="mt-8">
        <div className="flex items-center gap-2 border-b border-border pb-3">
          <Inbox className="size-4 text-primary" />
          <h2 className="font-heading text-xl font-semibold">处置记录</h2>
        </div>
        <div className="mt-4 space-y-3">
          {intake.notes.length ? (
            intake.notes.map((note) => (
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
    </main>
  );
}
