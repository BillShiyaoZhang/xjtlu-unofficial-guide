import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import manifestFactory from '../app/manifest.ts';
import {
  isMobileNavItemActive,
  parseMobileReturnTo,
  parseMobileTabContext,
  shouldShowMobileNav,
} from '../lib/mobile-navigation.ts';

const projectUrl = new URL('../', import.meta.url);

test('PWA manifest is installable and explicitly unofficial', () => {
  const manifest = manifestFactory();
  assert.equal(manifest.id, '/');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.lang, 'zh-CN');
  assert.match(manifest.name, /非官方/u);
  assert.match(manifest.short_name, /非官方/u);
  assert.equal(manifest.prefer_related_applications, false);

  const icons = manifest.icons ?? [];
  assert.ok(
    icons.some(
      (icon) => icon.src === '/icons/icon-192.png' && icon.sizes === '192x192',
    ),
  );
  assert.ok(
    icons.some(
      (icon) => icon.src === '/icons/icon-512.png' && icon.sizes === '512x512',
    ),
  );
  assert.ok(
    icons.some(
      (icon) =>
        icon.src === '/icons/icon-maskable-512.png' &&
        icon.purpose === 'maskable',
    ),
  );
});

test('PWA raster icons have their declared dimensions', async () => {
  await assertPngSize('public/icons/icon-192.png', 192, 192);
  await assertPngSize('public/icons/icon-512.png', 512, 512);
  await assertPngSize('public/icons/icon-maskable-512.png', 512, 512);
  await assertPngSize('public/icons/apple-touch-icon.png', 180, 180);
  const homeVisual = await readFile(
    new URL('public/home-verification-journey.webp', projectUrl),
  );
  assert.equal(homeVisual.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(homeVisual.subarray(8, 12).toString('ascii'), 'WEBP');
});

test('service worker only keeps a static offline fallback', async () => {
  const source = await readFile(new URL('public/sw.js', projectUrl), 'utf8');
  assert.match(source, /const OFFLINE_URL = '\/offline\.html'/u);
  assert.doesNotMatch(source, /caches\.put/u);
  for (const prefix of [
    '/v1',
    '/editor',
    '/signin-with-chatgpt',
    '/report',
    '/reports',
    '/research-intake',
  ]) {
    assert.ok(source.includes(`'${prefix}'`));
  }
});

test('mobile navigation highlights public routes and stays out of editor auth', () => {
  assert.equal(isMobileNavItemActive('/', 'home'), true);
  assert.equal(isMobileNavItemActive('/search?q=bridge', 'search'), true);
  assert.equal(isMobileNavItemActive('/topics/systems', 'topics'), true);
  assert.equal(isMobileNavItemActive('/report', 'more'), true);
  assert.equal(isMobileNavItemActive('/reports/XG-123', 'more'), true);
  assert.equal(isMobileNavItemActive('/research-intake', 'more'), true);
  assert.equal(isMobileNavItemActive('/about', 'more'), true);
  assert.equal(isMobileNavItemActive('/answers/example', 'search'), true);
  assert.equal(isMobileNavItemActive('/answers/example', 'home', 'home'), true);
  assert.equal(
    isMobileNavItemActive('/answers/example', 'topics', 'topics'),
    true,
  );
  assert.equal(
    isMobileNavItemActive('/answers/example', 'search', 'home'),
    false,
  );
  assert.equal(parseMobileTabContext('topics'), 'topics');
  assert.equal(parseMobileTabContext('unknown'), undefined);
  assert.equal(
    parseMobileReturnTo('/search?q=Learning+Mall&scope=campus'),
    '/search?q=Learning+Mall&scope=campus',
  );
  assert.equal(parseMobileReturnTo('/topics/arrival'), '/topics/arrival');
  assert.equal(parseMobileReturnTo('https://example.com'), undefined);
  assert.equal(parseMobileReturnTo('//example.com/search'), undefined);
  assert.equal(parseMobileReturnTo('/editor'), undefined);
  assert.equal(shouldShowMobileNav('/editor'), false);
  assert.equal(shouldShowMobileNav('/editor/cards/one'), false);
  assert.equal(shouldShowMobileNav('/signin-with-chatgpt'), false);
  assert.equal(shouldShowMobileNav('/answers/example'), true);
});

async function assertPngSize(path, width, height) {
  const image = await readFile(new URL(path, projectUrl));
  assert.equal(image.subarray(1, 4).toString('ascii'), 'PNG');
  assert.equal(image.readUInt32BE(16), width);
  assert.equal(image.readUInt32BE(20), height);
}
