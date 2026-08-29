import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  FileClock,
  LibraryBig,
  Plus,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EditorAccessDenied } from '@/components/editor-access-denied';
import { EditorNav } from '@/components/editor-nav';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { requireEditorPage } from '@/lib/authz';
import { listEditorContent } from '@/lib/editor-content';
import { hasEditorPermission } from '@/lib/editor-session';
import { formatDate } from '@/lib/presentation';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '内容队列' };

export default async function EditorContentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user, allowed } = await requireEditorPage(
    '/editor/content',
    'content:read',
  );
  if (!allowed) return <EditorAccessDenied email={user.email} />;
  const params = await searchParams;
  const result = await listEditorContent({
    page: typeof params.page === 'string' ? Number(params.page) : 1,
    status: scalar(params.status),
    attention: scalar(params.attention),
    topicId: scalar(params.topic),
  });
  const canCreate = hasEditorPermission(user, 'content:edit');

  return (
    <main
      id="main-content"
      className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8"
    >
      <EditorNav
        displayName={user.displayName}
        permissions={user.permissions}
      />
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
            <LibraryBig />
          </span>
          <div>
            <h1 className="font-heading text-3xl font-semibold">内容队列</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              共 {result.total} 张答案卡
            </p>
          </div>
        </div>
        {canCreate ? (
          <Link
            href="/editor/cards/new"
            className={cn(buttonVariants({ size: 'lg' }), 'min-h-11')}
          >
            <Plus />
            新建答案卡
          </Link>
        ) : null}
      </header>

      <form
        action="/editor/content"
        className="mt-7 grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-3"
      >
        <FilterSelect
          label="发布状态"
          name="status"
          defaultValue={result.filters.status ?? ''}
          options={[
            ['', '全部状态'],
            ['draft', '草稿'],
            ['published', '已发布'],
            ['hidden', '已隐藏'],
          ]}
        />
        <FilterSelect
          label="需要关注"
          name="attention"
          defaultValue={result.filters.attention ?? ''}
          options={[
            ['', '全部内容'],
            ['drafts', '有未发布修订'],
            ['overdue', '已逾期复核'],
            ['source_issue', '来源不可用'],
          ]}
        />
        <FilterSelect
          label="话题"
          name="topic"
          defaultValue={result.filters.topicId ?? ''}
          options={[
            ['', '全部话题'],
            ...result.topics.map((topic) => [topic.id, topic.title] as const),
          ]}
        />
        <button
          type="submit"
          className={cn(
            buttonVariants({ variant: 'outline' }),
            'min-h-11 sm:col-span-3 sm:justify-self-start',
          )}
        >
          应用筛选
        </button>
      </form>

      <section aria-label="内容列表" className="mt-5 grid gap-4 lg:grid-cols-2">
        {result.items.map((item) => (
          <Link
            key={item.id}
            href={`/editor/cards/${item.id}`}
            className="rounded-xl border border-border bg-card p-5 transition hover:border-primary/40"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-primary">
                  {item.topicTitle}
                </p>
                <h2 className="mt-2 font-heading text-xl font-semibold">
                  {item.currentTitle ?? item.latestTitle ?? item.slug}
                </h2>
              </div>
              <Badge variant="outline">{item.publicationStatus}</Badge>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              {item.hasDraft ? (
                <Badge>
                  <FileClock /> v{item.latestVersion} 待审核
                </Badge>
              ) : null}
              {item.isOverdue ? (
                <Badge variant="destructive">
                  <AlertTriangle /> 已逾期
                </Badge>
              ) : null}
              {item.hasSourceIssue ? (
                <Badge variant="destructive">
                  <AlertTriangle /> 来源不可用
                </Badge>
              ) : null}
              <Badge variant="secondary">{item.riskLevel}</Badge>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              {item.reviewDueAt
                ? `复核期限 ${formatDate(item.reviewDueAt)}`
                : '尚未发布'}
              {' · '}对象版本 {item.lockVersion}
            </p>
          </Link>
        ))}
        {!result.items.length ? (
          <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground lg:col-span-2">
            当前筛选下没有内容。
          </p>
        ) : null}
      </section>

      <ContentPager result={result} />
    </main>
  );
}

function FilterSelect({
  label,
  name,
  defaultValue,
  options,
}: {
  label: string;
  name: string;
  defaultValue: string;
  options: ReadonlyArray<readonly [string, string]>;
}) {
  return (
    <label className="text-sm font-semibold">
      {label}
      <select
        name={name}
        defaultValue={defaultValue}
        className="mt-2 min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
      >
        {options.map(([value, text]) => (
          <option key={value || 'all'} value={value}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

function ContentPager({
  result,
}: {
  result: Awaited<ReturnType<typeof listEditorContent>>;
}) {
  const href = (page: number) => {
    const params = new URLSearchParams({ page: String(page) });
    if (result.filters.status) params.set('status', result.filters.status);
    if (result.filters.attention)
      params.set('attention', result.filters.attention);
    if (result.filters.topicId) params.set('topic', result.filters.topicId);
    return `/editor/content?${params.toString()}`;
  };
  return (
    <nav
      aria-label="内容分页"
      className="mt-8 flex items-center justify-center gap-3"
    >
      <Link
        aria-disabled={result.page <= 1}
        href={result.page <= 1 ? '#' : href(result.page - 1)}
        className={cn(
          buttonVariants({ variant: 'outline' }),
          result.page <= 1 && 'pointer-events-none opacity-50',
        )}
      >
        <ChevronLeft /> 上一页
      </Link>
      <span className="text-sm text-muted-foreground">
        {result.page} / {result.pages}
      </span>
      <Link
        aria-disabled={result.page >= result.pages}
        href={result.page >= result.pages ? '#' : href(result.page + 1)}
        className={cn(
          buttonVariants({ variant: 'outline' }),
          result.page >= result.pages && 'pointer-events-none opacity-50',
        )}
      >
        下一页 <ChevronRight />
      </Link>
    </nav>
  );
}

function scalar(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : undefined;
}
