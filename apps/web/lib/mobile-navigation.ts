export type MobileNavKey = 'home' | 'search' | 'topics' | 'more';
export type MobileTabContext = 'home' | 'search' | 'topics';

const EXCLUDED_PREFIXES = ['/editor', '/signin-with-chatgpt'];

export function shouldShowMobileNav(pathname: string) {
  return !EXCLUDED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function parseMobileTabContext(value: string | null | undefined) {
  return value === 'home' || value === 'search' || value === 'topics'
    ? value
    : undefined;
}

export function parseMobileReturnTo(value: string | null | undefined) {
  if (
    !value ||
    value.length > 512 ||
    !value.startsWith('/') ||
    value.startsWith('//')
  ) {
    return undefined;
  }

  try {
    const url = new URL(value, 'https://guide.local');
    const isAllowed =
      url.pathname === '/' ||
      url.pathname === '/search' ||
      url.pathname === '/topics' ||
      url.pathname.startsWith('/topics/');
    return isAllowed ? `${url.pathname}${url.search}` : undefined;
  } catch {
    return undefined;
  }
}

export function isMobileNavItemActive(
  pathname: string,
  item: MobileNavKey,
  context?: MobileTabContext,
) {
  const answerContext = pathname.startsWith('/answers/')
    ? (context ?? 'search')
    : undefined;

  switch (item) {
    case 'home':
      return pathname === '/' || answerContext === 'home';
    case 'search':
      return pathname.startsWith('/search') || answerContext === 'search';
    case 'topics':
      return pathname.startsWith('/topics') || answerContext === 'topics';
    case 'more':
      return [
        '/more',
        '/about',
        '/report',
        '/reports',
        '/research-intake',
      ].some(
        (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
      );
  }
}
