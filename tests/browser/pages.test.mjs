import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildPages } from '../../scripts/build-pages.mjs';
import { pagesContentHash } from '../../scripts/pages-snapshot.mjs';

const require = createRequire(process.env.PLAYWRIGHT_PACKAGE ?? import.meta.url);
const { chromium } = require('playwright');
const basePath = '/xjtlu-unofficial-guide/';
const screenshots = resolve(process.env.GUIDE_SCREENSHOTS ?? 'community/.browser-qa');

function reviewedFixture(demo, { empty = false, onlyDemo = false, includeDemo = false } = {}) {
  const snapshot = {
    ...structuredClone(demo), mode: 'public-reviewed', answers: [],
  };
  if (!empty && !onlyDemo) {
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
  snapshot.contentHash = pagesContentHash(snapshot);
  return snapshot;
}

async function staticSite(t, { reviewed = false, empty = false, onlyDemo = false, includeDemo = false } = {}) {
  // Never consume or replace the operator's exported snapshot or build directory.
  const root = await mkdtemp(join(tmpdir(), 'guide-pages-browser-'));
  t.after(async () => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('guide-pages-browser-'));
    await rm(root, { recursive: true, force: true });
  });
  const community = join(root, 'community');
  await mkdir(community);
  await Promise.all([
    ...['pages.config.json', 'content-profile.json', 'content.json', 'catalog.json'].map(name => copyFile(resolve('community', name), join(community, name))),
    cp(resolve('community/pages-ui'), join(community, 'pages-ui'), { recursive: true }),
  ]);
  const { output } = await buildPages({ root, basePath, now: '2026-09-10T00:00:00Z' });
  if (reviewed) {
    const demo = JSON.parse(await readFile(join(output, 'public.json'), 'utf8'));
    await writeFile(join(community, 'pages-reviewed.json'), JSON.stringify(reviewedFixture(demo, { empty, onlyDemo, includeDemo })));
    await buildPages({ root, basePath });
  }
  const assets = new Map();
  for (const [name, type] of [
    ['index.html', 'text/html; charset=utf-8'], ['app.js', 'text/javascript; charset=utf-8'],
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
    await page.goto(site.base);
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
    await page.locator(`#answer-list a[href="#/answers/${encodeURIComponent(first.id)}"]`).click();
    await page.locator('#detail-view').waitFor({ state: 'visible' });
    assert.equal(new URL(page.url()).pathname, basePath);
    assert.equal(new URL(page.url()).hash, '#/answers/' + encodeURIComponent(first.id));
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
  await page.goto(site.base);
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
    await page.goto(site.base);
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
  await page.goto(site.base);
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
    await page.goto(site.base);
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
