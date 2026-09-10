import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { branchBrowserAssets } from '../../scripts/branch-assets.mjs';

const require = createRequire(process.env.PLAYWRIGHT_PACKAGE ?? import.meta.url);
const { chromium } = require('playwright');
const basePath = '/synthetic-supplements/';
const topic = { id: 'synthetic-topic', titleZh: '合成补充话题', slug: 'synthetic-topic', description: '用于浏览器验收的公开合成资料。' };
function answer(id, title, supplementTo) {
  return {
    id, slug: id, title, revisionId: `${id}-v2`, revisionNumber: 2,
    ...(supplementTo ? { supplementTo } : {}),
    topic: { id: topic.id, title: topic.titleZh, slug: topic.slug },
    summary: `${title}的说明。`, scope: { campus: ['sip'] }, warnings: [], demo: false,
    reviewStatus: id === 'supplement-middle' ? 'collected' : 'approved',
    asOf: '2026-09-10', researchedAt: '2026-09-10', verifiedAt: '2026-09-10', reviewDueAt: '2099-01-01',
    reviewOwnerLabel: '合成审核员', sourceCategories: ['user_provided'],
    sentences: [{ id: `${id}-sentence`, kind: 'fact', text: `${title}的独立正文。` }],
    citations: [{ id: `${id}-citation`, sentenceId: `${id}-sentence`, sourceCategory: 'user_provided', title: `${title}的独立来源`, url: 'https://example.org/synthetic-source', mode: 'link-only' }],
    history: [{ id: `${id}-v2`, number: 2, title }],
  };
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'guide-supplements-browser-'));
  t.after(async () => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('guide-supplements-browser-'));
    await rm(root, { recursive: true, force: true });
  });
  await cp(resolve('community/pages-ui'), root, { recursive: true });
  for (const [name, contents] of Object.entries(await branchBrowserAssets())) {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await writeFile(join(root, name), contents);
  }
  const data = {
    schemaVersion: 1, mode: 'public-guide', generatedAt: '2026-09-10T00:00:00Z',
    site: { name: '合成补充指南', publicUrl: 'https://guide.example/synthetic-supplements/', contributionsRepository: 'SyntheticOwner/public-guide-feedback' },
    catalog: { topics: [topic], scopes: [{ id: 'sip', dimension: 'campus', code: 'sip', labelZh: '苏州工业园区校区' }] },
    answers: [answer('statement-root', '原始陈述'), answer('supplement-middle', '手续细节补充', 'statement-root'), answer('supplement-leaf', 'LEAF_ONLY 后续补充', 'supplement-middle'), answer('statement-peer', '同话题其他陈述')],
    links: [],
  };
  await writeFile(join(root, 'public.json'), JSON.stringify(data));
  await writeFile(join(root, 'community-topics.json'), JSON.stringify({ schemaVersion: 1, topics: [{
    id: 'synthetic-supplement-question', catalogTopicId: topic.id, title: '合成补充讨论',
    prompt: '补充这组合成陈述的信息。', kind: 'question', editorial: true,
  }] }));
  const assets = new Map();
  for (const name of ['index.html', 'app.js', 'contributions.js', 'topic-model.js', 'discussions.js', 'search.js', 'community.js', 'community-topics.json', 'style.css', 'brand.svg', 'public.json', 'branches.js', 'branch-model.js', 'branches.css', 'core/index.js', 'core/branches.js']) {
    const type = name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.json') ? 'application/json' : name.endsWith('.svg') ? 'image/svg+xml' : 'text/html';
    assets.set(basePath + (name === 'index.html' ? '' : name), { body: await readFile(join(root, name)), type });
  }
  const server = createServer((request, response) => {
    const asset = request.method === 'GET' && assets.get(new URL(request.url, 'http://fixture.test').pathname);
    response.writeHead(asset ? 200 : 404, { 'Content-Type': asset?.type ?? 'text/plain', 'Cache-Control': 'no-store' });
    response.end(asset?.body);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const channel = process.env.PLAYWRIGHT_CHANNEL ?? (process.env.CI ? 'chromium' : 'msedge');
  const browser = await chromium.launch({ headless: true, ...(channel === 'chromium' ? {} : { channel }) });
  t.after(() => browser.close());
  return { data, browser, base: `http://127.0.0.1:${server.address().port}${basePath}` };
}

test('Pages retain supplement ancestors in search, navigate parents and show nested branches on desktop and mobile', async t => {
  const site = await fixture(t);
  for (const viewport of [{ width: 1440, height: 1040 }, { width: 390, height: 844 }]) {
    const context = await site.browser.newContext({ viewport });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(site.base + '#/answers?view=branches&query=LEAF_ONLY');
    await page.locator('body[data-ready=true]').waitFor();
    const diagram = page.locator('#directory-branches');
    await diagram.locator('[data-answer-id="supplement-leaf"]').waitFor();
    assert.equal(await page.locator('#count').innerText(), '1 条答案');
    assert.equal(await diagram.locator('.guide-branch-answer').count(), 3);
    assert.equal(await diagram.locator('[data-answer-id="statement-peer"]').count(), 0);
    assert.equal(await diagram.locator('[data-answer-id="statement-root"]').getAttribute('data-branch-context'), 'true');
    assert.equal(await diagram.locator('[data-answer-id="supplement-middle"]').getAttribute('data-branch-context'), 'true');
    assert.notEqual(await diagram.locator('[data-answer-id="supplement-leaf"]').getAttribute('data-branch-context'), 'true');
    assert.equal(await diagram.locator('[data-branch-node="answer:statement-root"] > .guide-branch-children > [data-branch-node="answer:supplement-middle"] > .guide-branch-children > [data-branch-node="answer:supplement-leaf"]').count(), 1);
    assert.match(await diagram.locator('[data-answer-id="supplement-middle"]').innerText(), /待人工核验/u);
    await page.locator('#list-mode').click();
    assert.equal(await page.locator('#answer-list .answer-item').count(), 1);
    assert.match(await page.locator('#answer-list').innerText(), /LEAF_ONLY/u);
    await page.locator('#branches-mode').click();
    await diagram.locator('[data-answer-id="supplement-leaf"] h3 a').click();
    await page.locator('#detail-view').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#answer-detail .supplement-parent a').innerText(), '手续细节补充');
    assert.match(await page.locator('#answer-branches .guide-branch-path').innerText(), /原始陈述.*手续细节补充.*LEAF_ONLY/u);
    assert.equal(await page.locator('#answer-branches .guide-branch-answer.is-current').getAttribute('data-answer-id'), 'supplement-leaf');
    const screenshots = resolve(process.env.GUIDE_SCREENSHOTS ?? 'community/.browser-qa');
    await mkdir(screenshots, { recursive: true });
    await page.screenshot({ path: join(screenshots, `${viewport.width < 720 ? 'mobile' : 'desktop'}-supplement-detail.png`), fullPage: true });
    await page.locator('#answer-detail .supplement-parent a').click();
    await page.locator('#answer-detail h1').filter({ hasText: '手续细节补充' }).waitFor();
    assert.equal(await page.locator('#answer-detail .supplement-parent a').innerText(), '原始陈述');
    await page.locator('#answer-detail .supplement-parent a').click();
    await page.locator('#answer-detail h1').filter({ hasText: '原始陈述' }).waitFor();
    await page.locator('#answer-branches [data-answer-id="supplement-middle"]').waitFor();
    assert.equal(await page.locator('#answer-detail .supplement-parent').count(), 0);
    const collapse = page.locator('#answer-branches').getByRole('button', { name: '收起补充：原始陈述', exact: true });
    await collapse.focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#answer-branches [data-answer-id="supplement-middle"]').count(), 0);
    const expand = page.locator('#answer-branches').getByRole('button', { name: '展开补充：原始陈述', exact: true });
    assert.equal(await expand.getAttribute('aria-expanded'), 'false');
    await page.keyboard.press('Enter');
    await page.locator('#answer-branches [data-answer-id="supplement-middle"]').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test('supplement contribution links bind the current public parent and only prepare a GitHub draft', async t => {
  const site = await fixture(t);
  const context = await site.browser.newContext({ viewport: { width: 390, height: 844 } });
  const requests = [];
  await context.route('https://github.com/**', async route => {
    requests.push({ url: route.request().url(), method: route.request().method() });
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Synthetic GitHub Form</title>' });
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(site.base + '#/answers/supplement-middle');
  await page.locator('body[data-ready=true]').waitFor();
  const link = page.locator('#answer-branches [data-answer-id="supplement-middle"]').getByRole('link', { name: '补充这条信息', exact: true });
  const href = await link.getAttribute('href');
  const parameters = new URLSearchParams(href.split('?')[1]);
  assert.deepEqual(Object.fromEntries(parameters), { article: 'supplement-middle', revision: 'supplement-middle-v2', type: 'supplement' });
  await link.click();
  await page.locator('#contribute-view').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#contribution-type').inputValue(), 'supplement');
  assert.match(await page.locator('#contribution-type-description').innerText(), /下级分支/u);
  for (const [field, value] of Object.entries({ title: '补充细节', content: '可公开的合成补充内容。', source: 'https://example.org/synthetic-evidence', audience: '本科新生', time: '2026 年 9 月', ai: '未使用' })) {
    await page.locator(`#contribution-${field}`).fill(value);
  }
  await page.locator('#contribution-campus').selectOption('苏州工业园区校区');
  await page.locator('#contribution-public').check();
  const popupPromise = context.waitForEvent('page');
  await page.locator('#contribution-submit').click();
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');
  const body = new URL(popup.url()).searchParams.get('body');
  assert.match(body, /补充父陈述 ID：supplement-middle\n父陈述公开版本：supplement-middle-v2/u);
  assert.match(body, /作为其下级分支/u);
  assert.match(body, /https:\/\/guide\.example\/synthetic-supplements\/#\/answers\/supplement-middle/u);
  assert.ok(requests.length > 0 && requests.every(request => request.method === 'GET'));
  assert.match(await page.locator('#contribution-status').innerText(), /尚未创建 Issue/u);
  await popup.close();
  await page.goto(site.base + '#/contribute?article=supplement-middle&revision=forged-private-version&type=supplement');
  await page.locator('#contribution-context').getByText('这篇文章已更新，将引用当前公开版本。', { exact: true }).waitFor();
  assert.equal(await page.locator('#contribution-type').inputValue(), 'supplement');
  assert.doesNotMatch(await page.locator('#contribution-context').innerText(), /forged-private-version/u);
  await page.goto(site.base + '#/contribute?article=private-missing&type=supplement');
  await page.locator('#contribution-context').getByText('未找到关联的公开文章，可按通用投稿继续补充。', { exact: true }).waitFor();
  assert.equal(await page.locator('#contribution-type option[value=supplement]').evaluate(option => option.disabled), true);
  assert.equal(await page.locator('#contribution-type').inputValue(), 'new');
  assert.equal(await page.locator('#contribution-supplement-help').isVisible(), true);
  await page.goto(site.base + '#/contribute');
  await page.locator('#contribution-context').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#contribution-type option[value=supplement]').evaluate(option => option.disabled), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  await context.close();
});
