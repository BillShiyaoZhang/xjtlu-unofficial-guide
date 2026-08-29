import { Inbox } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { Filters, Pager } from '@/app/editor/reports/page';
import { EditorAccessDenied } from '@/components/editor-access-denied';
import { EditorNav } from '@/components/editor-nav';
import { Badge } from '@/components/ui/badge';
import { requireEditorPage } from '@/lib/authz';
import { listEditorIntakes } from '@/lib/editor-cases';
import { formatDateTime } from '@/lib/presentation';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '研究线索队列' };

export default async function EditorIntakesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user, allowed } = await requireEditorPage(
    '/editor/intakes',
    'safety:manage',
  );
  if (!allowed) return <EditorAccessDenied email={user.email} />;
  const params = await searchParams;
  const status = typeof params.status === 'string' ? params.status : undefined;
  const page = typeof params.page === 'string' ? Number(params.page) : 1;
  const result = await listEditorIntakes({
    page,
    status,
    actorId: user.userId,
  });
  return (
    <main
      id="main-content"
      className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8"
    >
      <EditorNav
        displayName={user.displayName}
        permissions={user.permissions}
      />
      <header className="mb-7 flex items-center gap-4">
        <span className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
          <Inbox />
        </span>
        <div>
          <h1 className="font-heading text-3xl font-semibold">私有研究线索</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            共 {result.total} 条 · 到期顺序展示
          </p>
        </div>
      </header>
      <Filters
        base="/editor/intakes"
        values={['submitted', 'screening', 'actioned', 'rejected', 'expired']}
        active={status}
      />
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {result.items.map((item) => (
          <Link
            key={item.id}
            href={`/editor/intakes/${item.id}`}
            className="rounded-xl border border-border bg-card p-5 transition hover:border-primary/40"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-xs text-primary">{item.id}</p>
                <h2 className="mt-2 font-semibold">
                  {item.kind === 'question' ? '问题线索' : '材料线索'} ·{' '}
                  {item.contextScope}
                </h2>
              </div>
              <Badge variant="outline">{item.status}</Badge>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              提交 {formatDateTime(item.submittedAt)} · 清理{' '}
              {formatDateTime(item.expiresAt)}
            </p>
          </Link>
        ))}
      </div>
      <Pager
        base="/editor/intakes"
        page={result.page}
        pages={result.pages}
        status={status}
      />
    </main>
  );
}
