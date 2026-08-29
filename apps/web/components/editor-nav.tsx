import {
  FolderTree,
  LibraryBig,
  LayoutDashboard,
  ListChecks,
  Plus,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react';
import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { EditorSignOutButton } from './editor-sign-out-button';

import type { EditorPermission } from '@/lib/editor-access-model';

export function EditorNav({
  displayName,
  permissions,
}: {
  displayName: string;
  permissions: EditorPermission[];
}) {
  return (
    <div className="mb-8 flex flex-col justify-between gap-4 rounded-xl border border-border bg-card/80 p-3 sm:flex-row sm:items-center">
      <nav aria-label="编辑导航" className="flex flex-wrap gap-1">
        <Link
          href="/editor"
          className={cn(
            buttonVariants({ variant: 'ghost', size: 'lg' }),
            'min-h-11',
          )}
        >
          <LayoutDashboard />
          工作台
        </Link>
        {permissions.includes('content:read') ? (
          <Link
            href="/editor/content"
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'lg' }),
              'min-h-11',
            )}
          >
            <LibraryBig />
            内容队列
          </Link>
        ) : null}
        {permissions.includes('content:edit') ? (
          <>
            <Link
              href="/editor/cards/new"
              className={cn(
                buttonVariants({ variant: 'ghost', size: 'lg' }),
                'min-h-11',
              )}
            >
              <Plus />
              新建答案卡
            </Link>
            <Link
              href="/editor/catalog"
              className={cn(
                buttonVariants({ variant: 'ghost', size: 'lg' }),
                'min-h-11',
              )}
            >
              <FolderTree />
              分类与来源
            </Link>
          </>
        ) : null}
        {permissions.includes('accounts:manage') ? (
          <Link
            href="/editor/accounts"
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'lg' }),
              'min-h-11',
            )}
          >
            <Users />
            账号与权限
          </Link>
        ) : null}
        {permissions.includes('safety:manage') ? (
          <>
            <Link
              href="/editor/reports"
              className={cn(
                buttonVariants({ variant: 'ghost', size: 'lg' }),
                'min-h-11',
              )}
            >
              <ListChecks />
              报告
            </Link>
            <Link
              href="/editor/intakes"
              className={cn(
                buttonVariants({ variant: 'ghost', size: 'lg' }),
                'min-h-11',
              )}
            >
              <ListChecks />
              线索
            </Link>
          </>
        ) : null}
        {permissions.includes('operations:manage') ? (
          <Link
            href="/editor/operations"
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'lg' }),
              'min-h-11',
            )}
          >
            <Settings />
            运行状态
          </Link>
        ) : null}
        <Link
          href="/editor/security"
          className={cn(
            buttonVariants({ variant: 'ghost', size: 'lg' }),
            'min-h-11',
          )}
        >
          <ShieldCheck />
          安全
        </Link>
      </nav>
      <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
        <span className="max-w-40 truncate">{displayName}</span>
        <EditorSignOutButton />
      </div>
    </div>
  );
}
