import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(process.env.PLAYWRIGHT_PACKAGE ?? import.meta.url);
const { chromium } = require('playwright');
const repository = 'SyntheticOwner/public-guide-feedback';
const baseOptions = {
  snapshot: { site: { contributionsRepository: repository, publicUrl: 'https://guide.example/' } },
  topic: { id: 'synthetic-first-course', catalogTopicId: 'topic-study', title: '合成测试：课程提醒' },
};

async function fixture(t) {
  const files = new Map([
    ['/contributions.js', { type: 'text/javascript', body: await readFile(new URL('../../community/pages-ui/contributions.js', import.meta.url)) }],
    ['/style.css', { type: 'text/css', body: await readFile(new URL('../../community/pages-ui/style.css', import.meta.url)) }],
    ['/', { type: 'text/html', body: `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><title>合成分享测试</title><main><div id="composer"></div></main><script type="module">
      import { mountQuickContribution } from '/contributions.js';
      window.statuses = [];
      window.mountTest = (options = ${JSON.stringify(baseOptions)}) => {
        window.currentComposer?.destroy();
        window.currentComposer = mountQuickContribution(document.getElementById('composer'), { ...options, onStatus: value => window.statuses.push(value) });
      };
      window.mountTest();
      document.body.dataset.ready = 'true';
    </script></html>` }],
  ]);
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method, url: request.url });
    const file = request.method === 'GET' && files.get(new URL(request.url, 'http://fixture.test').pathname);
    response.writeHead(file ? 200 : 404, { 'Content-Type': file?.type || 'text/plain', 'Cache-Control': 'no-store' });
    response.end(file?.body);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const channel = process.env.PLAYWRIGHT_CHANNEL ?? (process.env.CI ? 'chromium' : 'msedge');
  const browser = await chromium.launch({ headless: true, ...(channel === 'chromium' ? {} : { channel }) });
  t.after(() => browser.close());
  return { browser, requests, base: `http://127.0.0.1:${server.address().port}/` };
}

async function mount(page, changes = {}) {
  await page.evaluate(options => window.mountTest(options), { ...baseOptions, ...changes });
}

async function noSubmissionClaim(page) {
  assert.match(await page.locator('.quick-status').innerText(), /尚未提交/u);
  assert.deepEqual(await page.evaluate(() => [...new Set(window.statuses.map(value => value.state))]), ['unsubmitted']);
}

test('quick sharing on desktop and mobile accepts a short experience and only opens a reviewable GitHub draft', async t => {
  const site = await fixture(t);
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const context = await site.browser.newContext({ viewport });
    const external = [];
    await context.route('https://github.com/**', async route => {
      external.push({ method: route.request().method(), url: route.request().url() });
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Synthetic GitHub review page</title>' });
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(site.base);
    await page.locator('body[data-ready=true]').waitFor();
    assert.equal(await page.locator('.quick-background').getAttribute('open'), null);
    assert.equal(await page.getByRole('checkbox').isChecked(), false);
    await page.getByRole('button', { name: '准备分享，前往 GitHub 确认' }).click();
    assert.equal(await page.locator('.quick-result').isVisible(), false);
    await page.getByLabel('你想分享什么？').fill('课程的小提醒，不附官方证明。📚');
    await page.getByRole('button', { name: '准备分享，前往 GitHub 确认' }).click();
    assert.equal(await page.locator('.quick-result').isVisible(), false);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: '准备分享，前往 GitHub 确认' }).click();
    assert.equal(external.length, 0);
    const link = page.getByRole('link', { name: '前往 GitHub，核对并提交', exact: true });
    const url = new URL(await link.getAttribute('href'));
    assert.match(url.searchParams.get('body'), /<!-- xjtlu-topic:synthetic-first-course -->/u);
    assert.ok(url.searchParams.get('body').includes('课程的小提醒，不附官方证明。📚'));
    const popupPromise = context.waitForEvent('page');
    await link.click();
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    assert.equal(external.length, 1);
    assert.ok(external.every(request => request.method === 'GET'));
    await noSubmissionClaim(page);
    await page.getByLabel('你想分享什么？').fill('修改以后要重新准备');
    assert.equal(await page.locator('.quick-result').isVisible(), false);
    assert.equal(await page.evaluate(() => localStorage.length), 0);
    assert.deepEqual(errors, []);
    await context.close();
  }
  assert.ok(site.requests.every(request => request.method === 'GET'));
});

test('drafts remain isolated by topic, article and reply, and device persistence is explicit with fresh consent after reload', async t => {
  const site = await fixture(t);
  const context = await site.browser.newContext();
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(site.base);
  await page.locator('body[data-ready=true]').waitFor();
  await page.getByLabel('你想分享什么？').fill('主话题草稿');
  await page.getByRole('checkbox').check();
  await mount(page, { topic: { ...baseOptions.topic, id: 'another-topic' } });
  assert.equal(await page.getByLabel('你想分享什么？').inputValue(), '');
  await page.getByLabel('你想分享什么？').fill('另一个话题');
  await mount(page, { article: { id: 'article-a', title: '文章 A', revisionId: 'article-a-v1' } });
  assert.equal(await page.getByLabel('你想分享什么？').inputValue(), '');
  await page.getByLabel('你想分享什么？').fill('文章 A 草稿');
  await mount(page, { article: { id: 'article-b', title: '文章 B', revisionId: 'article-b-v1' } });
  assert.equal(await page.getByLabel('你想分享什么？').inputValue(), '');
  await mount(page, { reply: { number: 1, id: 'reply-a' } });
  await page.getByLabel('你的回复').fill('回复 A');
  await mount(page, { reply: { number: 1, id: 'reply-b' } });
  assert.equal(await page.getByLabel('你的回复').inputValue(), '');
  await mount(page, { reply: { number: 1, id: 'reply-a' } });
  assert.equal(await page.getByLabel('你的回复').inputValue(), '回复 A');
  await mount(page, { article: { id: 'article-a', title: '文章 A', revisionId: 'article-a-v1' } });
  assert.equal(await page.getByLabel('你想分享什么？').inputValue(), '文章 A 草稿');
  await mount(page);
  assert.equal(await page.getByLabel('你想分享什么？').inputValue(), '主话题草稿');
  assert.equal(await page.getByRole('checkbox').isChecked(), false);
  assert.equal(await page.evaluate(() => localStorage.length), 0);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '保存到本机', exact: true }).click();
  const saved = await page.evaluate(() => Object.values(localStorage));
  assert.equal(saved.length, 1);
  assert.doesNotMatch(saved[0], /"public"/u);
  await page.getByLabel('你想分享什么？').fill('尚未再次保存的修改');
  await page.getByRole('button', { name: '恢复本机草稿', exact: true }).click();
  assert.equal(await page.getByLabel('你想分享什么？').inputValue(), '主话题草稿');
  await page.getByRole('checkbox').check();
  await page.getByLabel('你想分享什么？').fill('又一份未保存的修改');
  await page.reload();
  await page.locator('body[data-ready=true]').waitFor();
  assert.equal(await page.getByLabel('你想分享什么？').inputValue(), '主话题草稿');
  assert.equal(await page.getByRole('checkbox').isChecked(), false);
  await page.getByRole('button', { name: '清除这份草稿', exact: true }).click();
  assert.equal(await page.getByLabel('你想分享什么？').inputValue(), '');
  assert.equal(await page.evaluate(() => localStorage.length), 0);
  await page.reload();
  await page.locator('body[data-ready=true]').waitFor();
  assert.equal(await page.getByLabel('你想分享什么？').inputValue(), '');
});

test('blocked or corrupt local storage never prevents writing or silently discards the current input', async t => {
  const site = await fixture(t);
  const context = await site.browser.newContext();
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    for (const method of ['getItem', 'setItem', 'removeItem']) Storage.prototype[method] = () => { throw new DOMException('Blocked', 'SecurityError'); };
  });
  await page.goto(site.base);
  await page.locator('body[data-ready=true]').waitFor();
  await page.getByLabel('你想分享什么？').fill('浏览器不允许存储也能继续写');
  await page.getByRole('button', { name: '保存到本机', exact: true }).click();
  assert.match(await page.locator('.quick-status').innerText(), /不允许保存到本机/u);
  await page.getByRole('button', { name: '恢复本机草稿', exact: true }).click();
  assert.equal(await page.getByLabel('你想分享什么？').inputValue(), '浏览器不允许存储也能继续写');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '准备分享，前往 GitHub 确认' }).click();
  assert.equal(await page.locator('.quick-result').isVisible(), true);
  await noSubmissionClaim(page);
  assert.deepEqual(errors, []);
  const other = await site.browser.newContext();
  t.after(() => other.close());
  const corrupt = await other.newPage();
  await corrupt.goto(site.base);
  await corrupt.locator('body[data-ready=true]').waitFor();
  await corrupt.getByLabel('你想分享什么？').fill('保存一次以获得真实分区');
  await corrupt.getByRole('button', { name: '保存到本机', exact: true }).click();
  await corrupt.evaluate(() => localStorage.setItem(localStorage.key(0), '{broken'));
  await corrupt.reload();
  await corrupt.locator('body[data-ready=true]').waitFor();
  assert.match(await corrupt.locator('.quick-status').innerText(), /无法读取本机草稿/u);
  await corrupt.getByLabel('你想分享什么？').fill('新输入保持可用');
  await corrupt.getByRole('button', { name: '恢复本机草稿', exact: true }).click();
  assert.equal(await corrupt.getByLabel('你想分享什么？').inputValue(), '新输入保持可用');
});

test('replying requires copying and pasting into the original issue, with a complete manual-copy fallback', async t => {
  const site = await fixture(t);
  const context = await site.browser.newContext();
  t.after(() => context.close());
  const external = [];
  await context.route('https://github.com/**', async route => {
    external.push({ method: route.request().method(), url: route.request().url() });
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Synthetic original issue</title>' });
  });
  const page = await context.newPage();
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Clipboard blocked'); } } }));
  await page.goto(site.base);
  await page.locator('body[data-ready=true]').waitFor();
  const reply = { number: 12, id: 'comment-123', author: '<img src=x onerror=alert(1)>', url: `https://github.com/${repository}/issues/12#issuecomment-123` };
  await mount(page, { reply });
  const content = '完整回复，不截断。\n'.repeat(1500);
  await page.getByLabel('你的回复').fill(content);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '准备回复，前往 GitHub 确认' }).click();
  assert.equal(await page.locator('.quick-contribution img').count(), 0);
  assert.match(await page.locator('.quick-result').innerText(), /粘贴到评论框并提交/u);
  const full = await page.getByLabel('完整回复', { exact: true }).inputValue();
  assert.ok(full.includes(content.trim()));
  await page.getByRole('button', { name: '复制完整回复', exact: true }).click();
  assert.match(await page.locator('.quick-status').innerText(), /无法自动复制/u);
  assert.equal(await page.getByLabel('完整回复', { exact: true }).evaluate(element => element.selectionEnd - element.selectionStart), full.length);
  const link = page.getByRole('link', { name: '前往原讨论，粘贴回复并确认', exact: true });
  assert.equal(await link.getAttribute('href'), reply.url);
  assert.equal(new URL(await link.getAttribute('href')).search, '');
  const popupPromise = context.waitForEvent('page');
  await link.click();
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');
  assert.ok(external.length === 1 && external.every(request => request.method === 'GET'));
  await noSubmissionClaim(page);
});

test('long share titles and body remain complete, and successful copying still reports unsubmitted', async t => {
  const site = await fixture(t);
  const context = await site.browser.newContext();
  t.after(() => context.close());
  const page = await context.newPage();
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.copiedText = text; } } }));
  await page.goto(site.base);
  await page.locator('body[data-ready=true]').waitFor();
  const content = '长篇正文保留全部内容。\n'.repeat(1000), title = '很长的完整标题'.repeat(500);
  await page.getByLabel('你想分享什么？').fill(content);
  await page.locator('.quick-background summary').click();
  await page.getByLabel('标题', { exact: true }).fill(title);
  await page.getByLabel('来源性质', { exact: true }).selectOption('本人亲历');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '准备分享，前往 GitHub 确认' }).click();
  assert.equal(await page.getByLabel('完整标题', { exact: true }).inputValue(), title);
  assert.ok((await page.getByLabel('完整正文', { exact: true }).inputValue()).includes(content.trim()));
  const link = new URL(await page.locator('.quick-result a').getAttribute('href'));
  assert.equal(link.searchParams.has('body'), false);
  assert.equal(link.searchParams.has('title'), false);
  await page.getByRole('button', { name: '复制完整正文', exact: true }).click();
  assert.equal(await page.evaluate(() => window.copiedText), await page.getByLabel('完整正文', { exact: true }).inputValue());
  await noSubmissionClaim(page);
});
