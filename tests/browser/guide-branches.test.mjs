import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { buildRuntime, importContent, loadRuntimeConfig, publishContent } from '@information-community/runtime';
import { communityRoot, harness, loadDemoContent, readJson } from '../helpers.mjs';

const require = createRequire(process.env.PLAYWRIGHT_PACKAGE ?? import.meta.url);
const { chromium } = require('playwright');
const firstId = 'card-ebridge-entry', peerId = 'card-learning-mall-help';

test('local reader branches preserve independent topic statements, search context and historical versions', async t => {
  // Runtime builds are isolated from community/dist and other browser suites.
  const output = await mkdtemp(join(communityRoot, '.branch-browser-'));
  t.after(async () => {
    assert.equal(dirname(resolve(output)), resolve(communityRoot));
    assert.ok(basename(output).startsWith('.branch-browser-'));
    await rm(output, { recursive: true, force: true });
  });
  const loaded = await loadRuntimeConfig({ root: communityRoot });
  const { assets } = await buildRuntime({ ...loaded, output });
  assets['/'] = assets['/extensions/index.html'];
  const fixture = await loadDemoContent();
  for (const revision of fixture.revisions) {
    if (revision.data.sentences) {
      revision.data.title = `合成陈述 ${revision.entityId}`;
      revision.data.summary = '用于浏览器验收的合成陈述。';
      revision.data.sentences = [{ id: 's1', kind: 'fact', text: '这是用于测试的合成内容。' }];
      revision.data.searchText = revision.entityId;
    } else {
      revision.data.title = '合成来源';
      revision.data.url = 'https://example.org/synthetic-branch-source';
    }
  }
  const previous = fixture.revisions.find(row => row.entityId === firstId);
  previous.data.title = 'SYNTHETIC_BRANCH_ALPHA 历史陈述';
  previous.data.searchText = 'SYNTHETIC_BRANCH_ALPHA';
  fixture.revisions.find(row => row.entityId === peerId).data.title = 'SYNTHETIC_BRANCH_BETA 并列陈述';
  fixture.links = [{ id: 'synthetic-browser-relation', from: firstId, to: peerId, reason: '合成关联理由：比较两种适用场景。' }];
  const h = await harness(t, { guide: true, assets, includeDemo: false, mutateBundle(bundle) {
    for (const name of ['entities', 'revisions', 'citations', 'links']) bundle[name] = structuredClone(fixture[name]);
  } });
  h.publish();
  const current = structuredClone(previous);
  Object.assign(current, { id: 'synthetic-branch-current-v2', number: 2, parentRevisionId: previous.id });
  current.data.title = 'SYNTHETIC_BRANCH_ALPHA 当前陈述';
  const citations = fixture.citations.filter(row => row.revisionId === previous.id).map((row, index) => ({
    ...structuredClone(row), id: `synthetic-browser-v2-citation-${index}`, revisionId: current.id,
  }));
  h.store.transact(state => {
    state.modules.content = importContent(state.modules.content, { schemaVersion: 1, entities: [], revisions: [current], citations, links: [] });
    const entity = state.modules.content.entities.find(row => row.id === firstId);
    state.modules.content = publishContent(state.modules.content, {
      entityId: firstId, revisionId: current.id, expectedVersion: entity.version, now: new Date(h.time()).toISOString(),
    });
  });
  const publicGraph = await readJson(await h.get('/api/guide/branches'));
  const first = publicGraph.answers.find(answer => answer.id === firstId);
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  t.after(() => browser.close());
  for (const viewport of [{ width: 1440, height: 1040 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage(), errors = [];
    let documents = 0;
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.resourceType() === 'document') documents++; });
    await page.goto(h.base);
    const diagram = page.locator('#answer-branches');
    const topic = diagram.getByRole('button', { name: `展开话题：${first.topic.title}`, exact: true });
    await topic.waitFor();
    assert.equal(await page.locator('#branches-view').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#answer-list').isVisible(), false);
    assert.equal(await diagram.locator('.guide-branch-answer').count(), 0);
    await topic.focus();
    await page.keyboard.press('Enter');
    await diagram.locator(`[data-answer-id="${peerId}"]`).waitFor();
    assert.equal(await diagram.locator('.guide-branch-answer').count(), 2);
    assert.equal(await diagram.locator('.guide-branch-answer.is-current').count(), 0);
    await diagram.getByRole('button', { name: `收起话题：${first.topic.title}`, exact: true }).click();
    assert.equal(await diagram.locator('.guide-branch-answer').count(), 0);
    await page.locator('#search [name=query]').fill('SYNTHETIC_BRANCH_ALPHA');
    const searched = page.waitForResponse(response => response.url().includes('/api/guide/branches?q=SYNTHETIC_BRANCH_ALPHA'));
    await page.locator('#search button').click();
    await searched;
    await diagram.locator(`[data-answer-id="${firstId}"]`).waitFor();
    assert.equal(await diagram.locator('.guide-branch-answer').count(), 1);
    await diagram.locator(`[data-answer-id="${firstId}"] h3 a`).click();
    await page.locator('#detail').waitFor({ state: 'visible' });
    const detail = page.locator('#answer-detail');
    await detail.locator(`[data-answer-id="${peerId}"]`).waitFor();
    assert.equal(await detail.locator('.guide-branch-answer').count(), 2, 'detail includes the same-topic peer excluded by directory search');
    assert.equal(await detail.locator('.guide-branch-answer.is-current').getAttribute('data-answer-id'), firstId);
    assert.equal(await detail.locator('a[aria-current="true"]').innerText(), current.data.title);
    assert.equal(documents, 1, 'branch links use the local SPA route');
    await detail.locator('.guide-branch-related summary').click();
    await detail.getByText('关联理由：合成关联理由：比较两种适用场景。', { exact: true }).waitFor();
    await detail.locator('.guide-branch-locate').click();
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-current')), 'true');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await detail.locator('.history a').filter({ hasText: '第 1 版' }).click();
    await detail.locator('h1').filter({ hasText: previous.data.title }).waitFor();
    await detail.getByText('正在阅读历史修订。分支图展示各条陈述的当前公开版本。', { exact: true }).waitFor();
    assert.equal(await detail.locator('.guide-branch-answer.is-current').count(), 0, 'a historical revision is not highlighted as the current statement');
    await detail.locator(`[data-answer-id="${firstId}"] h3 a`).click();
    await detail.locator('h1').filter({ hasText: current.data.title }).waitFor();
    await detail.locator('.guide-branch-answer.is-current').waitFor();
    assert.equal(new URL(page.url()).search, '', 'reading the current branch clears the historical revision parameter');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    await context.close();
  }
});
