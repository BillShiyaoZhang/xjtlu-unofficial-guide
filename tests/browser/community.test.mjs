import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildPages } from '../../scripts/build-pages.mjs';

const require = createRequire(process.env.PLAYWRIGHT_PACKAGE ?? import.meta.url);
const { chromium } = require('playwright');
const repository = 'SyntheticOwner/public-guide-feedback';
const basePath = '/community-browser-fixture/';
const fixedNow = '2026-09-10T02:00:00.000Z';
let site;

test.before(async () => {
  // Real application assets; synthetic content is supplied only by browser routes.
  const { output } = await buildPages();
  const names = ['index.html', 'app.js', 'contributions.js', 'topic-model.js', 'discussions.js', 'search.js', 'community.js',
    'community-topics.json', 'style.css', 'brand.svg', 'public.json', 'branches.js', 'branch-model.js', 'branches.css',
    'core/index.js', 'core/branches.js'];
  const assets = new Map();
  for (const name of names) {
    const type = name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css'
      : name.endsWith('.json') ? 'application/json' : name.endsWith('.svg') ? 'image/svg+xml' : 'text/html';
    assets.set(basePath + (name === 'index.html' ? '' : name), { body: await readFile(resolve(output, name)), type });
  }
  const server = createServer((request, response) => {
    const asset = request.method === 'GET' && assets.get(new URL(request.url, 'http://fixture.test').pathname);
    response.writeHead(asset ? 200 : 404, { 'Content-Type': `${asset?.type ?? 'text/plain'}; charset=utf-8`, 'Cache-Control': 'no-store' });
    response.end(asset?.body);
  });
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
  const channel = process.env.PLAYWRIGHT_CHANNEL ?? (process.env.CI ? 'chromium' : 'msedge');
  const browser = await chromium.launch({ headless: true, ...(channel === 'chromium' ? {} : { channel }) });
  site = { server, browser, base: `http://127.0.0.1:${server.address().port}${basePath}`,
    data: JSON.parse(assets.get(basePath + 'public.json').body.toString('utf8')),
    config: JSON.parse(assets.get(basePath + 'community-topics.json').body.toString('utf8')) };
});

test.after(async () => {
  if (!site) return;
  await site.browser.close();
  site.server.closeAllConnections();
  await new Promise(accept => site.server.close(accept));
});

function issue(number, topicId, changes = {}) {
  return { number, title: `合成投稿 ${number}`, body: `<!-- xjtlu-topic:${topicId} -->\n\n这是一段仅供浏览器测试的经历。`,
    state: 'open', html_url: `https://github.com/${repository}/issues/${number}`, user: { login: `synthetic-reader-${number}` },
    comments: 0, created_at: '2026-09-08T03:00:00Z', updated_at: '2026-09-09T03:00:00Z', ...changes };
}

function summary(id, title, sourceUrl, catalogTopicId = 'topic-study') {
  const answer = structuredClone(site.data.answers.find(row => row.topic.id === catalogTopicId));
  Object.assign(answer, { id, slug: id, title, revisionId: `${id}-v1`, revisionNumber: 1, summary: `${title}的合成正文。`,
    sentences: [{ id: `${id}-sentence`, kind: 'fact', text: `${title}引用了下面的公开合成投稿。` }],
    sourceCategories: ['user_provided'], history: [{ id: `${id}-v1`, number: 1, title }],
    citations: [{ id: `${id}-citation`, sentenceId: `${id}-sentence`, sourceCategory: 'user_provided', mode: 'link-only',
      sourceEntityId: `${id}-source`, sourceRevisionId: `${id}-source-v1`, position: { kind: 'link' }, order: 0,
      title: '原始合成贡献', url: sourceUrl }] });
  return answer;
}

async function fixture(t, { data = site.data, config = site.config, api = () => ({ body: [] }), viewport = { width: 1280, height: 900 }, clock = false } = {}) {
  const snapshot = structuredClone(data);
  snapshot.site.contributionsRepository = repository;
  const context = await site.browser.newContext({ viewport });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const requests = [], errors = [], forbidden = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() !== 'GET') { forbidden.push({ method: request.method(), url: url.href }); await route.abort('blockedbyclient'); return; }
    if (url.origin === new URL(site.base).origin) {
      if (url.pathname.endsWith('/public.json')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(snapshot) });
      if (url.pathname.endsWith('/community-topics.json')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(config) });
      return route.continue();
    }
    if (url.origin === 'https://api.github.com') {
      requests.push({ method: request.method(), pathname: url.pathname, page: url.searchParams.get('page') });
      const result = await api(url, request);
      if (result?.abort) return route.abort('failed');
      return route.fulfill({ status: result?.status ?? 200, contentType: 'application/json', headers: {
        'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Link, Retry-After, X-RateLimit-Remaining, X-RateLimit-Reset',
        ...result?.headers,
      }, body: JSON.stringify(result?.body ?? []) });
    }
    // No real GitHub navigation, posts, comments or third-party requests are allowed.
    forbidden.push({ method: request.method(), url: url.href });
    return route.abort('blockedbyclient');
  });
  if (clock) await page.clock.install({ time: new Date(fixedNow) });
  else await page.addInitScript(value => { Date.now = () => Date.parse(value); }, fixedNow);
  t.after(async () => {
    await context.close();
    assert.deepEqual(forbidden, [], 'all nonlocal requests must be mocked GitHub API reads');
    assert.deepEqual(errors, [], 'the real app must not raise page errors');
  });
  const goto = async hash => {
    await page.goto(site.base + hash);
    await page.locator('body[data-ready="true"]').waitFor();
  };
  return { page, requests, goto };
}

const waitFeed = (page, text) => page.locator('.view:not([hidden]) .feed-status').filter({ hasText: text }).waitFor();
const assertFits = async page => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

test('home exposes three real editorial questions and allows mobile and keyboard participation without fabricated discussion', async t => {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const { page, goto } = await fixture(t, { viewport });
    await goto('#/discover');
    await waitFeed(page, '还没有读到');
    const prompts = site.config.topics.filter(topic => topic.kind === 'question' && !topic.collection);
    assert.equal(prompts.length, 3);
    assert.equal(await page.locator('#community-home .topic-card[data-collection="false"]').count(), 3);
    await assertFits(page);
    for (const topic of prompts) {
      const title = page.locator('#community-home .topic-card h3 a').filter({ hasText: topic.title });
      await title.focus();
      await page.keyboard.press('Enter');
      await page.locator('#topic-view').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#community-topic h1').innerText(), topic.title);
      await page.getByRole('button', { name: '我也说一句', exact: true }).click();
      assert.equal(await page.locator('#topic-composer textarea[name="content"]').evaluate(node => node === document.activeElement), true);
      await assertFits(page);
      await page.locator('#community-topic a.back').click();
      await page.locator('#discover-view').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#community-home .topic-card h3 a').filter({ hasText: topic.title }).evaluate(node => node === document.activeElement), true);
    }
  }
});

test('sourced cold-start topics display provenance on desktop and mobile without inventing contributions', async t => {
  const collected = site.config.topics.filter(topic => topic.collection);
  assert.ok(collected.length >= 16);
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const { page, goto } = await fixture(t, { viewport });
    await goto('#/discover');
    assert.equal(await page.locator('.source-collection .topic-card').count(), collected.length);
    assert.equal(await page.locator('.source-collection > .topic-grid .topic-card').count(), 3);
    const first = collected[0];
    await page.locator('.source-collection h3 a').filter({ hasText: first.title }).click();
    await page.locator('#topic-view').waitFor({ state: 'visible' });
    await waitFeed(page, '还没有读到');
    assert.equal(await page.locator('.topic-source-link').count(), first.sources.length);
    assert.match(await page.locator('.topic-sources').innerText(), /尚未经过人工核验/u);
    assert.match(await page.locator('.topic-source[data-access-status="unavailable"]').innerText(), /本次未读到正文/u);
    for (const source of first.sources) {
      assert.equal(await page.locator('.topic-source-link').filter({ hasText: source.title }).getAttribute('href'), source.url);
    }
    assert.equal(await page.locator('.discussion-post').count(), 0);
    assert.equal(await page.getByRole('link', { name: '前往报名', exact: true }).count(), 0);
    await assertFits(page);
    await goto('#/topics/collected-library-floor-plan');
    assert.match(await page.locator('.source-summary').innerText(), /楼层图/u);
    await assertFits(page);
    await goto('#/topics/collected-international-day-2026');
    assert.match(await page.locator('#community-topic .event-state').innerText(), /计划结束时间已过，举办情况待确认/u);
    assert.equal(await page.getByRole('link', { name: '前往报名', exact: true }).count(), 0);
    await assertFits(page);
  }
});

test('the live feed distinguishes an empty result, an actual mocked public post and a failed refresh', async t => {
  const topic = site.config.topics[0];
  let mode = 'empty';
  const { page, goto } = await fixture(t, { api: () => mode === 'network' ? { abort: true } : { body: mode === 'empty' ? [] : [issue(11, topic.id)] } });
  await goto(`#/topics/${topic.id}`);
  await waitFeed(page, '还没有读到这个话题的公开投稿');
  assert.equal(await page.locator('.discussion-post').count(), 0);
  mode = 'post';
  await page.getByRole('button', { name: '刷新讨论', exact: true }).click();
  await waitFeed(page, '已读到 1 条投稿');
  assert.match(await page.locator('#issue-11').innerText(), /synthetic-reader-11/u);
  mode = 'network';
  await page.getByRole('button', { name: '刷新讨论', exact: true }).click();
  await waitFeed(page, '暂时连不上 GitHub');
  assert.match(await page.locator('.feed-status').innerText(), /保留上次已读到/u);
  assert.equal(await page.locator('#issue-11').count(), 1);
  assert.equal((await page.locator('.feed-status').innerText()).includes('还没有读到这个话题'), false);
});

test('a page without topic matches does not claim an empty history and can load the next page', async t => {
  const topic = site.config.topics[0];
  const { page, requests, goto } = await fixture(t, { api: url => url.searchParams.get('page') === '2'
    ? { body: [issue(22, topic.id)] }
    : { body: [issue(21, 'unrelated-synthetic-topic')], headers: { Link: `<https://api.github.com/repos/${repository}/issues?page=2&per_page=100>; rel="next"` } } });
  await goto(`#/topics/${topic.id}`);
  await waitFeed(page, '已读取的页面没有匹配投稿');
  assert.equal((await page.locator('.feed-status').innerText()).includes('还没有读到这个话题'), false);
  await page.getByRole('button', { name: '继续读取较早投稿', exact: true }).click();
  await page.locator('#issue-22').waitFor();
  await waitFeed(page, '已读到 1 条投稿');
  assert.ok(requests.some(request => request.page === '2'));
  assert.equal(await page.getByRole('button', { name: '继续读取较早投稿', exact: true }).isVisible(), false);
});

test('a discussion deep link loads its exact issue by GET, focuses it and rejects another topic', async t => {
  const topic = site.config.topics[0];
  const { page, requests, goto } = await fixture(t, { api: url => /\/issues\/88$/u.test(url.pathname)
    ? { body: issue(88, topic.id) } : /\/issues\/89$/u.test(url.pathname)
      ? { body: issue(89, 'another-synthetic-topic') } : { body: [] } });
  await goto(`#/topics/${topic.id}?discussion=issue-88`);
  await page.locator('#issue-88').waitFor();
  await page.waitForFunction(() => document.activeElement?.id === 'issue-88');
  assert.ok(requests.some(request => request.pathname.endsWith('/issues/88') && request.method === 'GET'));
  await goto(`#/topics/${topic.id}?discussion=issue-89`);
  await page.getByText('指定投稿不属于此话题，或已不可用。', { exact: true }).waitFor();
  assert.equal(await page.locator('#issue-89').count(), 0);
});

test('replies remain inert text, preserve exact source links and prepare a contextual reply without posting', async t => {
  const topic = site.config.topics[0], original = issue(31, topic.id, { comments: 1 });
  const commentUrl = `${original.html_url}#issuecomment-701`;
  const data = structuredClone(site.data);
  data.answers.push(summary('synthetic-reply-summary', '合成回复来源整理', commentUrl));
  const { page, requests, goto } = await fixture(t, { data, api: url => url.pathname.endsWith('/comments') ? { body: [{
    id: 701, body: '<img src=x onerror="window.TEST_EXECUTED=true"> 合成补充内容', html_url: commentUrl,
    user: { login: 'synthetic-replier' }, created_at: '2026-09-09T05:00:00Z', updated_at: '2026-09-09T05:00:00Z',
  }] } : { body: [original] } });
  await goto(`#/topics/${topic.id}`);
  await page.locator('#issue-31').waitFor();
  await page.getByRole('button', { name: '查看回复（1）', exact: true }).click();
  await page.locator('#comment-701').waitFor();
  assert.equal(await page.locator('#comment-701 img').count(), 0);
  assert.equal(await page.evaluate(() => window.TEST_EXECUTED), undefined);
  assert.equal(await page.locator('#comment-701 a').filter({ hasText: '这条回复的原文' }).getAttribute('href'), commentUrl);
  assert.match(await page.locator('#comment-701 .discussion-used').innerText(), /合成回复来源整理/u);
  await page.locator('#issue-31').getByRole('button', { name: '回复这条', exact: true }).click();
  const composer = page.locator('#issue-31 .quick-contribution');
  assert.match(await composer.innerText(), /正在回复 synthetic-reader-31.*#31/u);
  await composer.locator('textarea[name="content"]').fill('这是我的合成追问。');
  await composer.locator('input[type="checkbox"]').check();
  await composer.getByRole('button', { name: '准备回复，前往 GitHub 确认', exact: true }).click();
  const draft = await composer.locator('.quick-copy-body').inputValue();
  assert.match(draft, /回复原讨论：https:\/\/github.com\/SyntheticOwner\/public-guide-feedback\/issues\/31/u);
  assert.ok(draft.includes(`<!-- xjtlu-topic:${topic.id} -->`));
  assert.match(await composer.locator('.quick-status').innerText(), /尚未提交/u);
  assert.ok(requests.some(request => request.pathname.endsWith('/issues/31/comments')));
  assert.ok(requests.every(request => request.method === 'GET'));
});

test('current-topic summaries use exact loaded discussion sources rather than another prompt in the same catalog', async t => {
  const topic = site.config.topics[0], other = { ...topic, id: 'synthetic-other-course-prompt', title: '另一道合成课程问题' };
  const config = { ...site.config, topics: [...site.config.topics, other] };
  const currentPost = issue(41, topic.id), otherPost = issue(42, other.id);
  const data = structuredClone(site.data);
  data.answers = [summary('synthetic-current-summary', '属于当前提问的整理', currentPost.html_url), summary('synthetic-other-summary', '属于另一提问的整理', otherPost.html_url)];
  const { page, goto } = await fixture(t, { data, config, api: () => ({ body: [currentPost, otherPost] }) });
  await goto(`#/topics/${topic.id}`);
  await waitFeed(page, '已读到 1 条投稿');
  assert.equal(await page.locator('.topic-summary h2').innerText(), '目前整理');
  assert.match(await page.locator('.topic-summary').innerText(), /属于当前提问的整理/u);
  assert.equal((await page.locator('.topic-summary').innerText()).includes('属于另一提问的整理'), false);
  assert.equal(await page.locator('.topic-summary .summary-source').getAttribute('href'), currentPost.html_url);
  assert.match(await page.locator('#issue-41 .discussion-used').innerText(), /属于当前提问的整理/u);
  await page.locator('.topic-summary h3 a').click();
  await page.locator('#detail-view').waitFor({ state: 'visible' });
  assert.ok((await page.locator('#answer-detail a').evaluateAll(nodes => nodes.map(node => node.href))).includes(currentPost.html_url));
  await page.locator('#back-to-list').click();
  await page.locator('#topic-view').waitFor({ state: 'visible' });
  assert.ok(page.url().includes(`#/topics/${topic.id}`));
});

function eventTopic(id, status, patch = {}) {
  return { id, catalogTopicId: 'topic-clubs', title: `合成活动 ${id}`, prompt: '这只是浏览器测试用的活动，不会发布。', kind: 'event', editorial: true,
    event: { status, startsAt: '2026-09-12T06:00:00Z', endsAt: '2026-09-12T08:00:00Z',
      registrationStatus: 'open', registrationEndsAt: '2026-09-11T10:00:00Z', registrationUrl: 'https://www.xjtlu.edu.cn/synthetic-registration',
      confirmedAt: '2026-09-10T01:00:00Z', ...patch } };
}

test('cancelled and past-planned events move to history while their topic and discussion stay readable without registration', async t => {
  const cancelled = eventTopic('synthetic-cancelled', 'cancelled');
  const historical = eventTopic('synthetic-history', 'scheduled', { startsAt: '2026-09-08T06:00:00Z', endsAt: '2026-09-08T08:00:00Z' });
  const active = eventTopic('synthetic-upcoming', 'scheduled');
  const config = { ...site.config, topics: [...site.config.topics, cancelled, historical, active] };
  const { page, goto } = await fixture(t, { config, viewport: { width: 390, height: 844 } });
  await goto('#/discover');
  const section = page.locator('.home-section').filter({ has: page.getByRole('heading', { name: '校园近况与新回答', exact: true }) });
  assert.equal(await section.locator(':scope > .topic-grid .topic-card').count(), 1);
  assert.match(await section.locator(':scope > .topic-grid').innerText(), /synthetic-upcoming/u);
  const archive = section.locator('.happenings-history');
  assert.equal(await archive.getAttribute('open'), null);
  assert.equal(await archive.locator('.topic-card').count(), 2);
  await archive.locator('summary').click();
  await assertFits(page);
  for (const row of [cancelled, historical]) {
    await goto(`#/topics/${row.id}`);
    assert.equal(await page.getByRole('link', { name: '前往报名', exact: true }).count(), 0);
    const state = await page.locator('#community-topic .event-state').innerText();
    assert.match(state, row === cancelled ? /已取消/u : /计划结束时间已过，举办情况待确认/u);
    assert.match(state, /保留经过和后续补充/u);
    assert.equal(await page.locator('#topic-composer textarea').count() > 0, true);
    await assertFits(page);
  }
});

test('an already-open event page removes its registration CTA across the actual deadline without navigation', async t => {
  const event = eventTopic('synthetic-deadline', 'scheduled', { registrationEndsAt: '2026-09-10T02:00:10.000Z' });
  const config = { ...site.config, topics: [...site.config.topics, event] };
  const { page, goto } = await fixture(t, { config, clock: true });
  await goto(`#/topics/${event.id}`);
  await page.getByRole('link', { name: '前往报名', exact: true }).waitFor();
  await page.clock.fastForward(12000);
  await page.locator('.event-state').filter({ hasText: '已到报名截止时间' }).waitFor();
  assert.equal(await page.getByRole('link', { name: '前往报名', exact: true }).count(), 0);
  assert.equal(page.url().includes(`#/topics/${event.id}`), true);
  assert.match(await page.locator('.event-state .state-label').innerText(), /按计划安排/u);
});

async function expectTopicLayout(page, stage, order) {
  await page.waitForFunction(({ stage, order }) => {
    const target = document.querySelector('#community-topic');
    const actual = [...target.children].flatMap(node => node.id === 'topic-composer' ? ['composer']
      : node.matches('.topic-discussion') ? ['discussion'] : node.matches('.topic-summary') ? ['summary'] : []);
    return target.dataset.stage === stage && JSON.stringify(actual) === JSON.stringify(order);
  }, { stage, order });
}

test('regression: refresh moves between inviting, discussing and summarized layouts without losing the draft or refresh focus', async t => {
  const topic = site.config.topics[0], firstPost = issue(61, topic.id), citedPost = issue(62, topic.id);
  const data = structuredClone(site.data);
  data.answers = [summary('synthetic-refresh-summary', '刷新后出现的整理', citedPost.html_url)];
  let posts = [];
  const { page, goto } = await fixture(t, { data, api: () => ({ body: posts }) });
  await goto(`#/topics/${topic.id}`);
  await waitFeed(page, '还没有读到这个话题的公开投稿');
  await expectTopicLayout(page, 'inviting', ['composer', 'discussion', 'summary']);
  const input = page.locator('#topic-composer textarea[name="content"]');
  const originalInput = await input.elementHandle();
  await input.fill('刷新期间继续保留的合成草稿。');
  const refresh = page.getByRole('button', { name: '刷新讨论', exact: true });
  for (const step of [
    { posts: [firstPost], stage: 'discussing', order: ['discussion', 'composer', 'summary'] },
    { posts: [firstPost, citedPost], stage: 'summarized', order: ['summary', 'discussion', 'composer'] },
    { posts: [], stage: 'inviting', order: ['composer', 'discussion', 'summary'] },
  ]) {
    posts = step.posts;
    await refresh.click();
    await waitFeed(page, posts.length ? `已读到 ${posts.length} 条投稿` : '还没有读到这个话题的公开投稿');
    await expectTopicLayout(page, step.stage, step.order);
    assert.equal(await refresh.evaluate(node => node === document.activeElement), true, 'refresh must retain keyboard focus after rearranging sections');
    assert.equal(await originalInput.evaluate(node => node.isConnected && node === document.querySelector('#topic-composer textarea[name="content"]')), true);
    assert.equal(await input.inputValue(), '刷新期间继续保留的合成草稿。');
    assert.equal(await page.locator('.topic-discussion .discussion-post').count(), posts.length);
  }
  assert.equal(await page.locator('.topic-summary h2').innerText(), '先看看相关资料');
  assert.equal(await page.locator('.topic-summary .summary-source').count(), 0);
});

test('regression: loading older posts and refreshing a deep link do not focus or scroll back to its first issue', async t => {
  const topic = site.config.topics[0];
  const selected = issue(71, topic.id, { body: `<!-- xjtlu-topic:${topic.id} -->\n\n${'足够长的合成正文，用于验证翻页不会回跳。\n'.repeat(100)}` });
  const { page, goto } = await fixture(t, { api: url => url.searchParams.get('page') === '2'
    ? { body: [issue(72, topic.id)], headers: { Link: `<https://api.github.com/repos/${repository}/issues?page=3&per_page=100>; rel="next"` } }
    : { body: [selected], headers: { Link: `<https://api.github.com/repos/${repository}/issues?page=2&per_page=100>; rel="next"` } } });
  await goto(`#/topics/${topic.id}?discussion=issue-71`);
  await page.waitForFunction(() => document.activeElement?.id === 'issue-71');
  const more = page.getByRole('button', { name: '继续读取较早投稿', exact: true });
  await more.click();
  await waitFeed(page, '已读到 2 条投稿');
  assert.equal(await more.evaluate(node => node === document.activeElement), true, 'pagination should keep focus on its control');
  assert.equal(await page.locator('#issue-71').evaluate(node => node.getBoundingClientRect().top < 0), true, 'pagination must not scroll back to the requested issue');
  const refresh = page.getByRole('button', { name: '刷新讨论', exact: true });
  await refresh.click();
  await waitFeed(page, '已读到 1 条投稿');
  assert.equal(await refresh.evaluate(node => node === document.activeElement), true, 'refresh should not focus the deep-linked issue again');
  assert.equal(await page.locator('#issue-71').evaluate(node => node.getBoundingClientRect().top < 0), true);
});

test('regression: a slow deep-link lookup preserves active writing and applies the pending layout after blur', async t => {
  const topic = site.config.topics[0];
  const response = Promise.withResolvers(), requested = Promise.withResolvers();
  const { page, goto } = await fixture(t, { api: url => {
    if (url.pathname.endsWith('/issues/88')) { requested.resolve(); return response.promise; }
    return { body: [] };
  } });
  try {
    await goto(`#/topics/${topic.id}?discussion=issue-88`);
    await requested.promise;
    const input = page.locator('#topic-composer textarea[name="content"]');
    await input.fill('慢读取过程中正在写的合成内容。');
    response.resolve({ body: issue(88, topic.id) });
    await waitFeed(page, '已读到 1 条投稿');
    assert.equal(await input.evaluate(node => node === document.activeElement), true, 'a late requested post must not take focus from the composer');
    assert.equal(await input.inputValue(), '慢读取过程中正在写的合成内容。');
    await expectTopicLayout(page, 'discussing', ['composer', 'discussion', 'summary']);
    await page.getByRole('button', { name: '看原始回答 ↓', exact: true }).focus();
    await expectTopicLayout(page, 'discussing', ['discussion', 'composer', 'summary']);
    assert.equal(await input.inputValue(), '慢读取过程中正在写的合成内容。');
  } finally {
    response.resolve({ body: issue(88, topic.id) });
  }
});

test('regression: a focused summary link survives incoming sources until focus leaves the summary', async t => {
  const topic = site.config.topics[0], citedPost = issue(91, topic.id);
  const data = structuredClone(site.data);
  data.answers = [summary('synthetic-focused-summary', '保留焦点的合成整理', citedPost.html_url)];
  const response = Promise.withResolvers();
  const { page, goto } = await fixture(t, { data, api: () => response.promise });
  try {
    await goto(`#/topics/${topic.id}`);
    const link = page.locator('.topic-summary h3 a');
    await link.focus();
    const originalLink = await link.elementHandle();
    assert.equal(await page.locator('.topic-summary h2').innerText(), '先看看相关资料');
    response.resolve({ body: [citedPost] });
    await waitFeed(page, '已读到 1 条投稿');
    assert.equal(await originalLink.evaluate(node => node.isConnected && node === document.activeElement), true, 'reading a source must not replace a focused summary link');
    assert.equal(await page.locator('.topic-summary h2').innerText(), '先看看相关资料');
    await expectTopicLayout(page, 'summarized', ['composer', 'discussion', 'summary']);
    await page.getByRole('button', { name: '看原始回答 ↓', exact: true }).focus();
    await expectTopicLayout(page, 'summarized', ['summary', 'discussion', 'composer']);
    assert.equal(await page.locator('.topic-summary h2').innerText(), '目前整理');
    assert.equal(await page.locator('.topic-summary .summary-source').getAttribute('href'), citedPost.html_url);
  } finally {
    response.resolve({ body: [citedPost] });
  }
});
