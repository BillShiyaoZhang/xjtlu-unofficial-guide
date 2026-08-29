export type MobileNavKey = 'home' | 'search' | 'topics' | 'more';
export type MobileTabContext = 'home' | 'search' | 'topics' | 'more';

export type MobileTabState = {
  href: string;
  scrollY: number;
};

const EXCLUDED_PREFIXES = ['/editor', '/signin-with-chatgpt'];
const MOBILE_TAB_STORAGE_PREFIX = 'xg-mobile-tab-v1:';
const MOBILE_TAB_PENDING_KEY = 'xg-mobile-tab-pending-v1';
const DEFAULT_TAB_HREFS: Record<MobileNavKey, string> = {
  home: '/',
  search: '/search',
  topics: '/topics',
  more: '/more',
};

const MOBILE_NAV_KEYS: MobileNavKey[] = ['home', 'search', 'topics', 'more'];

export function shouldShowMobileNav(pathname: string) {
  return !EXCLUDED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function parseMobileTabContext(value: string | null | undefined) {
  return value === 'home' ||
    value === 'search' ||
    value === 'topics' ||
    value === 'more'
    ? value
    : undefined;
}

export function parseMobileReturnTo(value: string | null | undefined) {
  if (
    !value ||
    value.length > 1_500 ||
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

export function parsePilotReturnTo(value: string | null | undefined) {
  if (
    !value ||
    value.length > 1_500 ||
    !value.startsWith('/') ||
    value.startsWith('//')
  ) {
    return undefined;
  }
  try {
    const url = new URL(value, 'https://guide.local');
    return ['/research-intake', '/report', '/pilot/activity'].includes(
      url.pathname,
    )
      ? `${url.pathname}${url.search}`
      : undefined;
  } catch {
    return undefined;
  }
}

export function isMobileNavItemActive(
  pathname: string,
  item: MobileNavKey,
  context?: MobileTabContext,
) {
  return mobileNavKeyForLocation(pathname, context) === item;
}

export function mobileNavKeyForLocation(
  pathname: string,
  context?: MobileTabContext,
): MobileNavKey | undefined {
  const answerContext = pathname.startsWith('/answers/')
    ? (context ?? 'search')
    : undefined;

  if (pathname === '/' || answerContext === 'home') return 'home';
  if (pathname.startsWith('/search') || answerContext === 'search') {
    return 'search';
  }
  if (pathname.startsWith('/topics') || answerContext === 'topics') {
    return 'topics';
  }
  if (answerContext === 'more') return 'more';
  if (
    [
      '/more',
      '/about',
      '/report',
      '/reports',
      '/research-intake',
      '/pilot',
    ].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  ) {
    return 'more';
  }
  return undefined;
}

/**
 * Builds the only URL shape that may be persisted for mobile tabs. Search
 * text is deliberately absent: `q` and every unknown parameter are dropped.
 */
export function safeMobileTabHref(
  pathname: string,
  searchParams: Pick<URLSearchParams, 'get' | 'getAll'>,
): { key: MobileNavKey; href: string } | null {
  const context = parseMobileTabContext(searchParams.get('tab'));
  const key = mobileNavKeyForLocation(pathname, context);
  if (!key || !isSafeTabPath(pathname, key)) return null;

  const safeParams = new URLSearchParams();
  if (pathname === '/search') {
    appendSealedView(searchParams, safeParams);
    appendSlug(searchParams, safeParams, 'topic');
    appendOpaqueValues(searchParams, safeParams, 'scope', 8);
    appendSimpleView(searchParams, safeParams);
  } else if (pathname.startsWith('/answers/')) {
    if (context) safeParams.set('tab', context);
  } else if (pathname === '/research-intake') {
    appendSealedView(searchParams, safeParams);
    const kind = searchParams.get('kind');
    if (kind === 'question' || kind === 'material') {
      safeParams.set('kind', kind);
    }
  } else if (pathname === '/report') {
    const card = searchParams.get('card');
    if (card && /^[A-Za-z0-9_-]{1,100}$/u.test(card)) {
      safeParams.set('card', card);
    }
    const type = searchParams.get('type');
    if (
      type === 'stale' ||
      type === 'scope_error' ||
      type === 'source_mismatch' ||
      type === 'privacy'
    ) {
      safeParams.set('type', type);
    }
  } else if (pathname === '/pilot/activity') {
    appendSimpleView(searchParams, safeParams);
  }

  const query = safeParams.toString();
  return { key, href: `${pathname}${query ? `?${query}` : ''}` };
}

export function defaultMobileTabHref(key: MobileNavKey) {
  return DEFAULT_TAB_HREFS[key];
}

export function readMobileTabState(
  storage: Pick<Storage, 'getItem'>,
  key: MobileNavKey,
): MobileTabState | null {
  try {
    const raw = storage.getItem(storageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.href !== 'string' || parsed.href.length > 1_500) {
      return null;
    }
    const url = new URL(parsed.href, 'https://guide.local');
    if (url.origin !== 'https://guide.local') return null;
    const safe = safeMobileTabHref(url.pathname, url.searchParams);
    if (!safe || safe.key !== key || safe.href !== parsed.href) return null;
    const scrollY = Number(parsed.scrollY);
    return {
      href: safe.href,
      scrollY:
        Number.isFinite(scrollY) && scrollY >= 0
          ? Math.min(Math.round(scrollY), 10_000_000)
          : 0,
    };
  } catch {
    return null;
  }
}

export function writeMobileTabState(
  storage: Pick<Storage, 'setItem'>,
  key: MobileNavKey,
  state: MobileTabState,
) {
  const url = new URL(state.href, 'https://guide.local');
  const safe = safeMobileTabHref(url.pathname, url.searchParams);
  if (!safe || safe.key !== key) return;
  storage.setItem(
    storageKey(key),
    JSON.stringify({
      href: safe.href,
      scrollY: Math.max(0, Math.min(Math.round(state.scrollY), 10_000_000)),
    }),
  );
}

export function markMobileTabRestore(
  storage: Pick<Storage, 'setItem'>,
  key: MobileNavKey,
  href: string,
) {
  storage.setItem(MOBILE_TAB_PENDING_KEY, JSON.stringify({ key, href }));
}

export function takeMobileTabRestore(
  storage: Pick<Storage, 'getItem' | 'removeItem'>,
  key: MobileNavKey,
  href: string,
) {
  try {
    const raw = storage.getItem(MOBILE_TAB_PENDING_KEY);
    storage.removeItem(MOBILE_TAB_PENDING_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed.key === key && parsed.href === href;
  } catch {
    return false;
  }
}

export function clearMobileTabSessionState(
  storage: Pick<Storage, 'removeItem'>,
) {
  for (const key of MOBILE_NAV_KEYS) storage.removeItem(storageKey(key));
  storage.removeItem(MOBILE_TAB_PENDING_KEY);
}

function storageKey(key: MobileNavKey) {
  return `${MOBILE_TAB_STORAGE_PREFIX}${key}`;
}

function isSafeTabPath(pathname: string, key: MobileNavKey) {
  if (key === 'home') {
    return pathname === '/' || isAnswerPath(pathname);
  }
  if (key === 'search') {
    return pathname === '/search' || isAnswerPath(pathname);
  }
  if (key === 'topics') {
    return (
      pathname === '/topics' ||
      /^\/topics\/[a-z0-9][a-z0-9-]{0,99}$/u.test(pathname) ||
      isAnswerPath(pathname)
    );
  }
  return (
    pathname === '/more' ||
    pathname === '/about' ||
    pathname === '/report' ||
    /^\/reports\/XG-[A-F0-9]{32}$/iu.test(pathname) ||
    pathname === '/research-intake' ||
    pathname === '/pilot' ||
    pathname === '/pilot/activity'
  );
}

function isAnswerPath(pathname: string) {
  return /^\/answers\/[a-z0-9][a-z0-9-]{0,119}$/u.test(pathname);
}

function appendSealedView(
  input: Pick<URLSearchParams, 'get'>,
  output: URLSearchParams,
) {
  const value = input.get('v');
  if (value && /^sv1_[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{20,1200}$/u.test(value)) {
    output.set('v', value);
  }
}

function appendSlug(
  input: Pick<URLSearchParams, 'get'>,
  output: URLSearchParams,
  name: string,
) {
  const value = input.get(name);
  if (value && /^[a-z0-9][a-z0-9-]{0,99}$/u.test(value)) {
    output.set(name, value);
  }
}

function appendOpaqueValues(
  input: Pick<URLSearchParams, 'getAll'>,
  output: URLSearchParams,
  name: string,
  limit: number,
) {
  for (const value of input.getAll(name).slice(0, limit)) {
    if (/^[A-Za-z0-9_-]{1,100}$/u.test(value)) output.append(name, value);
  }
}

function appendSimpleView(
  input: Pick<URLSearchParams, 'get'>,
  output: URLSearchParams,
) {
  const value = input.get('view');
  if (value === 'all' || value === 'reports' || value === 'intakes') {
    output.set('view', value);
  }
}
