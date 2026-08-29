import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearMobileTabSessionState,
  readMobileTabState,
  safeMobileTabHref,
  writeMobileTabState,
} from '../lib/mobile-navigation.ts';

test('mobile tab persistence drops raw search text and unknown parameters', () => {
  const sealed = `sv1_${'a'.repeat(16)}.${'b'.repeat(20)}`;
  const params = new URLSearchParams();
  params.set('q', 'sensitive raw question');
  params.set('v', sealed);
  params.set('topic', 'student-services');
  params.append('scope', 'campus-sip');
  params.set('redirect', 'https://example.com');

  assert.deepEqual(safeMobileTabHref('/search', params), {
    key: 'search',
    href: `/search?v=${encodeURIComponent(sealed)}&topic=student-services&scope=campus-sip`,
  });
});

test('stored mobile tab state is revalidated before use', () => {
  const storage = memoryStorage();
  writeMobileTabState(storage, 'topics', {
    href: '/topics/campus-life',
    scrollY: 432.4,
  });
  assert.deepEqual(readMobileTabState(storage, 'topics'), {
    href: '/topics/campus-life',
    scrollY: 432,
  });

  storage.setItem(
    'xg-mobile-tab-v1:search',
    JSON.stringify({ href: '/search?q=raw-question', scrollY: 90 }),
  );
  assert.equal(readMobileTabState(storage, 'search'), null);
});

test('clearing participant state removes every mobile tab record', () => {
  const storage = memoryStorage();
  for (const key of ['home', 'search', 'topics', 'more']) {
    storage.setItem(`xg-mobile-tab-v1:${key}`, '{}');
  }
  storage.setItem('xg-mobile-tab-pending-v1', '{}');

  clearMobileTabSessionState(storage);

  assert.equal(storage.size, 0);
});

function memoryStorage() {
  const values = new Map();
  return {
    get size() {
      return values.size;
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}
