import { ArrowLeft, SearchX } from 'lucide-react';
import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default function NotFound() {
  return (
    <main
      id="main-content"
      className="mx-auto grid min-h-[60dvh] max-w-2xl place-items-center px-4 py-12 text-center sm:px-6"
    >
      <div>
        <span className="mx-auto grid size-16 place-items-center rounded-3xl bg-muted text-muted-foreground">
          <SearchX aria-hidden="true" className="size-8" />
        </span>
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
          404
        </p>
        <h1 className="mt-2 font-heading text-3xl font-semibold">
          没找到这个页面
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">
          链接可能已失效，答案也可能因复核或隐私处理暂时下线。
        </p>
        <Link
          href="/search"
          className={cn(buttonVariants({ size: 'lg' }), 'mt-6 min-h-11')}
        >
          <ArrowLeft aria-hidden="true" />
          返回查找答案
        </Link>
      </div>
    </main>
  );
}
