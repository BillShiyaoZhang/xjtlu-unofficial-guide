'use client';

import {
  Ellipsis,
  House,
  LayoutGrid,
  Search,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

import {
  isMobileNavItemActive,
  parseMobileTabContext,
  shouldShowMobileNav,
  type MobileNavKey,
  type MobileTabContext,
} from '@/lib/mobile-navigation';
import { cn } from '@/lib/utils';

const items: Array<{
  href: string;
  label: string;
  icon: LucideIcon;
  key: MobileNavKey;
}> = [
  {
    href: '/',
    label: '首页',
    icon: House,
    key: 'home',
  },
  {
    href: '/search',
    label: '查找',
    icon: Search,
    key: 'search',
  },
  {
    href: '/topics',
    label: '主题',
    icon: LayoutGrid,
    key: 'topics',
  },
  {
    href: '/more',
    label: '更多',
    icon: Ellipsis,
    key: 'more',
  },
];

export function MobileBottomNav() {
  const pathname = usePathname();
  if (!shouldShowMobileNav(pathname)) return null;

  return (
    <>
      <div
        aria-hidden="true"
        className="h-[calc(4.75rem+env(safe-area-inset-bottom))] md:hidden"
      />
      <Suspense fallback={<MobileBottomNavBar pathname={pathname} />}>
        <MobileBottomNavWithContext pathname={pathname} />
      </Suspense>
    </>
  );
}

function MobileBottomNavWithContext({ pathname }: { pathname: string }) {
  const searchParams = useSearchParams();
  const context = parseMobileTabContext(searchParams.get('tab'));
  return <MobileBottomNavBar pathname={pathname} context={context} />;
}

function MobileBottomNavBar({
  pathname,
  context,
}: {
  pathname: string;
  context?: MobileTabContext;
}) {
  return (
    <nav
      aria-label="移动端主导航"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border/70 bg-card/94 px-2 pb-[max(0.45rem,env(safe-area-inset-bottom))] pt-1 shadow-[0_-10px_30px_rgb(31_44_37/9%)] backdrop-blur-xl md:hidden"
    >
      <div className="mx-auto grid max-w-md grid-cols-4 gap-1">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = isMobileNavItemActive(pathname, item.key, context);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'group flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl px-2 text-[11px] font-semibold outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/40',
                isActive
                  ? 'text-primary'
                  : 'text-muted-foreground active:bg-muted active:text-foreground',
              )}
            >
              <span
                className={cn(
                  'grid h-7 w-12 place-items-center rounded-full transition-colors',
                  isActive && 'bg-primary text-primary-foreground shadow-sm',
                )}
              >
                <Icon
                  aria-hidden="true"
                  className="size-[1.15rem]"
                  strokeWidth={isActive ? 2.5 : 2.1}
                />
              </span>
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
