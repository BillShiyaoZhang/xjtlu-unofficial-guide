import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { buildRuntime, loadRuntimeConfig, bootstrapAccount, totpCode } from '@information-community/runtime';
import { harness, communityRoot, mfaKey, readJson } from '../helpers.mjs';

const require = createRequire(process.env.PLAYWRIGHT_PACKAGE ?? import.meta.url);
const { chromium } = require('playwright');

test('editor and reader work across desktop and mobile without leaking stale private details', async t => {
  const loaded = await loadRuntimeConfig({ root: communityRoot });
  const { assets } = await buildRuntime(loaded);
  assets['/runtime-editor'] = assets['/'];
  assets['/editor'] = assets['/extensions/editor.html'];
  assets['/'] = assets['/extensions/index.html'];
  const h = await harness(t, { guide: true, assets, mutateBundle(bundle) {
    bundle.revisions.find(row => row.entityId === 'card-ebridge-entry').data.disputeStatus = 'reported';
  } });
  h.publish();
  const account = { id: 'browser-reviewer', displayName: 'Synthetic Reviewer', roles: ['safety_reviewer', 'content_reviewer'], password: 'synthetic-browser-password', totpSecret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' };
  bootstrapAccount(h.store, account, { mfaKey, now: h.time() });
  for (let index = 0; index < 10; index++) await readJson(await h.post('/api/reports', { type: 'privacy', affectedArea: 'search' }, undefined, null), 201);
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  t.after(() => browser.close());
  const screenshots = resolve(process.env.GUIDE_SCREENSHOTS ?? 'community/.browser-qa');
  await mkdir(screenshots, { recursive: true });
  for (const [name, viewport] of [['desktop', { width: 1440, height: 1040 }], ['mobile', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(h.base);
    await page.locator('#list-view').click();
    await page.locator('#answer-list .answer-item').first().waitFor();
    assert.ok(await page.getByText('该答案收到争议报告', { exact: false }).count());
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: join(screenshots, `${name}-reader.png`), fullPage: true });
    await page.goto(h.base + '/editor');
    await page.locator('[name=accountId]').fill(account.id);
    await page.locator('[name=password]').fill(account.password);
    if (name === 'mobile') h.setTime(h.time() + 30000);
    await page.locator('[name=code]').fill(totpCode(account.totpSecret, h.time()));
    await page.locator('#login-form button').click();
    await page.locator('#record-list button').first().waitFor();
    assert.equal(await page.locator('#record-list button').count(), 8);
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    assert.equal(await page.locator('#record-list button').count(), 2);
    await page.locator('#record-list button').first().click();
    await page.locator('#record-detail').waitFor({ state: 'visible' });
    assert.match(await page.locator('#payload').innerText(), /privacy|search/u);
    const note = 'Synthetic internal review note ' + name;
    await page.locator('#transition-form [name=note]').fill(note);
    await page.locator('#transition-form button[type=submit]').click();
    await page.locator('#internal-notes').getByText(note, { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const broken = await page.locator('img').evaluateAll(images => images.filter(image => !image.complete || image.naturalWidth === 0).length);
    assert.equal(broken, 0);
    await page.screenshot({ path: join(screenshots, `${name}-editor.png`), fullPage: true });
    await page.getByRole('button', { name: '刷新工作台', exact: true }).click();
    await page.locator('#record-list button').first().waitFor();
    assert.equal(await page.locator('#payload').innerText(), '');
    assert.equal(await page.locator('#internal-notes').innerText(), '');
    await page.getByRole('tab', { name: '内容审核', exact: true }).click();
    const entityId = 'card-ebridge-entry';
    const entity = h.store.read().modules.content.entities.find(row => row.id === entityId);
    await page.locator('#content-form [name=action]').selectOption('hide');
    await page.locator('#content-form [name=entityId]').fill(entityId);
    await page.locator('#content-form [name=expectedVersion]').fill(String(entity.version));
    await page.locator('#content-form [name=hidden]').selectOption(name === 'desktop' ? 'true' : 'false');
    await page.locator('#content-form [name=reason]').fill('已核对证据及影响范围，调整公开状态。');
    const reviewed = page.waitForResponse(response => response.url().endsWith('/api/content/hide') && response.request().method() === 'POST', { timeout: 5000 });
    await page.locator('#content-form button[type=submit]').click();
    const reviewedResponse = await reviewed;
    assert.equal(reviewedResponse.status(), 200, await reviewedResponse.text());
    await page.locator('#review-history-result').getByText('已核对证据及影响范围', { exact: false }).first().waitFor();
    await page.screenshot({ path: join(screenshots, `${name}-content.png`), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.getByRole('button', { name: '退出', exact: true }).click();
    await page.locator('#login-section').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#payload').innerText(), '');
    assert.equal(await page.locator('#review-history-result').innerText(), '');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('guide-editor-session')), null);
    assert.deepEqual(errors, []);
    await context.close();
    if (name === 'desktop') {
      // Keep the second reader check public while retaining the first reviewed hide in history.
      const operator = await h.operator(['content_reviewer'], 'browser-reset-reviewer');
      const current = h.store.read().modules.content.entities.find(row => row.id === entityId);
      await readJson(await h.post('/api/content/hide', { entityId, expectedVersion: current.version, hidden: false, reason: '合成测试恢复公开，继续验证移动端展示。' }, operator.token));
    }
  }
});
