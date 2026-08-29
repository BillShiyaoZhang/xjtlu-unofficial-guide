import { BookOpenText, Info, Search } from 'lucide-react';
import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function SiteHeader() {
  return (
    <>
      <a
        href="#main-content"
        className="fixed left-3 top-3 z-50 -translate-y-20 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-transform focus:translate-y-0"
      >
        跳到正文
      </a>
      <div className="border-b border-amber-950/10 bg-[#efe8d9] px-3 pb-1.5 pt-[max(0.375rem,env(safe-area-inset-top))] text-center text-[11px] leading-5 text-[#5f5548] sm:px-4 sm:pb-2 sm:pt-[max(0.5rem,env(safe-area-inset-top))] sm:text-sm">
        <span className="sm:hidden">
          非官方整理 · 与学校无隶属关系 · 以官方通知为准
        </span>
        <span className="hidden sm:inline">
          非官方整理｜本项目与西交利物浦大学无隶属或背书关系。如与学校最新通知不一致，请以官方信息为准。
        </span>
      </div>
      <header className="sticky top-0 z-40 border-b border-border/80 bg-background/92 backdrop-blur-xl">
        <div className="mx-auto flex min-h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:min-h-16 sm:px-6 lg:px-8">
          <Link
            href="/"
            className="group flex min-h-11 items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
            aria-label="西浦非官方指南首页"
          >
            <span className="grid size-9 place-items-center rounded-xl border border-primary/20 bg-primary text-primary-foreground shadow-sm transition-transform group-hover:-rotate-2">
              <BookOpenText aria-hidden="true" className="size-4" />
            </span>
            <span className="leading-none">
              <span className="block font-heading text-[15px] font-semibold tracking-tight">
                西浦非官方指南
              </span>
              <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                sourced · scoped · reviewed
              </span>
            </span>
          </Link>
          <Link
            href="/about"
            aria-label="了解指南的方法与边界"
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'icon-lg' }),
              'min-h-11 md:hidden',
            )}
          >
            <Info aria-hidden="true" />
          </Link>
          <nav
            aria-label="桌面端主导航"
            className="hidden items-center gap-1 md:flex md:gap-2"
          >
            <Link
              href="/search"
              className={cn(
                buttonVariants({ variant: 'ghost', size: 'lg' }),
                'min-h-11',
              )}
            >
              <Search aria-hidden="true" />
              <span className="hidden sm:inline">查找答案</span>
            </Link>
            <Link
              href="/topics"
              className={cn(
                buttonVariants({ variant: 'ghost', size: 'lg' }),
                'min-h-11',
              )}
            >
              主题
            </Link>
            <Link
              href="/about"
              className={cn(
                buttonVariants({ variant: 'outline', size: 'lg' }),
                'min-h-11',
              )}
            >
              关于
            </Link>
          </nav>
        </div>
      </header>
    </>
  );
}
