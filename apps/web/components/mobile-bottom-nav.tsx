'use client';

import {
  CircleAlert,
  House,
  LayoutGrid,
  Search,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  isMobileNavItemActive,
  shouldShowMobileNav,
  type MobileNavKey,
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
    href: '/report',
    label: '反馈',
    icon: CircleAlert,
    key: 'report',
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
      <nav
        aria-label="移动端主导航"
        className="fixed inset-x-0 bottom-0 z-50 border-t border-border/80 bg-card/94 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5 shadow-[0_-12px_36px_rgb(31_44_37/10%)] backdrop-blur-xl md:hidden"
      >
        <div className="mx-auto grid max-w-md grid-cols-4 gap-1">
          {items.map((item) => {
            const Icon = item.icon;
            const isActive = isMobileNavItemActive(pathname, item.key);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-2 text-[11px] font-semibold outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/40',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground active:bg-muted active:text-foreground',
                )}
              >
                <Icon aria-hidden="true" className="size-5" strokeWidth={2.1} />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
