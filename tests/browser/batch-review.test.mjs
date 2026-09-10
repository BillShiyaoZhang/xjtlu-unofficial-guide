import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { buildRuntime, loadRuntimeConfig, bootstrapAccount, totpCode, decryptPrivatePayload } from '@information-community/runtime';
import { harness, communityRoot, mfaKey, keyring, readJson } from '../helpers.mjs';

const require = createRequire(process.env.PLAYWRIGHT_PACKAGE ?? import.meta.url);
const { chromium } = require('playwright');
const cards = '#article-list .article-card';
const card = (page, entityId) => page.locator(`${cards}[data-entity-id="${entityId}"]`);

async function prepare(t) {
  const loaded = await loadRuntimeConfig({ root: communityRoot });
  // Keep this suite's generated assets separate from other browser/build checks.
  const { assets } = await buildRuntime({ ...loaded, output: '.browser-qa/batch-review-build' });
  assets['/runtime-editor'] = assets['/'];
  assets['/editor'] = assets['/extensions/editor.html'];
  assets['/'] = assets['/extensions/index.html'];
  const h = await harness(t, { guide: true, assets });
  h.publish();
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  t.after(() => browser.close());
  return { h, browser };
}

async function login(page, h, account) {
  await page.goto(h.base + '/editor');
  await page.locator('[name=accountId]').fill(account.id);
  await page.locator('[name=password]').fill(account.password);
  await page.locator('[name=code]').fill(totpCode(account.totpSecret, h.time()));
  await page.locator('#login-form button').click();
  await page.locator(cards).first().waitFor();
}

async function selectionIs(page, count) {
  await page.waitForFunction(({ selector, count }) => {
    const text = document.querySelector(selector).textContent;
    return new RegExp(`已(?:勾)?选(?:择)?\\s*${count}\\s*篇`).test(text);
  }, { selector: '#article-selection-count', count });
}

async function expandedContent(page, h, entityId) {
  const item = card(page, entityId);
  const details = item.locator('details.article-content');
  if (!await details.evaluate(node => node.open)) await details.locator('summary').click();
  const revision = h.bundle.revisions.filter(row => row.entityId === entityId).sort((a, b) => b.number - a.number)[0];
  const body = await details.innerText();
  for (const sentence of revision.data.sentences) assert.ok(body.includes(sentence.text), `Missing full sentence: ${sentence.id}`);
  const citations = h.bundle.citations.filter(row => row.revisionId === revision.id);
  assert.ok(citations.length > 0);
  for (const citation of citations) {
    const source = h.bundle.revisions.find(row => row.id === citation.sourceRevisionId);
    assert.ok(await details.locator('a').evaluateAll((links, url) => links.some(link => link.href === url && link.target === '_blank'), source.data.url), `Missing source link for ${citation.id}`);
  }
}

async function visibilityRoundTrip(page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const reload = page.waitForResponse(response => response.url().includes('/api/guide/review-articles') && response.request().method() === 'GET');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.equal((await reload).status(), 200);
  await page.locator(cards).first().waitFor();
}

test('reviewers submit mixed decisions and publish approved articles across pages on desktop and mobile', async t => {
  const { h, browser } = await prepare(t);
  const account = { id: 'batch-browser-reviewer', displayName: 'Synthetic Batch Reviewer', roles: ['content_reviewer'], password: 'synthetic-batch-password', totpSecret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' };
  bootstrapAccount(h.store, account, { mfaKey, now: h.time() });
  const originalContent = structuredClone(h.store.read().modules.content);
  const screenshots = resolve(process.env.GUIDE_SCREENSHOTS ?? 'community/.browser-qa');
  await mkdir(screenshots, { recursive: true });

  for (const [name, viewport] of [['desktop', { width: 1440, height: 1040 }], ['mobile', { width: 390, height: 844 }]]) {
    if (name === 'mobile') h.setTime(h.time() + 30000);
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await login(page, h, account);
    assert.equal(await page.locator('#article-status-filter').inputValue(), 'pending');
    assert.equal(await page.locator(cards).count(), 8);
    const initialIds = await page.locator(cards).evaluateAll(nodes => nodes.map(node => node.dataset.entityId));
    const [firstId, secondId] = initialIds.filter(id => id.startsWith('handbook-'));
    const firstRevision = h.bundle.revisions.find(row => row.entityId === firstId);

    // Search and topic filters keep selected records available to the batch.
    await page.locator('#article-search').fill(firstRevision.data.title);
    await page.waitForFunction(selector => document.querySelectorAll(selector).length === 1, cards);
    await card(page, firstId).locator('.article-select').check();
    await selectionIs(page, 1);
    await page.locator('#article-search').fill('');
    const topicId = h.bundle.entities.find(row => row.id === firstId).extensions.topicId;
    await page.locator('#article-topic-filter').selectOption(topicId);
    const filteredIds = await page.locator(cards).evaluateAll(nodes => nodes.map(node => node.dataset.entityId));
    assert.ok(filteredIds.length);
    assert.ok(filteredIds.every(id => h.bundle.entities.find(row => row.id === id).extensions.topicId === topicId));
    await selectionIs(page, 1);
    await page.locator('#article-topic-filter').selectOption('');
    await page.locator('#article-select-page').check();
    await selectionIs(page, 8);
    await page.locator('#article-select-page').uncheck();
    await selectionIs(page, 0);

    for (const entityId of [firstId, secondId]) {
      await expandedContent(page, h, entityId);
      await card(page, entityId).locator('.article-select').check();
    }
    assert.equal(await page.locator('details.article-content[open]').count(), 2);
    await page.locator('#article-next-page').click();
    const thirdId = await page.locator(cards).first().getAttribute('data-entity-id');
    await card(page, thirdId).locator('.article-select').check();
    await selectionIs(page, 3);
    await page.locator('#article-previous-page').click();
    assert.equal(await card(page, firstId).locator('.article-select').isChecked(), true);
    assert.equal(await card(page, secondId).locator('.article-select').isChecked(), true);
    const sharedReason = `已核对正文来源及适用范围，保存本批审核意见 ${name}`;
    const changedReason = `该篇适用范围需要补充校区说明，请按原站核对 ${name}`;
    const verificationReason = `该篇动态入口需要进一步人工验证，暂保留待核状态 ${name}`;
    await page.locator('#batch-decision').selectOption('approved');
    await page.locator('#batch-reason').fill(sharedReason);
    await page.locator('#batch-apply').click();
    await card(page, firstId).locator('.article-decision').selectOption('changes-requested');
    await card(page, firstId).locator('.article-reason').fill(changedReason);
    await page.locator('#article-next-page').click();
    await card(page, thirdId).locator('.article-decision').selectOption('needs-verification');
    await card(page, thirdId).locator('.article-reason').fill(verificationReason);
    await page.locator('#article-previous-page').click();

    await visibilityRoundTrip(page);
    await selectionIs(page, 3);
    assert.equal(await card(page, firstId).locator('.article-reason').inputValue(), changedReason);
    assert.equal(await card(page, firstId).locator('.article-decision').inputValue(), 'changes-requested');
    for (const entityId of [firstId, secondId]) await expandedContent(page, h, entityId);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: join(screenshots, `${name}-batch-review-full.png`), fullPage: true });
    await card(page, firstId).evaluate(node => window.scrollTo(0, node.getBoundingClientRect().top + scrollY - 20));
    await page.screenshot({ path: join(screenshots, `${name}-batch-review.png`) });
    if (name === 'mobile') await page.locator('.batch-review-panel').screenshot({ path: join(screenshots, 'mobile-batch-review-submit.png') });

    const beforeState = h.store.read();
    const beforeRecords = beforeState.modules['guide-reviews'].records.length;
    const beforeContent = beforeState.modules.content;
    const keys = [];
    if (name === 'desktop') {
      // First the network fails before commit, then a committed response is lost.
      // Both retries must keep the request ID, including a source-tab round trip.
      await page.route('**/api/guide/reviews/batch', async route => {
        assert.equal(route.request().postDataJSON().mode, 'review-and-publish');
        keys.push(route.request().headers()['idempotency-key']);
        if (keys.length === 1) {
          await route.abort('failed');
        } else if (keys.length === 2) {
          const response = await route.fetch();
          assert.equal(response.status(), 200, await response.text());
          await route.abort('failed');
        } else await route.continue();
      });
      for (const attempt of [1, 2]) {
        const failed = page.waitForEvent('requestfailed', request => request.url().endsWith('/api/guide/reviews/batch'));
        await page.locator('#batch-submit').click();
        await failed;
        await page.locator('#message[data-kind=error]').waitFor({ state: 'visible' });
        await page.waitForFunction(() => !document.querySelector('#batch-submit').disabled);
        await selectionIs(page, 3);
        assert.equal(h.store.read().modules['guide-reviews'].records.length, beforeRecords + (attempt === 1 ? 0 : 3));
        assert.equal(h.store.read().modules.content.revisions.length, beforeContent.revisions.length + (attempt === 1 ? 0 : 1));
        if (attempt === 1) {
          await visibilityRoundTrip(page);
          await selectionIs(page, 3);
        }
      }
    }
    const submitted = page.waitForResponse(response => response.url().endsWith('/api/guide/reviews/batch') && response.request().method() === 'POST');
    await page.locator('#batch-submit').click();
    const response = await submitted;
    const result = await response.json();
    assert.equal(response.status(), 200, JSON.stringify(result));
    assert.equal(response.request().postDataJSON().mode, 'review-and-publish');
    assert.equal(result.count, 3);
    assert.equal(result.publishedCount, 1);
    await selectionIs(page, 0);
    await card(page, firstId).waitFor({ state: 'detached' });
    if (name === 'desktop') assert.deepEqual(keys, [keys[0], keys[0], keys[0]]);
    const state = h.store.read();
    const written = state.modules['guide-reviews'].records.slice(beforeRecords);
    assert.equal(written.length, 3);
    const expected = new Map([[firstId, ['changes-requested', changedReason]], [secondId, ['approved', sharedReason]], [thirdId, ['needs-verification', verificationReason]]]);
    const approvedRevision = h.bundle.revisions.find(row => row.entityId === secondId);
    const publication = result.records.find(row => row.entityId === secondId);
    assert.ok(publication.publishedRevisionId);
    assert.notEqual(publication.publishedRevisionId, approvedRevision.id);
    assert.equal(publication.publicRevisionId, publication.publishedRevisionId);
    for (const row of written) {
      assert.equal(row.action, 'content.review');
      const payload = decryptPrivatePayload(row.id, row.payload, keyring);
      const [decision, reason] = expected.get(row.entityId);
      assert.equal(payload.decision ?? payload.outcome?.decision, decision);
      assert.equal(payload.reason, reason.normalize('NFKC'));
      assert.equal(JSON.stringify(row).includes(reason.normalize('NFKC')), false);
      assert.equal(payload.outcome.publishedRevisionId, row.entityId === secondId ? publication.publishedRevisionId : null);
      assert.equal(row.revisionId, h.bundle.revisions.find(revision => revision.entityId === row.entityId).id);
    }
    const content = state.modules.content;
    assert.equal(content.revisions.length, beforeContent.revisions.length + 1);
    const publishedRevision = content.revisions.find(row => row.id === publication.publishedRevisionId);
    assert.equal(publishedRevision.parentRevisionId, approvedRevision.id);
    assert.equal(publishedRevision.number, approvedRevision.number + 1);
    assert.equal(publishedRevision.data.origin, 'human');
    assert.equal(publishedRevision.data.originalOrigin, 'ai_draft');
    assert.equal(publishedRevision.data.reviewedFromRevisionId, approvedRevision.id);
    assert.deepEqual(publishedRevision.data.sentences, approvedRevision.data.sentences);
    const publishedEntity = content.entities.find(row => row.id === secondId);
    assert.equal(publishedEntity.publicRevisionId, publishedRevision.id);
    assert.equal(publishedEntity.version, beforeContent.entities.find(row => row.id === secondId).version + 1);
    for (const original of originalContent.revisions) assert.deepEqual(content.revisions.find(row => row.id === original.id), original);
    for (const original of originalContent.citations) assert.deepEqual(content.citations.find(row => row.id === original.id), original);
    for (const id of [firstId, thirdId]) {
      assert.deepEqual(content.entities.find(row => row.id === id), beforeContent.entities.find(row => row.id === id));
      await readJson(await h.get(`/api/guide/answers/${id}`), 404);
    }
    const publicAnswers = await readJson(await h.get('/api/guide/answers'));
    assert.ok(publicAnswers.some(answer => answer.id === secondId && answer.revisionId === publishedRevision.id));
    assert.ok(publicAnswers.every(answer => ![firstId, thirdId].includes(answer.id)));
    const publicAnswer = await readJson(await h.get(`/api/guide/answers/${secondId}`));
    assert.equal(publicAnswer.revisionId, publishedRevision.id);
    for (const reason of [sharedReason, changedReason, verificationReason]) assert.equal(JSON.stringify(publicAnswer).includes(reason.normalize('NFKC')), false);

    await page.locator('#article-status-filter').selectOption('approved');
    await card(page, secondId).waitFor();
    await expandedContent(page, h, secondId);
    assert.equal(await card(page, secondId).getAttribute('data-revision-id'), publishedRevision.id);
    assert.ok((await card(page, secondId).innerText()).includes('本修订已公开'));

    await page.locator('#article-status-filter').selectOption('changes-requested');
    await card(page, firstId).waitFor();
    await expandedContent(page, h, firstId);
    assert.ok((await card(page, firstId).innerText()).includes(changedReason.normalize('NFKC')));
    await page.reload();
    await page.locator(cards).first().waitFor();
    await page.locator('#article-status-filter').selectOption('changes-requested');
    await card(page, firstId).waitFor();
    await expandedContent(page, h, firstId);
    assert.ok((await card(page, firstId).innerText()).includes(changedReason.normalize('NFKC')));

    await card(page, firstId).locator('.article-select').check();
    await card(page, firstId).locator('.article-reason').fill('这是一条尚未提交的意见，退出后应从页面清除');
    await page.locator('#logout').click();
    await page.locator('#login-section').waitFor({ state: 'visible' });
    assert.equal(await page.locator(cards).count(), 0);
    assert.equal(await page.locator('#batch-reason').inputValue(), '');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('guide-editor-session')), null);
    assert.deepEqual(errors, []);
    await context.close();

    // Read the publication in a fresh, unauthenticated browser context.
    const readerContext = await browser.newContext({ viewport });
    const reader = await readerContext.newPage();
    const readerErrors = [];
    reader.on('pageerror', error => readerErrors.push(error.message));
    await reader.goto(`${h.base}/answers/${secondId}`);
    await reader.locator('#answer-detail h1').waitFor();
    assert.equal(await reader.locator('#answer-detail h1').innerText(), approvedRevision.data.title);
    const readerBody = await reader.locator('#answer-detail').innerText();
    for (const sentence of approvedRevision.data.sentences) assert.ok(readerBody.includes(sentence.text));
    assert.ok(await reader.locator('#answer-detail .citation a').count());
    assert.equal(await reader.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(readerErrors, []);
    await readerContext.close();
  }
});

test('content editors can inspect drafts without reviewing; logout rejects a delayed article response', async t => {
  const { h, browser } = await prepare(t);
  const session = await h.operator(['content_editor'], 'batch-readonly-editor');
  const context = await browser.newContext();
  t.after(() => context.close());
  await context.addInitScript(token => sessionStorage.setItem('guide-editor-session', token), session.token);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(h.base + '/editor');
  await page.locator(cards).first().waitFor();
  assert.equal(await page.locator('.article-select:not([disabled])').count(), 0);
  assert.equal(await page.locator('#batch-submit').isDisabled(), true);
  const entityId = await page.locator(cards).first().getAttribute('data-entity-id');
  await expandedContent(page, h, entityId);
  assert.equal(h.store.read().modules['guide-reviews'].records.length, 0);

  let releaseResponse;
  const held = new Promise(resolve => { releaseResponse = resolve; });
  let responseHeld;
  const received = new Promise(resolve => { responseHeld = resolve; });
  await page.route('**/api/guide/review-articles', async route => {
    const response = await route.fetch();
    responseHeld();
    await held;
    await route.fulfill({ response });
  });
  await page.locator('#refresh').click();
  await received;
  await page.locator('#logout').click();
  const delivered = page.waitForResponse(response => response.url().includes('/api/guide/review-articles'));
  releaseResponse();
  await delivered;
  // Flush the response handler, then verify no draft data reappeared after logout.
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
  assert.equal(await page.locator('#workspace').isVisible(), false);
  assert.equal(await page.locator(cards).count(), 0);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('guide-editor-session')), null);
  assert.deepEqual(errors, []);
});
