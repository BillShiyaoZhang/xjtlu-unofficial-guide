import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildRuntime, loadRuntimeConfig, bootstrapAccount, importContent } from '@information-community/runtime';
import { harness, communityRoot, mfaKey } from '../helpers.mjs';

const require = createRequire(process.env.PLAYWRIGHT_PACKAGE ?? import.meta.url);
const { chromium } = require('playwright');

test('local reviewers log in using only account and password while missing configuration retains MFA', async t => {
  const loaded = await loadRuntimeConfig({ root: communityRoot });
  const { assets } = await buildRuntime({ ...loaded, output: '.browser-qa/local-password-build' });
  assets['/runtime-editor'] = assets['/'];
  assets['/editor'] = assets['/extensions/editor.html'];
  assets['/'] = assets['/extensions/index.html'];
  const h = await harness(t, { guide: true, assets, localPasswordOnly: true });
  h.store.transact(state => { state.modules.content = importContent(state.modules.content, h.bundle); });
  const originalContent = structuredClone(h.store.read().modules.content);
  const account = {
    id: 'synthetic-password-reviewer', displayName: 'Synthetic Password Reviewer', roles: ['content_reviewer'],
    password: 'synthetic-local-review-password', totpSecret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
  };
  bootstrapAccount(h.store, account, { mfaKey, now: h.time() });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  t.after(() => browser.close());

  for (const viewport of [{ width: 1440, height: 1040 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(h.base + '/editor');
    await page.locator('#login-form[data-password-only=true]').waitFor();
    assert.equal(await page.locator('#login-code-field').isVisible(), false);
    assert.equal(await page.locator('[name=code]').isDisabled(), true);
    assert.equal(await page.locator('[name=code]').evaluate(input => input.required), false);
    await page.locator('[name=accountId]').fill(account.id);
    await page.locator('[name=password]').fill(account.password);
    const login = page.waitForResponse(response => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST');
    await page.locator('#login-submit').click();
    const response = await login;
    assert.equal(response.status(), 200, await response.text());
    assert.deepEqual(response.request().postDataJSON(), { accountId: account.id, password: account.password });
    await page.locator('#article-list .article-card').first().waitFor();
    assert.equal(await page.locator('#operator').innerText(), account.displayName);
    assert.equal(await page.locator('#article-list .article-card').count(), 8);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(h.store.read().modules.content, originalContent, 'logging in must not approve or publish any content');
    assert.deepEqual(h.store.read().modules['guide-reviews'].records, []);
    await page.locator('#logout').click();
    await page.locator('#login-section').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[name=password]').inputValue(), '');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('guide-editor-session')), null);
    assert.deepEqual(errors, []);
    await context.close();
  }

  const fallback = await browser.newContext();
  const page = await fallback.newPage();
  await page.route('**/api/guide/login-config', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await page.goto(h.base + '/editor');
  await page.locator('#login-form[data-password-only=false]').waitFor();
  assert.equal(await page.locator('#login-code-field').isVisible(), true);
  assert.equal(await page.locator('[name=code]').isDisabled(), false);
  assert.equal(await page.locator('[name=code]').evaluate(input => input.required), true);
  assert.equal(await page.locator('#login-submit').isDisabled(), false);
  await fallback.close();
});
