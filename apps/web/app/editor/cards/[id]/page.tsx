import { History } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { EditorAccessDenied } from '@/components/editor-access-denied';
import { AnswerCardVisibilityPanel } from '@/components/answer-card-visibility-panel';
import { EditorCardForm } from '@/components/editor-card-form';
import { EditorNav } from '@/components/editor-nav';
import { PublishRevisionPanel } from '@/components/publish-revision-panel';
import { Badge } from '@/components/ui/badge';
import { requireEditorPage } from '@/lib/authz';
import { formatDateTime } from '@/lib/presentation';
import { getEditorCard, listScopes, listTopics } from '@/lib/repository';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '编辑答案卡' };

export default async function EditorCardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { user, allowed } = await requireEditorPage(`/editor/cards/${id}`);
  if (!allowed) return <EditorAccessDenied email={user.email} />;
  const [data, topics, scopes] = await Promise.all([
    getEditorCard(id),
    listTopics(),
    listScopes(),
  ]);
  if (!data || !data.latestDraft) notFound();
  const latest = data.revisions[0];
  const hasDraft = latest.id !== data.card.currentPublicRevisionId;
  return (
    <main
      id="main-content"
      className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8"
    >
      <EditorNav displayName={user.displayName} />
      <header className="mb-8">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{data.card.topicTitle}</Badge>
          <Badge variant="outline">对象版本 {data.card.lockVersion}</Badge>
          <Badge variant="outline">{data.card.publicationStatus}</Badge>
        </div>
        <h1 className="mt-4 font-heading text-4xl font-semibold">
          {data.latestDraft.title}
        </h1>
        <p className="mt-2 font-mono text-xs text-muted-foreground">
          /{data.card.slug}
        </p>
      </header>

      {hasDraft ? (
        <div className="mb-8">
          <PublishRevisionPanel
            revisionId={latest.id}
            lockVersion={data.card.lockVersion}
          />
        </div>
      ) : null}

      <AnswerCardVisibilityPanel
        cardId={data.card.id}
        status={data.card.publicationStatus}
        lockVersion={data.card.lockVersion}
      />

      <EditorCardForm
        mode="revision"
        cardId={data.card.id}
        lockVersion={data.card.lockVersion}
        topics={topics}
        scopes={scopes}
        riskLevel={data.card.riskLevel}
        initial={{
          title: data.latestDraft.title,
          summary: data.latestDraft.summary,
          scopeMode: data.latestDraft.scopeMode,
          scopeIds: data.latestDraft.scopeIds,
          asOf: data.latestDraft.asOf,
          reviewDueOn: new Date(data.latestDraft.reviewDueAt * 1000)
            .toISOString()
            .slice(0, 10),
          reviewOwnerLabel: data.latestDraft.reviewOwnerLabel,
          disputeStatus: data.latestDraft.disputeStatus,
          evidenceNote: data.latestDraft.evidenceNote ?? '',
          sentences: data.latestDraft.sentences,
        }}
      />

      <section className="mt-10 rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2">
          <History className="size-5 text-primary" />
          <h2 className="font-heading text-2xl font-semibold">所有修订</h2>
        </div>
        <ol className="mt-5 space-y-3">
          {data.revisions.map((revision) => (
            <li
              key={revision.id}
              className="flex flex-col justify-between gap-2 rounded-lg border border-border p-4 sm:flex-row sm:items-center"
            >
              <div>
                <p className="font-semibold">
                  v{revision.versionNumber} · {revision.title}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  创建于 {formatDateTime(revision.createdAt)} ·{' '}
                  {revision.evidenceCoverage}
                </p>
              </div>
              <div className="flex gap-2">
                {revision.isCurrent ? <Badge>当前公开</Badge> : null}
                {revision.publishedAt ? (
                  <Badge variant="outline">曾发布</Badge>
                ) : (
                  <Badge variant="secondary">草稿</Badge>
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
