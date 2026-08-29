import { LockKeyhole } from 'lucide-react';
import Link from 'next/link';

import { chatGPTSignOutPath } from '@/app/chatgpt-auth';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function EditorAccessDenied({ email }: { email: string }) {
  return (
    <main id="main-content" className="mx-auto max-w-xl px-4 py-16 sm:px-6">
      <div className="rounded-xl border border-border bg-card p-7 shadow-sm">
        <LockKeyhole className="size-8 text-primary" />
        <h1 className="mt-5 font-heading text-3xl font-semibold">
          没有编辑权限
        </h1>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">
          你已以 {email}{' '}
          登录，但该账号不在服务端编辑白名单中。登录只确认身份，不自动授予编辑权。
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/"
            className={cn(
              buttonVariants({ variant: 'outline', size: 'lg' }),
              'min-h-11',
            )}
          >
            返回首页
          </Link>
          <a
            href={chatGPTSignOutPath('/')}
            target="_top"
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'lg' }),
              'min-h-11',
            )}
          >
            退出登录
          </a>
        </div>
      </div>
    </main>
  );
}
