export type MobileNavKey = 'home' | 'search' | 'topics' | 'report';

const EXCLUDED_PREFIXES = ['/editor', '/signin-with-chatgpt'];

export function shouldShowMobileNav(pathname: string) {
  return !EXCLUDED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function isMobileNavItemActive(pathname: string, item: MobileNavKey) {
  switch (item) {
    case 'home':
      return pathname === '/';
    case 'search':
      return pathname.startsWith('/search');
    case 'topics':
      return pathname.startsWith('/topics');
    case 'report':
      return (
        pathname.startsWith('/report') && !pathname.startsWith('/reports/')
      );
  }
}
