import { LayoutDashboard, LogOut, Plus } from 'lucide-react';
import Link from 'next/link';

import { chatGPTSignOutPath } from '@/app/chatgpt-auth';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function EditorNav({ displayName }: { displayName: string }) {
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
      </nav>
      <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
        <span className="max-w-40 truncate">{displayName}</span>
        <a
          href={chatGPTSignOutPath('/')}
          target="_top"
          className={cn(
            buttonVariants({ variant: 'ghost', size: 'sm' }),
            'min-h-9',
          )}
        >
          <LogOut />
          退出
        </a>
      </div>
    </div>
  );
}
