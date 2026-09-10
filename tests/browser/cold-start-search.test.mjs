import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildPages } from '../../scripts/build-pages.mjs';

const require = createRequire(process.env.PLAYWRIGHT_PACKAGE ?? import.meta.url);
const { chromium } = require('playwright');
let site;

test.before(async () => {
  const { output, answerCount } = await buildPages();
  const names = ['index.html', 'app.js', 'contributions.js', 'topic-model.js', 'discussions.js', 'search.js', 'community.js',
    'community-topics.json', 'style.css', 'brand.svg', 'public.json', 'branches.js', 'branch-model.js', 'branches.css',
    'core/index.js', 'core/branches.js'];
  const assets = new Map();
  for (const name of names) assets.set('/' + (name === 'index.html' ? '' : name), {
    body: await readFile(resolve(output, name)),
    type: name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css'
      : name.endsWith('.json') ? 'application/json' : name.endsWith('.svg') ? 'image/svg+xml' : 'text/html',
  });
  const server = createServer((request, response) => {
    const asset = request.method === 'GET' && assets.get(new URL(request.url, 'http://fixture.test').pathname);
    response.writeHead(asset ? 200 : 404, { 'Content-Type': `${asset?.type ?? 'text/plain'}; charset=utf-8` });
    response.end(asset?.body);
  });
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
  const channel = process.env.PLAYWRIGHT_CHANNEL ?? (process.env.CI ? 'chromium' : 'msedge');
  const browser = await chromium.launch({ headless: true, ...(channel === 'chromium' ? {} : { channel }) });
  site = { server, browser, base: `http://127.0.0.1:${server.address().port}/`, answerCount };
});

test.after(async () => {
  if (!site) return;
  await site.browser.close();
  site.server.closeAllConnections();
  await new Promise(accept => site.server.close(accept));
});

test('home search finds source collections separately across directory views and topic filters', async t => {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const context = await site.browser.newContext({ viewport });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [], forbidden = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (request.method() === 'GET' && url.origin === new URL(site.base).origin) return route.continue();
      if (request.method() === 'GET' && url.origin === 'https://api.github.com') {
        return route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '[]' });
      }
      forbidden.push(request.url());
      return route.abort();
    });
    t.after(async () => { await context.close(); assert.deepEqual(errors, []); assert.deepEqual(forbidden, []); });
    await page.goto(site.base + '#/discover');
    await page.locator('body[data-ready="true"]').waitFor();
    await page.locator('#home-query').fill('双选会');
    await page.locator('.home-search button').click();
    const result = page.locator('#collection-results .collection-result');
    await result.waitFor();
    assert.equal(await page.locator('#count').innerText(), '0 条答案');
    assert.equal(await page.locator('#answer-list .answer-item').count(), 0);
    assert.equal(await page.locator('#collection-results h2').innerText(), '来源整理');
    assert.equal(await result.count(), 1);
    const link = result.locator('h3 a');
    assert.equal(await link.getAttribute('href'), '#/topics/collected-ibss-job-fair-20261021');
    await link.click();
    await page.locator('#topic-view').waitFor({ state: 'visible' });
    assert.match(await page.locator('#community-topic h1').innerText(), /双选会/u);
    await page.locator('#answers-nav').click();
    await page.locator('#answers-view').waitFor({ state: 'visible' });
    await page.locator('#branches-mode').click();
    assert.equal(await result.count(), 1);
    assert.equal(await page.locator('#collection-results').isVisible(), true);
    await page.locator('#topic').selectOption('topic-library');
    assert.equal(await page.locator('#collection-results').isVisible(), false);
    await page.locator('#topic').selectOption('topic-careers');
    assert.equal(await result.count(), 1);
    await page.locator('#topic').selectOption('');
    await page.locator('#query').fill('数据库导航');
    assert.equal(await result.locator('h3 a').getAttribute('href'), '#/topics/collected-library-libai-migration');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.locator('#query').fill('');
    await page.locator('#list-mode').click();
    assert.equal(await page.locator('#collection-results').isVisible(), false);
    assert.equal(await page.locator('#count').innerText(), `${site.answerCount} 条答案`);
    assert.equal(await page.locator('#answer-list .answer-item').count(), site.answerCount);
  }
});
