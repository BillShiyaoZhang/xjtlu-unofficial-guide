import { AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EditorAccessDenied } from '@/components/editor-access-denied';
import { EditorNav } from '@/components/editor-nav';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { requireEditorPage } from '@/lib/authz';
import { listEditorReports } from '@/lib/editor-cases';
import { formatDateTime, reportTypeLabel } from '@/lib/presentation';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '问题报告队列' };

export default async function EditorReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user, allowed } = await requireEditorPage(
    '/editor/reports',
    'safety:manage',
  );
  if (!allowed) return <EditorAccessDenied email={user.email} />;
  const params = await searchParams;
  const status = typeof params.status === 'string' ? params.status : undefined;
  const page = typeof params.page === 'string' ? Number(params.page) : 1;
  const result = await listEditorReports({
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
        <span className="grid size-12 place-items-center rounded-2xl bg-destructive/10 text-destructive">
          <AlertTriangle />
        </span>
        <div>
          <h1 className="font-heading text-3xl font-semibold">问题报告</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            共 {result.total} 条 · 优先级与 SLA 排序
          </p>
        </div>
      </header>
      <Filters
        base="/editor/reports"
        values={['received', 'reviewing', 'resolved', 'closed']}
        active={status}
      />
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {result.items.map((item) => (
          <Link
            key={item.id}
            href={`/editor/reports/${item.publicCode}`}
            className="rounded-xl border border-border bg-card p-5 transition hover:border-primary/40"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-xs text-primary">
                  {item.publicCode}
                </p>
                <h2 className="mt-2 font-semibold">
                  {reportTypeLabel(item.type)} · {item.cardTitle ?? '全站'}
                </h2>
              </div>
              <div className="flex gap-2">
                <Badge
                  variant={
                    item.priority === 'critical' ? 'destructive' : 'secondary'
                  }
                >
                  {item.priority}
                </Badge>
                <Badge variant="outline">{item.status}</Badge>
              </div>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              提交 {formatDateTime(item.createdAt)} · SLA{' '}
              {item.slaDueAt ? formatDateTime(item.slaDueAt) : '未设置'}
            </p>
          </Link>
        ))}
      </div>
      <Pager
        base="/editor/reports"
        page={result.page}
        pages={result.pages}
        status={status}
      />
    </main>
  );
}

export function Filters({
  base,
  values,
  active,
}: {
  base: string;
  values: string[];
  active?: string;
}) {
  return (
    <nav aria-label="状态筛选" className="flex flex-wrap gap-2">
      <Link
        href={base}
        className={cn(
          buttonVariants({
            variant: !active ? 'default' : 'outline',
            size: 'sm',
          }),
        )}
      >
        全部
      </Link>
      {values.map((value) => (
        <Link
          key={value}
          href={`${base}?status=${value}`}
          className={cn(
            buttonVariants({
              variant: active === value ? 'default' : 'outline',
              size: 'sm',
            }),
          )}
        >
          {value}
        </Link>
      ))}
    </nav>
  );
}

export function Pager({
  base,
  page,
  pages,
  status,
}: {
  base: string;
  page: number;
  pages: number;
  status?: string;
}) {
  const href = (next: number) =>
    `${base}?${new URLSearchParams({ ...(status ? { status } : {}), page: String(next) }).toString()}`;
  return (
    <nav
      aria-label="分页"
      className="mt-8 flex items-center justify-center gap-3"
    >
      <Link
        aria-disabled={page <= 1}
        href={page <= 1 ? '#' : href(page - 1)}
        className={cn(
          buttonVariants({ variant: 'outline' }),
          page <= 1 && 'pointer-events-none opacity-50',
        )}
      >
        <ChevronLeft />
        上一页
      </Link>
      <span className="text-sm text-muted-foreground">
        {page} / {pages}
      </span>
      <Link
        aria-disabled={page >= pages}
        href={page >= pages ? '#' : href(page + 1)}
        className={cn(
          buttonVariants({ variant: 'outline' }),
          page >= pages && 'pointer-events-none opacity-50',
        )}
      >
        下一页
        <ChevronRight />
      </Link>
    </nav>
  );
}
