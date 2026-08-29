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
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';

import {
  defaultMobileTabHref,
  isMobileNavItemActive,
  markMobileTabRestore,
  parseMobileTabContext,
  readMobileTabState,
  safeMobileTabHref,
  shouldShowMobileNav,
  takeMobileTabRestore,
  writeMobileTabState,
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
  return (
    <MobileBottomNavBar
      pathname={pathname}
      context={context}
      search={searchParams.toString()}
    />
  );
}

function MobileBottomNavBar({
  pathname,
  context,
  search = '',
}: {
  pathname: string;
  context?: MobileTabContext;
  search?: string;
}) {
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const current = useMemo(
    () => safeMobileTabHref(pathname, params),
    [params, pathname],
  );
  const currentRef = useRef(current);
  const [destinations, setDestinations] = useState<
    Record<MobileNavKey, string>
  >(() => ({
    home: defaultMobileTabHref('home'),
    search: defaultMobileTabHref('search'),
    topics: defaultMobileTabHref('topics'),
    more: defaultMobileTabHref('more'),
  }));

  useEffect(() => {
    currentRef.current = current;
    try {
      const next = {
        home:
          readMobileTabState(window.sessionStorage, 'home')?.href ??
          defaultMobileTabHref('home'),
        search:
          readMobileTabState(window.sessionStorage, 'search')?.href ??
          defaultMobileTabHref('search'),
        topics:
          readMobileTabState(window.sessionStorage, 'topics')?.href ??
          defaultMobileTabHref('topics'),
        more:
          readMobileTabState(window.sessionStorage, 'more')?.href ??
          defaultMobileTabHref('more'),
      };
      if (current) {
        const previous = readMobileTabState(window.sessionStorage, current.key);
        writeMobileTabState(window.sessionStorage, current.key, {
          href: current.href,
          scrollY: previous?.href === current.href ? previous.scrollY : 0,
        });
        next[current.key] = current.href;
      }
      setDestinations(next);

      if (
        current &&
        takeMobileTabRestore(window.sessionStorage, current.key, current.href)
      ) {
        const state = readMobileTabState(window.sessionStorage, current.key);
        const scrollY = state?.href === current.href ? state.scrollY : 0;
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => window.scrollTo(0, scrollY));
        });
      }
    } catch {
      // Navigation remains usable when privacy settings disable sessionStorage.
    }
  }, [current]);

  useEffect(() => {
    if (!current) return;
    let frame = 0;
    const persist = () => {
      try {
        writeMobileTabState(window.sessionStorage, current.key, {
          href: current.href,
          scrollY: window.scrollY,
        });
      } catch {
        // The tab still works with its default destination.
      }
    };
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        persist();
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pagehide', persist);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pagehide', persist);
    };
  }, [current]);

  function rememberTabSwitch(key: MobileNavKey, href: string) {
    try {
      const active = currentRef.current;
      if (active) {
        writeMobileTabState(window.sessionStorage, active.key, {
          href: active.href,
          scrollY: window.scrollY,
        });
      }
      const stored = readMobileTabState(window.sessionStorage, key);
      markMobileTabRestore(window.sessionStorage, key, stored?.href ?? href);
    } catch {
      // Default links continue to provide navigation without storage.
    }
  }

  return (
    <nav
      aria-label="移动端主导航"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border/70 bg-card/94 px-2 pb-[max(0.45rem,env(safe-area-inset-bottom))] pt-1 shadow-[0_-10px_30px_rgb(31_44_37/9%)] backdrop-blur-xl md:hidden"
    >
      <div className="mx-auto grid max-w-md grid-cols-4 gap-1">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = isMobileNavItemActive(pathname, item.key, context);
          const href = destinations[item.key];
          return (
            <Link
              key={item.href}
              href={href}
              onClick={() => rememberTabSwitch(item.key, href)}
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
