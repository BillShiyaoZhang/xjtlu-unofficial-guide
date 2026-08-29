'use client';

import { RefreshCw, Search, TriangleAlert } from 'lucide-react';
import Link from 'next/link';

import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main
      id="main-content"
      className="mx-auto grid min-h-[60dvh] max-w-2xl place-items-center px-4 py-12 text-center sm:px-6"
    >
      <div>
        <span className="mx-auto grid size-16 place-items-center rounded-3xl bg-amber-500/12 text-amber-800">
          <TriangleAlert aria-hidden="true" className="size-8" />
        </span>
        <h1 className="mt-5 font-heading text-3xl font-semibold">
          这次没有加载成功
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">
          可能是网络或数据服务暂时不可用。你可以重试；答案仍以重新联网后显示的版本为准。
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button type="button" size="lg" onClick={reset}>
            <RefreshCw aria-hidden="true" />
            重新加载
          </Button>
          <Link
            href="/search"
            className={cn(
              buttonVariants({ variant: 'outline', size: 'lg' }),
              'min-h-11',
            )}
          >
            <Search aria-hidden="true" />
            返回查找
          </Link>
        </div>
      </div>
    </main>
  );
}
