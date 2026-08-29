import { LoaderCircle } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <main
      id="main-content"
      aria-busy="true"
      aria-label="正在加载页面"
      className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-14 lg:px-8"
    >
      <div className="flex items-center gap-3 text-primary">
        <LoaderCircle aria-hidden="true" className="size-6 animate-spin" />
        <p className="font-heading font-semibold">正在核对最新内容…</p>
      </div>
      <div className="mt-7 space-y-4">
        <Skeleton className="h-10 w-3/4 rounded-xl" />
        <Skeleton className="h-28 w-full rounded-2xl" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-36 rounded-2xl" />
          <Skeleton className="h-36 rounded-2xl" />
        </div>
      </div>
    </main>
  );
}
