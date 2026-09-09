import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { buildPages } from '../../scripts/build-pages.mjs';

const require = createRequire(process.env.PLAYWRIGHT_PACKAGE ?? import.meta.url);
const { chromium } = require('playwright');
const basePath = '/xjtlu-unofficial-guide/';
const screenshots = resolve(process.env.GUIDE_SCREENSHOTS ?? 'community/.browser-qa');

async function staticSite(t) {
  const { output } = await buildPages({ root: resolve('.'), basePath, now: '2026-09-10T00:00:00Z' });
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
