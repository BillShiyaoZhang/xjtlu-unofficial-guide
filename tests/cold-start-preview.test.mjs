import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, basename } from 'node:path';
import { runInNewContext } from 'node:vm';
import { request as httpRequest } from 'node:http';
import { startColdStartPreview } from '../scripts/preview-cold-start.mjs';
import { createColdStartFixtures, fixtureRepository } from './fixtures/cold-start/scenarios.mjs';
import { mountQuickContribution } from './fixtures/cold-start/contributions.js';
import { validateTopicsConfig, eventPresentation, incidentPresentation } from '../community/pages-ui/topic-model.js';

const fixedNow = '2026-09-10T04:00:00Z';

test('synthetic fixtures cover every requested type and time-dependent state', () => {
  const fixtures = createColdStartFixtures({ now: fixedNow });
  const checked = validateTopicsConfig(fixtures.topics);
  assert.equal(checked.topics.length, 10);
  assert.ok(checked.topics.every(topic => topic.title.startsWith('【测试样例】') && topic.prompt.includes('合成场景')));
  const state = id => {
    const topic = checked.topics.find(row => row.id === `test-${id}`);
    return topic.kind === 'event' ? eventPresentation(topic.event, fixedNow) : incidentPresentation(topic.incident, fixedNow);
  };
  assert.equal(state('event-open').canRegister, true);
  assert.match(state('event-closed').registrationLabel, /已到报名截止/);
  assert.equal(state('event-closed').canRegister, false);
  assert.match(state('event-postponed').label, /已延期/);
  assert.match(state('event-rescheduled').label, /已改期/);
  assert.match(state('event-cancelled').label, /已取消/);
  assert.equal(state('event-cancelled').history, true);
  assert.match(state('event-past').label, /计划结束时间已过/);
  assert.equal(state('event-past').history, true);
  assert.match(state('incident-ongoing').label, /仍有影响/);
  assert.equal(state('incident-resolved').history, true);
  assert.match(state('incident-unknown').label, /待补充/);
  assert.equal(state('incident-unknown').history, false);
  assert.equal(fixtures.issues.length, 11);
  assert.ok(fixtures.issues.every(issue => issue.title.startsWith('【测试样例】') && issue.user.login.startsWith('test-fixture-')));
  assert.ok(Object.values(fixtures.replies).flat().every(reply => reply.body.startsWith('【测试样例】')));
  assert.throws(() => createColdStartFixtures({ now: 'invalid' }), /timestamp/);
});

test('local preview renders real fixture responses, supports discussions and preserves production output', async t => {
  const root = await mkdtemp(resolve(tmpdir(), 'guide-cold-start-preview-'));
  t.after(async () => {
    assert.equal(dirname(root), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('guide-cold-start-preview-'));
    await rm(root, { recursive: true, force: true });
  });
  const community = resolve(root, 'community');
  await mkdir(community);
  for (const name of ['pages.config.json', 'pages-reviewed.json', 'community-topics.json']) {
    await cp(new URL(`../community/${name}`, import.meta.url), resolve(community, name));
  }
  await cp(new URL('../community/pages-ui/', import.meta.url), resolve(community, 'pages-ui'), { recursive: true });
  const beforeConfig = await readFile(resolve(community, 'pages.config.json'), 'utf8');
  const preview = await startColdStartPreview({ root, port: 0, now: fixedNow });
  t.after(async () => {
    preview.server.closeAllConnections();
    await new Promise((resolveClose, reject) => preview.server.close(error => error ? reject(error) : resolveClose()));
  });
  assert.equal(preview.server.address().address, '127.0.0.1');
  const get = path => fetch(preview.origin + path);
  const response = await get('/');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy'), /connect-src 'self';/);
  assert.ok(!response.headers.get('content-security-policy').includes('github.com'));
  const html = await response.text();
  assert.match(html, /新增话题、投稿、回复与人物均为合成/);
  assert.match(html, /cold-start-guard\.js/);
  assert.match(html, /#\/topics\/test-incident-unknown/);
  const snapshot = await (await get('/public.json')).json();
  assert.equal(snapshot.site.contributionsRepository, fixtureRepository);
  assert.equal(snapshot.answers.length, preview.answerCount);
  assert.deepEqual(await (await get('/community-topics.json')).json(), preview.fixtures.topics);
  const discussionSource = await (await get('/discussions.js')).text();
  assert.ok(!discussionSource.includes('https://api.github.com'));
  assert.match(discussionSource, /mock-github\/repos\//);
  const discussion = await import(`data:text/javascript;base64,${Buffer.from(discussionSource).toString('base64')}`);
  const request = { repository: fixtureRepository, topics: preview.fixtures.topics.topics, answers: snapshot.answers };
  const activity = await discussion.loadCommunityActivity(request);
  assert.equal(activity.posts.length, 11);
  assert.equal(activity.hasMore, false);
  const question = await discussion.loadTopicDiscussions({ ...request, topicId: 'test-question', catalogTopicId: 'topic-study' });
  assert.equal(question.posts.length, 2);
  assert.ok(question.posts.some(post => post.state === 'closed'));
  const direct = await discussion.loadTopicDiscussion({ ...request, number: 1, topicId: 'test-question', catalogTopicId: 'topic-study' });
  assert.equal(direct.id, 'issue-1');
  const replies = await discussion.loadDiscussionReplies({ repository: fixtureRepository, number: 1 });
  assert.equal(replies.replies.length, 1);
  assert.match(replies.replies[0].body, /TEST101 入门练习/);
  const page2 = await discussion.loadCommunityActivity({ ...request, page: 2 });
  assert.equal(page2.posts.length, 0);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const blocked = await fetch(`${preview.origin}/mock-github/repos/${fixtureRepository}/issues`, { method, body: 'must not write' });
    assert.equal(blocked.status, 405);
  }
  assert.equal((await get('/community/pages.config.json')).status, 404);
  assert.equal((await get('/.runtime/community.sqlite')).status, 404);
  assert.equal((await get(`/mock-github/repos/${fixtureRepository}/issues/999/comments`)).status, 404);
  const hostProbe = host => new Promise((resolveProbe, reject) => {
    const request = httpRequest(`${preview.origin}/discussions.js`, { headers: { Host: host } }, response => {
      let text = ''; response.setEncoding('utf8'); response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolveProbe({ status: response.statusCode, text }));
    });
    request.on('error', reject); request.end();
  });
  assert.equal((await hostProbe('attacker.example')).status, 403);
  const localhost = await hostProbe(`localhost:${preview.server.address().port}`);
  assert.equal(localhost.status, 200);
  assert.ok(localhost.text.includes(`http://localhost:${preview.server.address().port}/mock-github/`));
  const contributionSource = await (await get('/contributions.js')).text();
  assert.match(contributionSource, /本地投稿演练/);
  assert.ok(!contributionSource.includes('https://github.com'));
  assert.match(await (await get('/community.js')).text(), /正在读取合成测试投稿/);
  assert.equal(await readFile(resolve(community, 'pages.config.json'), 'utf8'), beforeConfig);
  const diskSnapshot = JSON.parse(await readFile(resolve(preview.output, 'public.json'), 'utf8'));
  assert.notEqual(diskSnapshot.site.contributionsRepository, fixtureRepository);
  for (const name of ['public.json', 'community-topics.json', 'index.html', 'contributions.js', 'discussions.js']) {
    const disk = await readFile(resolve(preview.output, name), 'utf8');
    assert.ok(!disk.includes('test-event-open'), name);
    assert.ok(!disk.includes('cold-start-guard.js'), name);
    assert.ok(!disk.includes('mock-github'), name);
  }
  assert.match(await readFile(resolve(preview.output, 'discussions.js'), 'utf8'), /https:\/\/api\.github\.com/);
});

test('preview guard neutralizes external permalink and registration links before activation', async () => {
  const makeLink = href => ({
    href, dataset: {}, getAttribute() { return this.href; }, removeAttribute(name) { delete this[name]; },
  });
  const remote = makeLink(`https://github.com/${fixtureRepository}/issues/1`);
  const registration = makeLink('https://example.com/synthetic-registration');
  const internal = makeLink('#/topics/test-question');
  const handlers = new Map(); let mutation;
  const notice = { focus() { this.focused = true; } };
  runInNewContext(await readFile(new URL('./fixtures/cold-start/guard.js', import.meta.url), 'utf8'), {
    URL, location: { origin: 'http://127.0.0.1:4319', href: 'http://127.0.0.1:4319/' },
    document: { documentElement: {}, querySelectorAll: () => [remote, registration, internal],
      getElementById: () => notice, addEventListener: (name, handler) => handlers.set(name, handler) },
    MutationObserver: class { constructor(callback) { mutation = callback; } observe() {} },
  });
  mutation();
  assert.equal(remote.href, '#cold-start-preview-notice');
  assert.equal(registration.href, '#cold-start-preview-notice');
  assert.equal(internal.href, '#/topics/test-question');
  let prevented = false;
  handlers.get('auxclick')({ target: { closest: () => remote }, preventDefault() { prevented = true; }, stopImmediatePropagation() {} });
  assert.ok(prevented);
  assert.ok(notice.focused);
  assert.match(notice.textContent, /外部链接与发布已停用/);
});

test('preview composer displays input as local text without invoking production submission', () => {
  const nodes = [];
  const doc = { createElement(tag) {
    const node = { tag, children: [], handlers: new Map(), value: '',
      append(...items) { this.children.push(...items); }, setAttribute() {},
      addEventListener(name, fn) { this.handlers.set(name, fn); }, removeEventListener(name) { this.handlers.delete(name); }, focus() { this.focused = true; } };
    nodes.push(node); return node;
  } };
  const target = { ownerDocument: doc, replaceChildren(...items) { this.children = items; } };
  const composer = mountQuickContribution(target);
  const input = nodes.find(node => node.tag === 'textarea');
  input.value = '<script>example</script>';
  let prevented = false;
  const form = nodes.find(node => node.tag === 'form');
  form.handlers.get('submit')({ preventDefault() { prevented = true; } });
  assert.ok(prevented);
  assert.ok(nodes.some(node => node.textContent === '【测试样例 · 未提交】<script>example</script>'));
  assert.ok(nodes.every(node => !node.href));
  composer.focus(); assert.ok(input.focused);
  composer.destroy(); assert.ok(!form.handlers.has('submit'));
});
