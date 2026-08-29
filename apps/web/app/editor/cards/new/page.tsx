import type { Metadata } from 'next';

import { EditorAccessDenied } from '@/components/editor-access-denied';
import { EditorCardForm } from '@/components/editor-card-form';
import { EditorNav } from '@/components/editor-nav';
import { requireEditorPage } from '@/lib/authz';
import { defaultEditorDates } from '@/lib/presentation';
import { listScopes, listTopics } from '@/lib/repository';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '新建答案卡' };

export default async function NewEditorCardPage() {
  const { user, allowed } = await requireEditorPage('/editor/cards/new');
  if (!allowed) return <EditorAccessDenied email={user.email} />;
  const [topics, scopes] = await Promise.all([listTopics(), listScopes()]);
  const dates = defaultEditorDates();
  return (
    <main
      id="main-content"
      className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8"
    >
      <EditorNav displayName={user.displayName} />
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
          New answer card
        </p>
        <h1 className="mt-2 font-heading text-4xl font-semibold">
          创建答案卡草稿
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          保存不会公开；数据库会创建稳定答案卡和首个不可变修订，随后在审核区单独发布。
        </p>
      </header>
      <EditorCardForm
        mode="new"
        topics={topics}
        scopes={scopes}
        initial={{
          title: '',
          summary: '',
          scopeMode: 'constrained',
          scopeIds: scopes.map((scope) => scope.id),
          asOf: dates.asOf,
          reviewDueOn: dates.reviewDueOn,
          reviewOwnerLabel: '内容编辑组',
          disputeStatus: 'none',
          evidenceNote: '',
          sentences: [],
        }}
      />
    </main>
  );
}
