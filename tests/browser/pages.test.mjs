import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { importContent } from '@information-community/runtime';
import { buildPages } from '../../scripts/build-pages.mjs';
import { createReviewedPagesData, pagesContentHash } from '../../scripts/pages-snapshot.mjs';
import { createStore, keyring, loadCommunity, loadDemoPagesConfig } from '../helpers.mjs';

const require = createRequire(process.env.PLAYWRIGHT_PACKAGE ?? import.meta.url);
const { chromium } = require('playwright');
const basePath = '/xjtlu-unofficial-guide/';
const screenshots = resolve(process.env.GUIDE_SCREENSHOTS ?? 'community/.browser-qa');

function reviewedFixture(demo, { empty = false, onlyDemo = false, includeDemo = false, collectedCount = 0, onlyCollected = false } = {}) {
  const snapshot = {
    ...structuredClone(demo), mode: 'public-reviewed', answers: [],
  };
  if (!empty && !onlyDemo && !onlyCollected) {
    const answer = {
      id: 'synthetic-reviewed-ai', title: '人工确认后的合成审核文章', slug: 'synthetic-reviewed-ai',
      revisionId: 'synthetic-reviewed-ai-v2', revisionNumber: 2,
      sentences: [{ id: 'synthetic-sentence', kind: 'fact', text: '这是用于验收公开阅读界面的合成文章。' }],
      citations: [{
        id: 'synthetic-citation', sentenceId: 'synthetic-sentence', sourceEntityId: 'synthetic-source', sourceRevisionId: 'synthetic-source-v1',
        position: { kind: 'link' }, order: 0, title: '合成文章的来源链接', url: 'https://www.xjtlu.edu.cn/en/', mode: 'link-only',
      }],
      scope: { campus: ['sip'] }, warnings: [], summary: '核对人工审核标识、公开来源及静态页面复核提示。',
      asOf: '2026-09-08', verifiedAt: '2026-09-09T00:00:00Z', reviewDueAt: '2026-09-11T00:00:00Z',
      reviewOwnerLabel: '合成审核员', evidenceNote: '', topic: structuredClone(demo.answers[0].topic),
      demo: false, origin: 'human', originalOrigin: 'ai_draft', reviewStatus: 'approved',
    };
    answer.history = [{ id: answer.revisionId, number: answer.revisionNumber, title: answer.title }];
    const alreadyWarned = structuredClone(answer);
    Object.assign(alreadyWarned, {
      id: 'synthetic-reviewed-warned', slug: 'synthetic-reviewed-warned', title: '已带复核提示的合成文章',
      revisionId: 'synthetic-reviewed-warned-v2', warnings: ['待复核：已超过维护周期，请先核对原站。'],
    });
    alreadyWarned.history = [{ id: alreadyWarned.revisionId, number: alreadyWarned.revisionNumber, title: alreadyWarned.title }];
    snapshot.answers.push(answer, alreadyWarned);
  }
  if (onlyDemo || includeDemo) for (const answer of demo.answers) snapshot.answers.push({
    ...structuredClone(answer), origin: 'human', originalOrigin: 'human', reviewStatus: 'demo',
    ...Object.fromEntries(['summary', 'asOf', 'verifiedAt', 'reviewDueAt', 'reviewOwnerLabel', 'evidenceNote'].map(key => [key, answer[key] ?? ''])),
  });
  for (let index = 0; index < collectedCount; index++) {
    const id = `synthetic-collected-${String(index + 1).padStart(3, '0')}`;
    const topic = demo.catalog.topics[index % demo.catalog.topics.length];
    const answer = {
      ...structuredClone(demo.answers[0]), id, slug: id, title: `合成资料整理第 ${index + 1} 篇`,
      revisionId: `${id}-v1`, revisionNumber: 1, summary: '用于检验公开资料整理内容的标识、检索及投稿上下文。',
      demo: false, origin: 'ai_draft', originalOrigin: 'ai_draft', reviewStatus: 'collected',
      asOf: '2026-09-10', researchedAt: '2026-09-10', verifiedAt: '', reviewOwnerLabel: '尚未人工核验', reviewDueAt: '2026-12-10', evidenceNote: '', warnings: [],
      topic: { id: topic.id, slug: topic.slug, title: topic.titleZh },
    };
    answer.sentences = answer.sentences.map((sentence, sentenceIndex) => ({ ...sentence, text: `合成资料整理第 ${index + 1} 篇的第 ${sentenceIndex + 1} 段内容，用于浏览器测试。` }));
    answer.history = [{ id: answer.revisionId, number: answer.revisionNumber, title: answer.title }];
    snapshot.answers.push(answer);
  }
  if (collectedCount) snapshot.mode = 'public-guide';
  snapshot.contentHash = pagesContentHash(snapshot);
  return snapshot;
}

async function staticSite(t, { production = false, reviewed = false, empty = false, onlyDemo = false, includeDemo = false, contributionsRepository, collectedCount = 0, onlyCollected = false } = {}) {
  // Never consume or replace the operator's exported snapshot or build directory.
  const root = await mkdtemp(join(tmpdir(), 'guide-pages-browser-'));
  t.after(async () => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('guide-pages-browser-'));
    await rm(root, { recursive: true, force: true });
  });
  const community = join(root, 'community');
  await mkdir(community);
  const loaded = await loadCommunity({ includeDemo: !production });
  await Promise.all([
    ...['content-profile.json', 'catalog.json'].map(name => copyFile(resolve('community', name), join(community, name))),
    writeFile(join(community, 'content.json'), JSON.stringify(loaded.bundle)),
    cp(resolve('community/pages-ui'), join(community, 'pages-ui'), { recursive: true }),
  ]);
  const configFile = join(community, 'pages.config.json');
  const config = production
    ? JSON.parse(await readFile(resolve('community/pages.config.json'), 'utf8'))
    : await loadDemoPagesConfig();
  if (!production) delete config.collectedRevisionIds;
  if (contributionsRepository !== undefined) {
    if (contributionsRepository === null) delete config.contributionsRepository;
    else config.contributionsRepository = contributionsRepository;
  }
  await writeFile(configFile, JSON.stringify(config));
  if (production) {
    const store = createStore(loaded);
    try {
      store.transact(state => { state.modules.content = importContent(state.modules.content, loaded.bundle); });
      const catalog = JSON.parse(await readFile(join(community, 'catalog.json'), 'utf8'));
      const snapshot = createReviewedPagesData({ state: store.read(), catalog, config, keyring, now: '2026-09-10T00:00:00Z' });
      await writeFile(join(community, 'pages-reviewed.json'), JSON.stringify(snapshot));
    } finally { store.close(); }
  }
  const { output } = await buildPages({ root, basePath, now: '2026-09-10T00:00:00Z' });
  if (reviewed) {
    const demo = JSON.parse(await readFile(join(output, 'public.json'), 'utf8'));
    const snapshot = reviewedFixture(demo, { empty, onlyDemo, includeDemo, collectedCount, onlyCollected });
    config.collectedRevisionIds = snapshot.answers.filter(answer => answer.reviewStatus === 'collected').map(answer => answer.revisionId);
    await writeFile(configFile, JSON.stringify(config));
    await writeFile(join(community, 'pages-reviewed.json'), JSON.stringify(snapshot));
    await buildPages({ root, basePath });
  }
  const assets = new Map();
  for (const [name, type] of [
    ['index.html', 'text/html; charset=utf-8'], ['app.js', 'text/javascript; charset=utf-8'], ['contributions.js', 'text/javascript; charset=utf-8'],
    ['branches.js', 'text/javascript; charset=utf-8'], ['branch-model.js', 'text/javascript; charset=utf-8'],
    ['core/index.js', 'text/javascript; charset=utf-8'], ['core/branches.js', 'text/javascript; charset=utf-8'], ['branches.css', 'text/css; charset=utf-8'],
    ['style.css', 'text/css; charset=utf-8'], ['brand.svg', 'image/svg+xml'], ['public.json', 'application/json; charset=utf-8'],
  ]) assets.set(basePath + (name === 'index.html' ? '' : name), { body: await readFile(join(output, name)), type });
  const requests = [];
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://local.test').pathname;
    requests.push({ path, method: request.method });
    const asset = assets.get(path);
    if (!asset || request.method !== 'GET') { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'Content-Type': asset.type, 'Cache-Control': 'no-store' });
    response.end(asset.body);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const launch = { headless: true };
  const channel = process.env.PLAYWRIGHT_CHANNEL ?? (process.env.CI ? 'chromium' : 'msedge');
  if (channel !== 'chromium') launch.channel = channel;
  const browser = await chromium.launch(launch);
  t.after(() => browser.close());
  await mkdir(screenshots, { recursive: true });
  return {
    browser, requests, base: `http://127.0.0.1:${server.address().port}${basePath}`,
    data: JSON.parse(assets.get(basePath + 'public.json').body.toString('utf8')),
  };
}

async function assertPageFits(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.equal(await page.locator('img').evaluateAll(images => images.filter(image => !image.complete || image.naturalWidth === 0).length), 0);
}

test('Pages branches group independent statements and preserve reading context across desktop and mobile', async t => {
  const site = await staticSite(t, { reviewed: true, collectedCount: 1, includeDemo: true });
  const data = structuredClone(site.data);
  // Older public snapshots have no relationship field. Their articles still form topic branches.
  delete data.links;
  const [first, second] = data.answers;
  first.sourceCategories = ['university_official'];
  second.sourceCategories = ['user_provided'];
  second.reviewStatus = 'collected';
  second.researchedAt = '2026-09-10';
  second.verifiedAt = '';
  const siblings = data.answers.filter(answer => answer.topic?.id === first.topic.id);
  assert.ok(siblings.length > 1);
  for (const [name, viewport] of [['desktop', { width: 1440, height: 1040 }], ['mobile', { width: 390, height: 844 }]]) {
    const context = await site.browser.newContext({ viewport });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => { Date.now = () => Date.parse('2026-09-12T00:00:00Z'); });
    await page.route('**/public.json', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) }));
    await page.goto(site.base);
    await page.locator('body[data-ready=true]').waitFor();
    assert.equal(await page.locator('#branches-mode').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#answer-list').isVisible(), false);
    const topicToggle = page.locator('#directory-branches').getByRole('button', { name: '展开话题：' + first.topic.title, exact: true });
    assert.equal(await topicToggle.getAttribute('aria-expanded'), 'false');
    await assertPageFits(page);
    await page.screenshot({ path: join(screenshots, `${name}-pages-branches-overview.png`), fullPage: true });
    await topicToggle.click();
    const expandedToggle = page.locator('#directory-branches').getByRole('button', { name: '收起话题：' + first.topic.title, exact: true });
    assert.equal(await expandedToggle.getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('#directory-branches .guide-branch-answer:visible').count(), siblings.length);
    const firstCard = page.locator(`#directory-branches .guide-branch-answer[data-answer-id="${first.id}"]`);
    const secondCard = page.locator(`#directory-branches .guide-branch-answer[data-answer-id="${second.id}"]`);
    assert.match(await firstCard.innerText(), /学校官方/u);
    assert.match(await firstCard.innerText(), /人工审核|人工核验|已审核/u);
    assert.match(await secondCard.innerText(), /用户提供/u);
    assert.match(await secondCard.innerText(), /待人工核验/u);
    for (const card of [firstCard, secondCard]) {
      assert.equal(await card.locator('.guide-branch-warning').count(), 1, 'overdue warnings are computed from the current date without duplicating existing warnings');
      assert.match(await card.locator('.guide-branch-warning').innerText(), /待复核/u);
    }
    await assertPageFits(page);
    await page.screenshot({ path: join(screenshots, `${name}-pages-branches-expanded.png`), fullPage: true });
    await expandedToggle.click();
    assert.equal(await firstCard.isVisible(), false);
    await topicToggle.focus();
    await topicToggle.press('Enter');
    await firstCard.getByRole('link', { name: first.title, exact: true }).click();
    await page.locator('#detail-view').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#answer-detail h1').innerText(), first.title);
    assert.equal(await page.locator('#answer-detail .answer-body').innerText(), first.sentences[0].text);
    assert.equal(await page.locator('#answer-branches a[aria-current=true]').innerText(), first.title);
    await page.locator('#answer-branches').getByRole('link', { name: second.title, exact: true }).click();
    await page.locator('#answer-detail h1').filter({ hasText: second.title }).waitFor();
    assert.equal(await page.locator('#answer-detail h1').innerText(), second.title);
    assert.equal(await page.locator('#answer-branches a[aria-current=true]').innerText(), second.title);
    assert.match(await page.locator('#answer-detail').innerText(), /尚未逐条人工核验/u);
    await assertPageFits(page);
    await page.screenshot({ path: join(screenshots, `${name}-pages-branches-detail.png`), fullPage: true });
    await page.locator('#back-to-list').click();
    await page.locator('#answers-view').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#branches-mode').getAttribute('aria-pressed'), 'true');
    await page.locator('#topic').selectOption(first.topic.id);
    assert.equal(await page.locator('#directory-branches .guide-branch-answer:visible').count(), siblings.length);
    await page.locator('#query').fill(first.title);
    assert.equal(await page.locator('#count').innerText(), '1 条答案');
    assert.equal(await page.locator('#directory-branches .guide-branch-answer:visible').count(), 1);
    await firstCard.getByRole('link', { name: first.title, exact: true }).click();
    await page.locator('#detail-view').waitFor({ state: 'visible' });
    const parameters = new URLSearchParams(new URL(page.url()).hash.split('?')[1]);
    assert.equal(parameters.get('view'), 'branches');
    assert.equal(parameters.get('query'), first.title);
    assert.equal(parameters.get('topic'), first.topic.id);
    assert.equal(await page.locator('#answer-branches .guide-branch-answer:visible').count(), siblings.length, 'detail shows the other topic statements beyond the search result');
    await page.reload();
    await page.locator('body[data-ready=true]').waitFor();
    assert.equal(await page.locator('#answer-branches a[aria-current=true]').innerText(), first.title);
    await page.locator('#back-to-list').click();
    await page.locator('#answers-view').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#query').inputValue(), first.title);
    assert.equal(await page.locator('#topic').inputValue(), first.topic.id);
    assert.equal(await page.locator('#branches-mode').getAttribute('aria-pressed'), 'true');
    await page.locator('#list-mode').click();
    assert.equal(await page.locator('#directory-branches').isVisible(), false);
    assert.equal(await page.locator('#answer-list .answer-item').count(), 1);
    await page.locator('#answer-list a').click();
    await page.locator('#detail-view').waitFor({ state: 'visible' });
    await page.reload();
    await page.locator('body[data-ready=true]').waitFor();
    await page.locator('#back-to-list').click();
    await page.locator('#answers-view').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#list-mode').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#query').inputValue(), first.title);
    assert.equal(await page.locator('#topic').inputValue(), first.topic.id);
    await page.locator('#branches-mode').click();
    await page.locator('#query').fill('synthetic-query-with-no-matching-answer');
    assert.equal(await page.locator('#count').innerText(), '0 条答案');
    assert.equal(await page.locator('#directory-branches .guide-branch-answer:visible').count(), 0);
    await page.locator('#topic').selectOption('');
    await page.locator('#query').fill(first.title);
    assert.equal(await page.locator('#directory-branches .guide-branch-answer:visible').count(), 1, 'search expands a matching topic without an explicit topic filter');
    await page.locator('#directory-branches').getByRole('button', { name: '收起话题：' + first.topic.title, exact: true }).click();
    assert.equal(await page.locator('#directory-branches .guide-branch-answer:visible').count(), 0, 'search results can still be collapsed manually');
    await assertPageFits(page);
    assert.deepEqual(errors, []);
    assert.deepEqual(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })), { local: 0, session: 0 });
    await context.close();
  }
  assert.ok(site.requests.every(request => request.method === 'GET' && request.path.startsWith(basePath) && !request.path.includes('/api/')));
});

test('Pages branches show explicit public relationships as escaped cross links and locate the current statement', async t => {
  const site = await staticSite(t, { reviewed: true });
  const data = structuredClone(site.data);
  const [first, second] = data.answers;
  const reason = '合成关联理由：补充另一种经验。<img src=x onerror="window.__branchInjection=true">';
  data.links = [
    { id: 'synthetic-related', from: first.id, to: second.id, type: 'related', reason },
    { id: 'synthetic-hidden-endpoint', from: first.id, to: 'not-a-public-answer', type: 'related', reason: '不可见端点的合成理由' },
  ];
  const context = await site.browser.newContext({ viewport: { width: 390, height: 844 } });
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/public.json', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) }));
  await page.goto(site.base);
  await page.locator('body[data-ready=true]').waitFor();
  const related = page.locator('#directory-branches .guide-branch-related');
  assert.equal(await related.getAttribute('open'), null);
  assert.equal(await related.locator('summary').innerText(), '横向关联 · 1 条');
  await related.locator('summary').click();
  assert.ok((await related.innerText()).includes(reason));
  assert.doesNotMatch(await page.locator('#directory-branches').innerText(), /不可见端点|not-a-public-answer/u);
  assert.equal(await related.locator('img').count(), 0);
  assert.equal(await page.evaluate(() => window.__branchInjection), undefined);
  await assertPageFits(page);
  await page.screenshot({ path: join(screenshots, 'mobile-pages-branches-relationships.png'), fullPage: true });
  await related.getByRole('link', { name: second.title, exact: true }).click();
  await page.locator('#detail-view').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#answer-detail h1').innerText(), second.title);
  await page.locator('#answer-branches .guide-branch-locate').click();
  assert.equal(await page.locator('#answer-branches a[aria-current=true]').evaluate(link => document.activeElement === link), true);
  await assertPageFits(page);
  assert.deepEqual(errors, []);
});

test('the production guide contains 76 collected articles and no demo pages on desktop and mobile', async t => {
  const site = await staticSite(t, { production: true });
  assert.equal(site.data.mode, 'public-guide');
  assert.equal(site.data.answers.length, 76);
  assert.ok(site.data.answers.every(answer => answer.demo === false && answer.reviewStatus === 'collected'));
  const removedIds = ['card-ebridge-entry', 'card-current-student-entry', 'card-learning-mall-help', 'card-read-status'];
  for (const viewport of [{ width: 1440, height: 1040 }, { width: 390, height: 844 }]) {
    const context = await site.browser.newContext({ viewport });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(site.base + '#/answers?view=list');
    await page.locator('body[data-ready=true]').waitFor();
    assert.equal(await page.locator('#edition-label').innerText(), '公开只读指南');
    assert.equal(await page.locator('#count').innerText(), '76 条答案');
    assert.equal(await page.locator('#answer-list [data-review-status=collected]').count(), 76);
    assert.equal(await page.locator('#answer-list [data-review-status=demo], .demo').count(), 0);
    assert.doesNotMatch(await page.locator('#answer-list').innerText(), /演示内容/u);
    await assertPageFits(page);
    await page.locator('#branches-mode').click();
    assert.match(await page.locator('#directory-branches .guide-branch-root').innerText(), /76 条独立陈述/u);
    await page.locator('#directory-branches').getByRole('button', { name: '展开所有话题', exact: true }).click();
    assert.ok(await page.locator('#directory-branches .guide-branch-answer:visible').count() < 76);
    for (let batch = 0; batch < 4 && await page.locator('#directory-branches .guide-branch-more').count(); batch++) {
      await page.locator('#directory-branches .guide-branch-more').click();
    }
    assert.equal(await page.locator('#directory-branches .guide-branch-answer:visible').count(), 76);
    assert.equal(new Set(await page.locator('#directory-branches .guide-branch-answer').evaluateAll(cards => cards.map(card => card.dataset.answerId))).size, 76);
    assert.equal(await page.locator('#directory-branches .guide-branch-more').count(), 0);
    assert.doesNotMatch(await page.locator('#directory-branches').innerText(), /演示内容/u);
    await assertPageFits(page);
    await page.locator('#about-nav').click();
    await page.locator('#about-view').waitFor({ state: 'visible' });
    assert.match(await page.locator('#about-content-description').innerText(), /尚未逐条人工核验/u);
    assert.doesNotMatch(await page.locator('#about-view').innerText(), /演示|示范/u);
    for (const id of removedIds) {
      await page.goto(site.base + '#/answers/' + id);
      await page.locator('#missing-view').waitFor({ state: 'visible' });
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test('public Pages reader works on a project subpath across desktop and mobile with no APIs', async t => {
  const site = await staticSite(t);
  const first = site.data.answers[0];
  assert.ok(first);
  for (const [name, viewport] of [['desktop', { width: 1440, height: 1040 }], ['mobile', { width: 390, height: 844 }]]) {
    const context = await site.browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push({ url: request.url(), method: request.method() }));
    await page.goto(site.base + '#/answers?view=list');
    await page.locator('body[data-ready=true]').waitFor();
    assert.equal(await page.locator('#answer-list .answer-item').count(), site.data.answers.length);
    assert.equal(await page.getByText('公开只读演示', { exact: true }).count(), 1);
    assert.equal(await page.locator('input[type=password]').count(), 0);
    assert.equal(await page.locator('a[href^="/"]').count(), 0);
    await assertPageFits(page);
    await page.screenshot({ path: join(screenshots, `${name}-pages-reader.png`), fullPage: true });

    await page.locator('#query').fill('synthetic-query-with-no-matching-answer');
    assert.equal(await page.locator('#answer-list .answer-item').count(), 0);
    assert.match(await page.locator('#answer-list').innerText(), /暂无符合条件/u);
    await page.locator('#query').fill('教务系统');
    assert.ok(await page.locator('#answer-list .answer-item').count() > 0);
    await page.reload();
    await page.locator('body[data-ready=true]').waitFor();
    assert.equal(await page.locator('#query').inputValue(), '教务系统');
    assert.ok(await page.locator('#answer-list .answer-item').count() > 0);
    await page.locator('#query').fill('');
    await page.locator('#topic').selectOption(first.topic.id);
    assert.equal(await page.locator('#answer-list .answer-item').count(), site.data.answers.filter(answer => answer.topic?.id === first.topic.id).length);
    await page.locator(`#answer-list a[href^="#/answers/${encodeURIComponent(first.id)}?"]`).click();
    await page.locator('#detail-view').waitFor({ state: 'visible' });
    assert.equal(new URL(page.url()).pathname, basePath);
    assert.equal(new URL(page.url()).hash.split('?')[0], '#/answers/' + encodeURIComponent(first.id));
    assert.equal(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('view'), 'list');
    assert.equal(await page.locator('#answer-detail h1').innerText(), first.title);
    assert.ok(await page.locator('#answer-detail .answer-body').count() > 0);
    assert.ok(await page.locator('#answer-detail .citation').count() > 0);
    for (const link of await page.locator('#answer-detail .citation a').all()) {
      assert.ok((await link.getAttribute('href')).startsWith('https://'));
      assert.match(await link.getAttribute('rel'), /noopener/u);
    }
    await assertPageFits(page);
    await page.screenshot({ path: join(screenshots, `${name}-pages-detail.png`), fullPage: true });
    await page.reload();
    await page.locator('body[data-ready=true]').waitFor();
    assert.equal(await page.locator('#answer-detail h1').innerText(), first.title);
    await page.locator('#back-to-list').click();
    await page.locator('#answers-view').waitFor({ state: 'visible' });

    await page.locator('#about-nav').click();
    await page.locator('#about-view').waitFor({ state: 'visible' });
    assert.match(await page.locator('#about-view').innerText(), /没有官方隶属关系/u);
    await assertPageFits(page);
    await page.screenshot({ path: join(screenshots, `${name}-pages-about.png`), fullPage: true });
    await page.goto(site.base + '#/answers/unknown-answer');
    await page.locator('#missing-view').waitFor({ state: 'visible' });
    await page.goto(site.base + '#/answers/%E0%A4%A');
    await page.locator('#missing-view').waitFor({ state: 'visible' });
    assert.deepEqual(errors, []);
    assert.ok(requests.every(request => request.method === 'GET' && new URL(request.url).pathname.startsWith(basePath) && !new URL(request.url).pathname.includes('/api/')));
    assert.deepEqual(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })), { local: 0, session: 0 });
    await context.close();
  }
  assert.ok(site.requests.every(request => request.method === 'GET' && request.path.startsWith(basePath) && !request.path.includes('/api/')));
});

test('public DTO text is escaped, unsafe citation URLs are inert, and long words fit mobile', async t => {
  const site = await staticSite(t);
  const data = structuredClone(site.data);
  const answer = data.answers[0];
  const injection = '<img src=x onerror="window.__pagesInjection=true">';
  answer.title = injection;
  answer.summary = 'LongUnbrokenPublicContent'.repeat(20);
  answer.sentences[0].text = injection + ' ' + 'LongUnbrokenAnswer'.repeat(25);
  answer.citations[0].title = injection;
  answer.citations[0].url = 'javascript:window.__pagesInjection=true';
  answer.citations[0].excerpt = injection;
  const context = await site.browser.newContext({ viewport: { width: 390, height: 844 } });
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/public.json', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) }));
  await page.goto(site.base + '#/answers?view=list');
  await page.locator('body[data-ready=true]').waitFor();
  assert.match(await page.locator('#answer-list').innerText(), /<img src=x/u);
  assert.equal(await page.locator('#answer-list img').count(), 0);
  await assertPageFits(page);
  await page.goto(site.base + '#/answers/' + encodeURIComponent(answer.id));
  await page.locator('#detail-view').waitFor({ state: 'visible' });
  assert.match(await page.locator('#answer-detail').innerText(), /<img src=x/u);
  assert.equal(await page.locator('#answer-detail img').count(), 0);
  assert.equal(await page.locator('a[href^="javascript:"]').count(), 0);
  assert.equal(await page.evaluate(() => window.__pagesInjection), undefined);
  await assertPageFits(page);
  await page.screenshot({ path: join(screenshots, 'mobile-pages-long-content.png'), fullPage: true });
  assert.deepEqual(errors, []);
});

test('reviewed Pages show AI confirmation and recompute overdue warnings across desktop and mobile', async t => {
  const site = await staticSite(t, { reviewed: true });
  assert.equal(site.data.mode, 'public-reviewed');
  assert.equal(site.data.answers.length, 2);
  const first = site.data.answers[0], alreadyWarned = site.data.answers[1];
  assert.deepEqual(first.warnings, [], 'the snapshot was exported before its review deadline');
  for (const [name, viewport] of [['desktop', { width: 1440, height: 1040 }], ['mobile', { width: 390, height: 844 }]]) {
    const context = await site.browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => { Date.now = () => Date.parse('2026-09-12T00:00:00Z'); });
    await page.goto(site.base + '#/answers?view=list');
    await page.locator('body[data-ready=true]').waitFor();
    assert.equal(await page.locator('#edition-label').innerText(), '公开只读指南');
    assert.equal(await page.locator('#edition-note').innerText(), '经人工审核 · 非学校官方信息');
    assert.equal(await page.locator('#answer-list .answer-item').count(), 2);
    for (const item of await page.locator('#answer-list .answer-item').all()) {
      assert.equal(await item.locator('.warning').count(), 1, 'existing overdue warnings must not be duplicated');
      assert.match(await item.locator('.warning').innerText(), /待复核/u);
    }
    assert.equal(await page.locator('.demo').count(), 0);
    assert.equal(await page.locator('input[type=password]').count(), 0);
    await assertPageFits(page);
    await page.screenshot({ path: join(screenshots, `${name}-pages-reviewed-reader.png`), fullPage: true });

    await page.locator('#query').fill(first.title);
    assert.equal(await page.locator('#answer-list .answer-item').count(), 1);
    await page.locator('#answer-list a').click();
    await page.locator('#detail-view').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#answer-detail h1').innerText(), first.title);
    assert.match(await page.locator('#answer-detail').innerText(), /AI 辅助初稿，经人工审核确认/u);
    assert.match(await page.locator('#answer-detail').innerText(), /合成审核员/u);
    assert.equal(await page.locator('#answer-detail .answer-body').innerText(), first.sentences[0].text);
    assert.equal(await page.locator('#answer-detail .citation a').getAttribute('href'), first.citations[0].url);
    assert.equal(await page.locator('#answer-detail .warning').count(), 1);
    assert.equal(await page.locator('#answer-detail .history span').count(), 1);
    assert.match(await page.locator('#answer-detail .history').innerText(), /第 2 版/u);
    await assertPageFits(page);
    await page.screenshot({ path: join(screenshots, `${name}-pages-reviewed-detail.png`), fullPage: true });

    await page.reload();
    await page.locator('body[data-ready=true]').waitFor();
    assert.equal(await page.locator('#answer-detail h1').innerText(), first.title);
    assert.equal(await page.locator('#answer-detail .warning').count(), 1);
    await page.goto(site.base + '#/answers/' + encodeURIComponent(alreadyWarned.id));
    await page.locator('#detail-view').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#answer-detail .warning').count(), 1);

    await page.locator('#about-nav').click();
    await page.locator('#about-view').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#about-content-title').innerText(), '已审核内容');
    assert.match(await page.locator('#about-content-description').innerText(), /已由编辑审核并发布/u);
    assert.match(await page.locator('#about-snapshot-description').innerText(), /需要再次同步/u);
    assert.doesNotMatch(await page.locator('#about-view').innerText(), /本页公开展示项目中的示范/u);
    await assertPageFits(page);
    assert.deepEqual(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })), { local: 0, session: 0 });
    assert.deepEqual(errors, []);
    await context.close();
  }
  assert.ok(site.requests.every(request => request.method === 'GET' && request.path.startsWith(basePath) && !request.path.includes('/api/')));
});

test('an empty reviewed Pages snapshot remains an empty directory without demo fallback', async t => {
  const site = await staticSite(t, { reviewed: true, empty: true });
  assert.equal(site.data.mode, 'public-reviewed');
  assert.deepEqual(site.data.answers, []);
  const context = await site.browser.newContext({ viewport: { width: 390, height: 844 } });
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(site.base + '#/answers?view=list');
  await page.locator('body[data-ready=true]').waitFor();
  assert.equal(await page.locator('#edition-label').innerText(), '公开只读指南');
  assert.equal(await page.locator('#edition-note').innerText(), '暂无已发布内容');
  assert.equal(await page.locator('#count').innerText(), '0 条答案');
  assert.equal(await page.locator('#answer-list .answer-item').count(), 0);
  assert.match(await page.locator('#answer-list').innerText(), /暂无符合条件的公开答案/u);
  assert.equal(await page.getByText('公开只读演示', { exact: true }).count(), 0);
  await page.locator('#query').fill('教务系统');
  assert.equal(await page.locator('#answer-list .answer-item').count(), 0);
  await page.reload();
  await page.locator('body[data-ready=true]').waitFor();
  assert.equal(await page.locator('#count').innerText(), '0 条答案');
  await assertPageFits(page);
  await page.screenshot({ path: join(screenshots, 'mobile-pages-reviewed-empty.png'), fullPage: true });
  await page.goto(site.base + '#/answers/synthetic-reviewed-ai');
  await page.locator('#missing-view').waitFor({ state: 'visible' });
  assert.deepEqual(errors, []);
  assert.ok(site.requests.every(request => request.method === 'GET' && request.path.startsWith(basePath) && !request.path.includes('/api/')));
});

test('reviewed snapshots keep demo-only and mixed-edition labels accurate', async t => {
  for (const onlyDemo of [true, false]) {
    const site = await staticSite(t, { reviewed: true, onlyDemo, includeDemo: !onlyDemo });
    const context = await site.browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(site.base + '#/answers?view=list');
    await page.locator('body[data-ready=true]').waitFor();
    assert.equal(await page.locator('#edition-label').innerText(), onlyDemo ? '公开只读演示' : '公开只读指南');
    if (onlyDemo) assert.doesNotMatch(await page.locator('.edition').innerText(), /经人工审核/u);
    else assert.match(await page.locator('#edition-note').innerText(), /含审核文章和演示内容/u);
    assert.equal(await page.locator('#answer-list .demo').count(), site.data.answers.filter(answer => answer.demo).length);
    const demo = site.data.answers.find(answer => answer.demo);
    await page.goto(site.base + '#/answers/' + encodeURIComponent(demo.id));
    await page.locator('#detail-view').waitFor({ state: 'visible' });
    assert.match(await page.locator('#answer-detail').innerText(), /演示内容，真实试点前需重新审核/u);
    await page.locator('#about-nav').click();
    await page.locator('#about-view').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#about-content-title').innerText(), onlyDemo ? '示范内容' : '审核文章与演示内容');
    assert.match(await page.locator('#about-content-description').innerText(), onlyDemo ? /示范答案尚不代表真实试点的正式审核结果/u : /标有「演示内容」的文章/u);
    await assertPageFits(page);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

async function fillContribution(page, overrides = {}) {
  const values = {
    type: 'new', title: '补充图书馆入口 & 开放时间', content: '这里是具体内容。\n第二行包含中文、&、# 和 emoji 📚。',
    source: 'https://example.com/source?year=2026&campus=sip', campus: '苏州工业园区校区',
    audience: '本科新生', time: '2026 年 9 月', ai: '未使用', ...overrides,
  };
  await page.locator('#contribution-type').selectOption(values.type);
  for (const field of ['title', 'content', 'source', 'audience', 'time', 'ai']) await page.locator(`#contribution-${field}`).fill(values[field]);
  await page.locator('#contribution-campus').selectOption(values.campus);
  await page.locator('#contribution-public').check();
  return values;
}

async function openContribution(context, page) {
  const popupPromise = context.waitForEvent('page');
  await page.locator('#contribution-submit').click();
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');
  const url = new URL(popup.url());
  assert.equal(await popup.title(), 'Synthetic GitHub Form');
  await popup.close();
  return url;
}

test('Pages drafts all contribution types on site and prefills GitHub without submitting', async t => {
  const repository = 'SyntheticOwner/public-guide-feedback';
  const site = await staticSite(t, { reviewed: true, contributionsRepository: repository });
  const first = site.data.answers[0];
  for (const [name, viewport] of [['desktop', { width: 1440, height: 1040 }], ['mobile', { width: 390, height: 844 }]]) {
    const context = await site.browser.newContext({ viewport });
    const requests = [], errors = [];
    context.on('request', request => requests.push({ url: request.url(), method: request.method(), headers: request.headers() }));
    // Intercept the destination; never contact GitHub or submit a public Issue.
    await context.route('https://github.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Synthetic GitHub Form</title><p>Submission remains a manual GitHub action.</p>' }));
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(site.base + '#/answers?view=list');
    await page.locator('body[data-ready=true]').waitFor();
    await page.locator('#contribute-nav').click();
    await page.locator('#contribute-view').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#contribute-nav').getAttribute('aria-current'), 'page');
    assert.match(await page.locator('#contribute-view').innerText(), /需要登录 GitHub 账号/u);
    assert.match(await page.locator('#contribute-view').innerText(), /提交内容公开可见/u);
    assert.match(await page.locator('#contribute-view').innerText(), /请勿填写手机号、学号、证件号/u);
    assert.equal(await page.locator('#contribution-context').isVisible(), false);
    await page.locator('#contribution-submit').click();
    assert.equal(requests.filter(request => new URL(request.url).hostname === 'github.com').length, 0);
    assert.equal(await page.locator('#contribution-title').evaluate(input => input.validity.valueMissing), true);
    for (const [type, prefix, heading] of [['new', '新资料', '信息正文'], ['correction', '纠错', '哪里需要更正'], ['experience', '个人经验', '你的经历']]) {
      const values = await fillContribution(page, { type, ...(type === 'correction' ? { source: '' } : {}) });
      assert.equal(await page.locator('#contribution-content-label').innerText(), heading);
      assert.equal(await page.locator('#contribution-source').evaluate(input => input.required), type !== 'correction');
      const url = await openContribution(context, page);
      assert.equal(url.origin + url.pathname, `https://github.com/${repository}/issues/new`);
      assert.equal(url.searchParams.get('template'), 'website-contribution.md');
      assert.equal(url.searchParams.get('title'), `[${prefix}] ${values.title}`);
      const body = url.searchParams.get('body');
      for (const field of ['content', 'campus', 'audience', 'time', 'ai']) assert.ok(body.includes(values[field]));
      assert.ok(body.includes(values.source || '暂未提供'));
      assert.match(body, /公开提交确认/u);
      assert.doesNotMatch(body, /关联文章/u);
      assert.deepEqual([...url.searchParams.keys()], ['template', 'title', 'body']);
      assert.equal(await page.locator('#contribution-content').inputValue(), values.content);
      assert.match(await page.locator('#contribution-status').innerText(), /尚未创建 Issue/u);
    }
    await assertPageFits(page);
    await page.screenshot({ path: join(screenshots, `${name}-pages-contribute.png`), fullPage: true });

    await page.goto(site.base + '#/answers/' + encodeURIComponent(first.id));
    await page.locator('#detail-view').waitFor({ state: 'visible' });
    await page.getByRole('link', { name: '补充/更正这篇', exact: true }).click();
    await page.locator('#contribute-view').waitFor({ state: 'visible' });
    assert.match(await page.locator('#contribution-context').innerText(), new RegExp(first.title, 'u'));
    await fillContribution(page, { type: 'correction', source: '' });
    const url = await openContribution(context, page);
    const body = url.searchParams.get('body');
    assert.ok(body.includes(new URL('#/answers/' + encodeURIComponent(first.id), site.data.site.publicUrl).href));
    assert.ok(body.includes(first.revisionId));
    assert.ok(body.includes(first.title));
    assert.doesNotMatch(url.href, /127\.0\.0\.1|localhost/u);
    assert.equal(await page.locator('#contribution-open').getAttribute('target'), '_blank');
    assert.match(await page.locator('#contribution-open').getAttribute('rel'), /noopener/u);
    await assertPageFits(page);
    await page.screenshot({ path: join(screenshots, `${name}-pages-contribute-article.png`), fullPage: true });

    await page.goto(site.base + '#/contribute?article=' + encodeURIComponent(first.id) + '&revision=forged-private-version&context=private-note');
    await page.locator('#contribute-view').waitFor({ state: 'visible' });
    assert.match(await page.locator('#contribution-context').innerText(), /文章已更新/u);
    await fillContribution(page);
    const current = await openContribution(context, page);
    assert.ok(current.searchParams.get('body').includes(first.revisionId));
    assert.doesNotMatch(current.href, /forged-private-version|private-note/u);
    await page.goto(site.base + '#/contribute?article=unknown-private-id');
    await page.locator('#contribute-view').waitFor({ state: 'visible' });
    assert.match(await page.locator('#contribution-context').innerText(), /未找到关联的公开文章/u);
    await fillContribution(page);
    const unknown = await openContribution(context, page);
    assert.doesNotMatch(unknown.searchParams.get('body'), /关联文章|unknown-private-id/u);
    assert.ok(requests.every(request => request.method === 'GET' && !request.headers.authorization));
    assert.ok(requests.filter(request => new URL(request.url).hostname === 'github.com').every(request => !request.headers.referer));
    assert.deepEqual(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })), { local: 0, session: 0 });
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test('Pages contribution validation and long-draft fallback preserve content without navigation', async t => {
  const site = await staticSite(t);
  const context = await site.browser.newContext({ viewport: { width: 390, height: 844 } });
  t.after(() => context.close());
  const page = await context.newPage(), requests = [];
  context.on('request', request => requests.push(request.url()));
  await page.goto(site.base + '#/contribute');
  await page.locator('body[data-ready=true]').waitFor();
  await fillContribution(page);
  await page.locator('#contribution-public').uncheck();
  await page.locator('#contribution-submit').click();
  assert.equal(await page.locator('#contribution-public').evaluate(input => input.validity.valueMissing), true);
  await page.locator('#contribution-public').check();
  await page.locator('#contribution-content').fill('   ');
  await page.locator('#contribution-submit').click();
  assert.equal(await page.locator('#contribution-content').evaluate(input => input.validity.customError), true);
  const content = '完整保留这段较长的亲历内容。'.repeat(100);
  await page.locator('#contribution-content').fill(content);
  await page.locator('#contribution-submit').click();
  assert.equal(await page.locator('#contribution-long').isVisible(), true);
  assert.ok((await page.locator('#contribution-copy-body').inputValue()).includes(content));
  assert.equal(await page.locator('#contribution-content').inputValue(), content);
  assert.equal(await page.locator('#contribution-open').isVisible(), false);
  const fallback = new URL(await page.locator('#contribution-long-open').getAttribute('href'));
  assert.equal(fallback.searchParams.has('body'), false);
  assert.match(fallback.searchParams.get('title'), /补充图书馆入口/u);
  assert.equal(requests.some(url => new URL(url).hostname === 'github.com'), false);
  await assertPageFits(page);
  await page.screenshot({ path: join(screenshots, 'mobile-pages-contribution-long.png'), fullPage: true });
  await page.locator('#contribution-content').fill('修改后的简短内容');
  assert.equal(await page.locator('#contribution-long').isVisible(), false);
  assert.equal(await page.locator('#contribution-long-open').getAttribute('href'), null);
  await page.locator('#about-nav').click();
  await page.locator('#contribute-nav').click();
  assert.equal(await page.locator('#contribution-content').inputValue(), '修改后的简短内容');
  await page.reload();
  await page.locator('body[data-ready=true]').waitFor();
  assert.equal(await page.locator('#contribution-content').inputValue(), '');
});

test('Pages contribution entry does not invent a destination without a configured public repository', async t => {
  const site = await staticSite(t, { contributionsRepository: null });
  const context = await site.browser.newContext({ viewport: { width: 390, height: 844 } });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(site.base + '#/contribute');
  await page.locator('body[data-ready=true]').waitFor();
  await page.locator('#contribute-view').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#contribution-form').isVisible(), false);
  assert.match(await page.locator('#contribution-unavailable').innerText(), /投稿入口暂未开放/u);
  assert.equal(await page.locator('#contribute-view a[href^="https://github.com/"]').count(), 0);
  await assertPageFits(page);
});
test('Pages keep separate in-memory drafts for each article and general contributions', async t => {
  const site = await staticSite(t, { reviewed: true });
  const context = await site.browser.newContext();
  t.after(() => context.close());
  const page = await context.newPage();
  const [first, second] = site.data.answers;
  await page.goto(site.base + '#/contribute');
  await page.locator('body[data-ready=true]').waitFor();
  await fillContribution(page, { title: '通用投稿', content: '尚未关联文章的内容' });
  await page.goto(site.base + '#/contribute?article=' + first.id);
  await page.locator('#contribution-context').getByText(first.title, { exact: true }).waitFor();
  assert.equal(await page.locator('#contribution-title').inputValue(), '');
  assert.equal(await page.locator('#contribution-public').isChecked(), false);
  await fillContribution(page, { type: 'correction', title: '文章 A 更正', content: '只对应第一篇的更正内容' });
  await page.locator('#answers-nav').click();
  await page.goto(site.base + '#/answers/' + second.id);
  await page.getByRole('link', { name: '补充/更正这篇', exact: true }).click();
  await page.locator('#contribution-context').getByText(second.title, { exact: true }).waitFor();
  assert.equal(await page.locator('#contribution-title').inputValue(), '');
  assert.equal(await page.locator('#contribution-content').inputValue(), '');
  assert.equal(await page.locator('#contribution-type').inputValue(), 'new');
  assert.equal(await page.locator('#contribution-public').isChecked(), false);
  await fillContribution(page, { title: '文章 B 补充', content: '只对应第二篇的补充内容' });
  await page.goto(site.base + '#/contribute?article=' + first.id);
  await page.locator('#contribution-context').getByText(first.title, { exact: true }).waitFor();
  assert.equal(await page.locator('#contribution-title').inputValue(), '文章 A 更正');
  assert.equal(await page.locator('#contribution-content').inputValue(), '只对应第一篇的更正内容');
  assert.equal(await page.locator('#contribution-type').inputValue(), 'correction');
  assert.equal(await page.locator('#contribution-public').isChecked(), true);
  await page.locator('#contribute-nav').click();
  await page.locator('#contribution-context').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#contribution-title').inputValue(), '通用投稿');
  assert.equal(await page.locator('#contribution-content').inputValue(), '尚未关联文章的内容');
  assert.deepEqual(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })), { local: 0, session: 0 });
});

test('public guide distinguishes collected, approved, and demo articles on desktop and mobile', async t => {
  const site = await staticSite(t, { reviewed: true, collectedCount: 3, includeDemo: true, contributionsRepository: 'SyntheticOwner/public-guide-feedback' });
  assert.equal(site.data.mode, 'public-guide');
  const collected = site.data.answers.find(answer => answer.reviewStatus === 'collected');
  const approved = site.data.answers.find(answer => answer.reviewStatus === 'approved');
  for (const [name, viewport] of [['desktop', { width: 1440, height: 1040 }], ['mobile', { width: 390, height: 844 }]]) {
    const context = await site.browser.newContext({ viewport });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => { Date.now = () => Date.parse('2026-09-12T00:00:00Z'); });
    await page.goto(site.base + '#/answers?view=list');
    await page.locator('body[data-ready=true]').waitFor();
    assert.equal(await page.locator('#edition-label').innerText(), '公开只读指南');
    assert.equal(await page.locator('#edition-note').innerText(), '资料整理内容待人工核验 · 非学校官方信息');
    assert.equal(await page.locator('#answer-list [data-review-status=collected]').count(), 3);
    assert.equal(await page.locator('#answer-list [data-review-status=approved]').count(), 2);
    assert.equal(await page.locator('#answer-list [data-review-status=demo]').count(), 4);
    for (const item of await page.locator('#answer-list [data-review-status=collected]').all()) {
      assert.match(await item.innerText(), /资料整理 2026\/9\/10/u);
      assert.match(await item.innerText(), /待人工核验/u);
      assert.doesNotMatch(await item.innerText(), /核验 未注明|演示内容|经人工审核/u);
    }
    await page.locator('#query').fill('合成资料整理');
    assert.equal(await page.locator('#answer-list .answer-item').count(), 3);
    await assertPageFits(page);
    await page.screenshot({ path: join(screenshots, `${name}-pages-collected-reader.png`), fullPage: true });
    await page.locator('#topic').selectOption(collected.topic.id);
    assert.equal(await page.locator('#answer-list .answer-item').count(), site.data.answers.filter(answer => answer.reviewStatus === 'collected' && answer.topic?.id === collected.topic.id).length);
    await page.locator(`#answer-list a[href^="#/answers/${encodeURIComponent(collected.id)}?"]`).click();
    await page.locator('#detail-view').waitFor({ state: 'visible' });
    const text = await page.locator('#answer-detail').innerText();
    assert.match(text, /资料整理 2026\/9\/10/u);
    assert.match(text, /AI 辅助资料整理，尚未逐条人工核验/u);
    assert.doesNotMatch(text, /人工核验 未注明|经人工审核确认|演示内容/u);
    for (const sentence of collected.sentences) assert.ok(text.includes(sentence.text));
    assert.equal(await page.locator('#answer-detail .citation').count(), collected.citations.length);
    await assertPageFits(page);
    await page.screenshot({ path: join(screenshots, `${name}-pages-collected-detail.png`), fullPage: true });
    await page.reload();
    await page.locator('body[data-ready=true]').waitFor();
    assert.equal(await page.locator('#answer-detail h1').innerText(), collected.title);
    assert.match(await page.locator('#answer-detail').innerText(), /尚未逐条人工核验/u);
    await page.getByRole('link', { name: '补充/更正这篇', exact: true }).click();
    await page.locator('#contribute-view').waitFor({ state: 'visible' });
    assert.ok((await page.locator('#contribution-context').innerText()).includes(collected.title));
    assert.equal(await page.locator('#contribution-form').isVisible(), true);
    await page.goto(site.base + '#/answers/' + encodeURIComponent(approved.id));
    await page.locator('#detail-view').waitFor({ state: 'visible' });
    assert.match(await page.locator('#answer-detail').innerText(), /AI 辅助初稿，经人工审核确认/u);
    assert.match(await page.locator('#answer-detail .detail-meta').innerText(), /人工核验/u);
    assert.doesNotMatch(await page.locator('#answer-detail').innerText(), /尚未逐条人工核验/u);
    await page.locator('#about-nav').click();
    await page.locator('#about-view').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#about-content-title').innerText(), '资料整理与核验状态');
    const about = await page.locator('#about-content-description').innerText();
    assert.match(about, /尚未逐条人工核验/u);
    assert.match(about, /已经人工审核的文章会单独标注核验日期/u);
    assert.match(about, /演示文章另有明确标注/u);
    await assertPageFits(page);
    await page.screenshot({ path: join(screenshots, `${name}-pages-collected-about.png`), fullPage: true });
    assert.deepEqual(errors, []);
    await context.close();
  }
  assert.ok(site.requests.every(request => request.method === 'GET' && request.path.startsWith(basePath) && !request.path.includes('/api/')));
});

test('all 69 collected fixture articles remain searchable among 73 public answers without claiming human verification', async t => {
  const site = await staticSite(t, { reviewed: true, collectedCount: 69, onlyCollected: true, includeDemo: true });
  assert.equal(site.data.mode, 'public-guide');
  const context = await site.browser.newContext({ viewport: { width: 390, height: 844 } });
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(site.base + '#/answers?view=list');
  await page.locator('body[data-ready=true]').waitFor();
  assert.equal(await page.locator('#count').innerText(), '73 条答案');
  assert.equal(await page.locator('#answer-list [data-review-status=collected]').count(), 69);
  assert.equal(site.data.answers[0].demo, true, 'the source fixture deliberately retains its original demo-first order');
  assert.equal(await page.locator('#answer-list .answer-item').first().getAttribute('data-review-status'), 'collected');
  assert.equal(await page.locator('#answer-list .answer-item').last().getAttribute('data-review-status'), 'demo');
  const last = site.data.answers.at(-1);
  await page.locator('#query').fill(last.title);
  assert.equal(await page.locator('#answer-list .answer-item').count(), 1);
  await page.locator('#answer-list a').click();
  await page.locator('#detail-view').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#answer-detail h1').innerText(), last.title);
  assert.match(await page.locator('#answer-detail').innerText(), /尚未逐条人工核验/u);
  await page.locator('#about-nav').click();
  await page.locator('#about-view').waitFor({ state: 'visible' });
  assert.match(await page.locator('#about-content-description').innerText(), /尚未逐条人工核验/u);
  assert.doesNotMatch(await page.locator('#about-content-description').innerText(), /已经人工审核的文章/u);
  assert.equal(await page.getByText('公开只读演示', { exact: true }).count(), 0);
  await assertPageFits(page);
  assert.deepEqual(errors, []);
});

test('all three source categories appear in article cards and citations independently of AI review status', async t => {
  const site = await staticSite(t, { reviewed: true });
  const data = structuredClone(site.data);
  const answer = data.answers[0];
  answer.sourceCategories = ['university_official', 'user_provided', 'web'];
  answer.citations = answer.sourceCategories.map((sourceCategory, index) => ({
    ...answer.citations[0], id: `synthetic-category-${index}`, order: index, sourceCategory,
    title: ['学校部门公众号资料', '同学提交的个人经验', '商业公众号资料'][index],
    publisher: ['西浦某部门（合成测试）', '投稿用户（合成测试）', '商业账号（合成测试）'][index],
    url: ['https://mp.weixin.qq.com/s/synthetic-university', 'https://github.com/example/guide/issues/1', 'https://mp.weixin.qq.com/s/synthetic-commercial'][index],
  }));
  for (const viewport of [{ width: 1440, height: 1040 }, { width: 390, height: 844 }]) {
    const context = await site.browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/public.json', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) }));
    await page.goto(site.base + '#/answers?view=list');
    await page.locator('body[data-ready=true]').waitFor();
    const card = page.locator('.answer-item').filter({ has: page.getByRole('heading', { name: answer.title, exact: true }) });
    assert.deepEqual(await card.locator('.source-category').allTextContents(), ['学校官方', '用户提供', '网络资料']);
    await card.getByRole('link').click();
    await page.locator('#detail-view').waitFor({ state: 'visible' });
    assert.deepEqual(await page.locator('#answer-detail > .source-categories .source-category').allTextContents(), ['学校官方', '用户提供', '网络资料']);
    assert.deepEqual(await page.locator('.citation .source-category').allTextContents(), ['学校官方', '用户提供', '网络资料']);
    assert.match(await page.locator('#answer-detail').innerText(), /整理方式：AI 辅助初稿，经人工审核确认/u);
    assert.match(await page.locator('.citation').nth(1).innerText(), /发布方：投稿用户/u);
    await assertPageFits(page);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test('scope labels translate universal per dimension and preserve named scope codes', async t => {
  const site = await staticSite(t, { reviewed: true });
  const data = structuredClone(site.data);
  const answer = data.answers[0];
  answer.scope = { campus: ['universal'], audience: ['universal'], academic_year: ['universal'] };
  const context = await site.browser.newContext({ viewport: { width: 390, height: 844 } });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.route('**/public.json', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) }));
  await page.goto(site.base + '#/answers/' + encodeURIComponent(answer.id));
  await page.locator('body[data-ready=true]').waitFor();
  assert.equal(await page.locator('#answer-detail > p').filter({ hasText: /^适用范围：/u }).innerText(), '适用范围：两校区通用入口 · 学生通用入口 · 不限学年');
  await assertPageFits(page);
  answer.scope = { campus: ['suzhou'], audience: ['new-student'], academic_year: ['2026'] };
  await page.reload();
  await page.locator('body[data-ready=true]').waitFor();
  assert.equal(await page.locator('#answer-detail > p').filter({ hasText: /^适用范围：/u }).innerText(), '适用范围：苏州校区 · 新生 · 2026 入学届');
  answer.scope = { campus: ['universal'], audience: ['universal'], academic_year: ['universal'] };
  for (const scope of data.catalog.scopes) delete scope.code;
  await page.reload();
  await page.locator('body[data-ready=true]').waitFor();
  assert.equal(await page.locator('#answer-detail > p').filter({ hasText: /^适用范围：/u }).innerText(), '适用范围：两校区通用入口 · 学生通用入口 · 不限学年');
});
