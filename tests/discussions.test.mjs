import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DiscussionLoadError, discussionDisclosure, discussionMatchesTopic, discussionPermalink, discussionPresentation,
  parseDiscussionIssue, parseDiscussionReply, parseDiscussionPagination, summariesForDiscussion,
  loadTopicDiscussions, loadTopicDiscussion, loadDiscussionReplies, loadCommunityActivity,
} from '../community/pages-ui/discussions.js';
import { buildContributionDraft, buildQuickContributionDraft } from '../community/pages-ui/contributions.js';

const repository = 'SyntheticOwner/public-guide-feedback';
const topicId = 'topic-library';
const answers = [{ id: 'article-1', topic: { id: topicId } }, { id: 'article-2', topic: { id: 'topic-research' } }];
const marker = `<!-- xjtlu-topic:${topicId} -->`;
const issueUrl = number => `https://github.com/${repository}/issues/${number}`;
const issue = (number = 1, overrides = {}) => ({
  id: 9000 + number, number, title: '想补充一点 📚', body: `我的亲历\n\n${marker}`, user: { login: 'reader' },
  created_at: '2026-09-10T01:02:03Z', updated_at: '2026-09-10T04:05:06Z',
  html_url: issueUrl(number), comments: 3, state: 'open', ...overrides,
});
const comment = (id = 7, overrides = {}) => ({
  id, body: '太仓有不同情况。\n请保留这一行。', user: { login: 'another-reader' },
  created_at: '2026-09-10T04:05:06Z', updated_at: '2026-09-10T05:06:07Z',
  html_url: `${issueUrl(1)}#issuecomment-${id}`, ...overrides,
});
const response = (data, { status = 200, headers = {} } = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', ...headers },
});
const settings = { repository, topicId, answers };
const legacyBody = (articleId = 'article-1') => buildContributionDraft({
  repository,
  values: { type: 'experience', title: '真实经历', content: '我用过这个入口', source: '本人经历', campus: '太仓校区', audience: '硕士生', time: '2026 年 9 月', ai: '未使用', public: true },
  article: { answer: { id: articleId, title: '原文章', revisionId: `${articleId}-v1`, revisionNumber: 1 }, url: 'https://guide.example/#/answers/' + articleId },
}).body;

const quickDraft = (values = {}, options = {}) => buildQuickContributionDraft({
  snapshot: { site: { contributionsRepository: repository, publicUrl: 'https://guide.example/project/' } },
  topic: { id: topicId, catalogTopicId: topicId, title: '你有什么图书馆使用经验？' },
  values: { content: '我用过预约服务。', public: true, ...values }, ...options,
});

test('presentation recognizes actual quick drafts and hides only their outer machine metadata', () => {
  const draft = quickDraft({}, { article: { id: 'article-1', title: '借书与预约', revisionId: 'article-1-v2', revisionNumber: 2 } });
  const view = discussionPresentation(draft.body);
  assert.equal(view.formatted, true);
  assert.equal(view.text, '我用过预约服务。');
  assert.equal(view.context, '话题：你有什么图书馆使用经验？\n关联资料：借书与预约（第 2 版）');
  assert.equal(view.raw, draft.body);
  assert.doesNotMatch(view.context, /article-1|知识分类 ID|阅读版本|xjtlu-topic/u);
});

test('presentation preserves every middle heading, routing example and quoted confirmation in user text', () => {
  const content = ['先讲一个经历。', '### 我的分享', '下面是我自己的标题。', '### 补充背景',
    '这仍然是我写的正文。', '```html', marker, '```', '<script>alert(1)</script>',
    '### 公开提交确认', '我知道在 GitHub 确认提交后，我的 GitHub 用户名和这段正文会公开。'].join('\n\n');
  const draft = quickDraft({ content });
  const view = discussionPresentation(draft.body);
  assert.equal(view.formatted, true);
  assert.equal(view.text, content);
  assert.equal(view.raw, draft.body);
});

test('presentation keeps long text and optional background without truncation or Markdown splitting', () => {
  const content = '一段不能被截断的真实经历 📚\n'.repeat(12000).trim();
  const source = 'https://example.com/resource\n\n### 资料中的标题\n仍须保留';
  const draft = quickDraft({ content, campus: '太仓', sourceNature: '本人亲历', source });
  const view = discussionPresentation(draft.body);
  assert.equal(view.formatted, true);
  assert.equal(view.text, `${content}\n\n### 补充背景\n\n**来源性质**：本人亲历\n\n**校区**：太仓\n\n**链接或补充依据**：${source}`);
  assert.equal(view.raw, draft.body);
  assert.ok(view.text.length > 100000);
});

test('reply presentation retains a reader-friendly target and supports CRLF without altering user lines', () => {
  const draft = quickDraft({ content: '我的第一行\n第二行' }, { reply: { id: 'comment-7', number: 1, url: `${issueUrl(1)}#issuecomment-7` } });
  const raw = draft.body.replaceAll('\n', '\r\n');
  const view = discussionPresentation(raw);
  assert.equal(view.formatted, true);
  assert.equal(view.text, '我的第一行\r\n第二行');
  assert.match(view.context, /回复 GitHub 讨论 #1 中的一条回复/u);
  assert.doesNotMatch(view.context, /回复对象 ID|comment-7/u);
  assert.equal(view.raw, raw);
});

test('legacy, partial, edited or unfamiliar envelopes remain entirely unchanged', () => {
  const valid = quickDraft().body;
  for (const raw of [
    legacyBody(), `${marker}\n普通投稿，只有路由标记。`, '### 我的分享\n\n普通 Markdown，不是网站模板。',
    valid.replace('### 公开提交确认', '### 修改过的确认'), valid.replace('### 我的分享', '### 我的回复'),
    valid + '\n后面还有作者的新内容，不能丢掉。',
    valid.replace('知识分类 ID：topic-library', '额外字段：这行必须留在原文中'),
    valid.replace('共建话题：', '改写的话题：'),
    quickDraft({}, { reply: { id: 'issue-1', number: 1, url: issueUrl(1) } }).body.replace(issueUrl(1), 'https://evil.example/issue/1'),
  ]) assert.deepEqual(discussionPresentation(raw), { text: raw, context: '', raw, formatted: false });
});

test('topic matching accepts the explicit marker or an actual legacy website draft', () => {
  assert.equal(discussionMatchesTopic(`几句话就可以。\n${marker}`, settings), true);
  assert.equal(discussionMatchesTopic(legacyBody(), settings), true);
  assert.equal(discussionMatchesTopic(legacyBody().replaceAll('\n', '\r\n'), settings), true);
  assert.equal(discussionMatchesTopic(legacyBody('article-2'), settings), false);
  assert.equal(discussionMatchesTopic('没有关联字段', settings), false);
});

test('a seed topic can map legacy articles via its catalog topic without confusing explicit markers', () => {
  const seed = { ...settings, topicId: 'campus-discoveries', catalogTopicId: topicId };
  assert.equal(discussionMatchesTopic('<!-- xjtlu-topic:campus-discoveries -->', seed), true);
  assert.equal(discussionMatchesTopic(legacyBody(), seed), true);
  assert.equal(discussionMatchesTopic(marker, seed), false);
  const post = parseDiscussionIssue(issue(1, { body: legacyBody() }), seed);
  assert.equal(post.topicId, 'campus-discoveries');
});

test('ordinary prose, links, quoted metadata and fenced examples cannot assign a topic', () => {
  for (const body of [
    '看过 article-1，也读过 topic-library。', '文章 ID：article-1',
    '### 来源或依据\n\n文章 ID：article-1', 'https://guide.example/#/answers/article-1',
    `这里引用 ${marker} 作为例子`, `> ${marker}`, `    ${marker}`,
    `\`\`\`html\n${marker}\n\`\`\``, `~~~~\n${marker}\n~~~~`,
    `\`\`\`\n### 关联文章\n文章 ID：article-1\n\`\`\``,
    `<pre>\n${marker}\n</pre>`, `<code>\n${marker}\n</code>`, `<!-- example\n${marker}\n-->`,
    '### 关联文章\n\n[文章 ID：article-1](https://evil.example/)',
  ]) assert.equal(discussionMatchesTopic(body, settings), false, body);
  assert.equal(discussionMatchesTopic(`\`\`\`\n<!-- xjtlu-topic:wrong -->\n\`\`\`\n${marker}`, settings), true);
});

test('conflicting, malformed and unknown article associations fail closed', () => {
  for (const body of [
    `${marker}\n<!-- xjtlu-topic:topic-other -->`,
    `${marker}\n<!-- xjtlu-topic:broken id -->`,
    `${marker}\n${legacyBody('article-2')}`,
    `${marker}\n${legacyBody('missing-article')}`,
    `${legacyBody()}\n### 关联文章\n文章 ID：article-2`,
    '### 关联文章\n文章 ID：article-1\n文章 ID：article-2',
    '<!-- xjtlu-topic:topic-library --> trailing text',
  ]) assert.equal(discussionMatchesTopic(body, settings), false, body);
  assert.equal(discussionMatchesTopic(legacyBody(), { ...settings, answers: [...answers, { id: 'article-1', topic: { id: 'other' } }] }), false);
});

test('post parsers preserve complete raw text and never turn closed into accepted or verified', () => {
  const body = `${'<script>alert(1)</script> **Markdown** 汉字 📚\n'.repeat(3000)}\n${marker}`;
  const original = issue(12, { body, title: '<img src=x onerror=alert(1)>', state: 'closed', state_reason: 'completed', body_html: '<b>Not raw</b>' });
  const frozen = JSON.stringify(original);
  const post = parseDiscussionIssue(original, settings);
  assert.equal(post.id, 'issue-12');
  assert.equal(post.body, body);
  assert.equal(post.title, original.title);
  assert.equal(post.url, issueUrl(12));
  assert.equal(post.state, 'closed');
  assert.equal(post.author, 'reader');
  assert.equal(post.commentCount, 3);
  assert.equal(post.createdAt, original.created_at);
  assert.deepEqual(Object.keys(post).sort(), ['id', 'number', 'title', 'body', 'author', 'createdAt', 'updatedAt', 'url', 'commentCount', 'state', 'topicId'].sort());
  assert.equal(JSON.stringify(original), frozen);
  assert.match(discussionDisclosure, /原始公开投稿.*未经本站核验/u);
});

test('PRs and malformed records are excluded regardless of topic text', () => {
  for (const original of [null, {}, issue(1, { pull_request: {} }), issue(1, { pull_request: null }), issue(0), issue(1.5), issue(1, { body: {} }), issue(1, { state: 'approved' })]) {
    assert.equal(parseDiscussionIssue(original, settings), null);
  }
});

test('permalinks are exact HTTPS destinations within the selected repository', () => {
  assert.equal(discussionPermalink(issueUrl(1), { repository, number: 1 }), issueUrl(1));
  for (const url of [
    issueUrl(2), `${issueUrl(1)}#issuecomment-7`, `${issueUrl(1)}?redirect=evil`,
    issueUrl(1).replace('https:', 'http:'), issueUrl(1).replace('github.com', 'github.com.evil.example'),
    issueUrl(1).replace(repository, 'OtherOwner/another-repo'), issueUrl(1).replace('/issues/', '/pull/'),
    `https://name:password@github.com/${repository}/issues/1`, `https://evil.example/?url=${issueUrl(1)}`,
    'javascript:alert(1)', `//github.com/${repository}/issues/1`,
  ]) {
    assert.equal(discussionPermalink(url, { repository, number: 1 }), null, url);
    assert.equal(parseDiscussionIssue(issue(1, { html_url: url }), settings), null, url);
  }
});

test('replies keep the original comment anchor, full text and deleted-author fallback', () => {
  const raw = comment(7, { body: '<a href="javascript:alert(1)">原话</a>\n\n'.repeat(2000), user: null });
  const reply = parseDiscussionReply(raw, { repository, number: 1 });
  assert.equal(reply.id, 'comment-7');
  assert.equal(reply.url, `${issueUrl(1)}#issuecomment-7`);
  assert.equal(reply.body, raw.body);
  assert.equal(reply.author, '已删除用户');
  for (const url of [issueUrl(1), `${issueUrl(1)}#issuecomment-8`, `${issueUrl(2)}#issuecomment-7`, `${issueUrl(1)}#discussion_r7`, 'https://evil.example/comment/7']) {
    assert.equal(parseDiscussionReply(comment(7, { html_url: url }), { repository, number: 1 }), null, url);
  }
});

test('summary provenance matches the exact issue or comment and never a whole topic', () => {
  const summaries = [
    { id: 'post-source', topic: { id: topicId }, citations: [{ url: issueUrl(1) }] },
    { id: 'reply-source', citations: [{ url: `${issueUrl(1)}#issuecomment-7` }] },
    { id: 'different-reply', citations: [{ url: `${issueUrl(1)}#issuecomment-8` }] },
    { id: 'same-topic', topic: { id: topicId }, citations: [{ url: issueUrl(2) }] },
    { id: 'host-confusion', citations: [{ url: `${issueUrl(1).replace('github.com', 'github.com.evil.example')}` }] },
  ];
  assert.deepEqual(summariesForDiscussion(summaries, { url: issueUrl(1) }), [summaries[0]]);
  assert.deepEqual(summariesForDiscussion(summaries, { url: `${issueUrl(1)}#issuecomment-7` }), [summaries[1]]);
  assert.deepEqual(summariesForDiscussion(summaries, { url: 'javascript:alert(1)' }), []);
  assert.deepEqual(summariesForDiscussion(summaries, { topicId }), []);
});

test('fetch requests only the configured repository with public credentials and no body-derived addresses', async () => {
  const requests = [];
  const result = await loadTopicDiscussions({ ...settings, page: 2, fetchImpl: async (url, options) => {
    requests.push({ url, options });
    return response([
      issue(1, { body: `${marker}\nhttps://evil.example/api\nhttps://api.github.com/repos/other/private/issues` }),
      issue(2, { pull_request: {} }), issue(3, { body: '<!-- xjtlu-topic:other -->' }),
      issue(4, { html_url: 'https://evil.example/issue' }), issue(1),
    ]);
  } });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, `https://api.github.com/repos/${repository}/issues?state=all&sort=updated&direction=desc&per_page=100&page=2`);
  const options = requests[0].options;
  assert.equal(options.method, 'GET');
  assert.equal(options.credentials, 'omit');
  assert.equal(options.cache, 'no-store');
  assert.equal(options.referrerPolicy, 'no-referrer');
  assert.equal(options.redirect, 'manual');
  assert.equal(new Headers(options.headers).has('Authorization'), false);
  assert.equal(options.body, undefined);
  assert.equal(options.headers.Accept, 'application/vnd.github.raw+json');
  assert.deepEqual(result.posts.map(post => post.number), [1]);
  assert.equal(result.hasMore, false);
  assert.equal(result.nextPage, null);
  assert.ok(Number.isFinite(Date.parse(result.fetchedAt)));
});

test('reply fetching uses only the issue-specific comments endpoint and preserves API order', async () => {
  const requests = [];
  const result = await loadDiscussionReplies({ repository, number: 1, page: 3, fetchImpl: async (url, options) => {
    requests.push({ url, options });
    return response([comment(7), comment(8), comment(8), comment(9, { html_url: `${issueUrl(2)}#issuecomment-9` })]);
  } });
  assert.equal(requests[0].url, `https://api.github.com/repos/${repository}/issues/1/comments?per_page=100&page=3`);
  assert.equal(requests[0].options.credentials, 'omit');
  assert.deepEqual(result.replies.map(reply => reply.url), [`${issueUrl(1)}#issuecomment-7`, `${issueUrl(1)}#issuecomment-8`]);
});

test('a topic deep link resolves with one GET and preserves the regular post shape', async () => {
  const requests = [];
  const raw = issue(421, { body: legacyBody() });
  const seed = { ...settings, topicId: 'library-first', catalogTopicId: topicId };
  const post = await loadTopicDiscussion({ ...seed, number: 421, fetchImpl: async (url, options) => {
    requests.push({ url, options });
    return response(raw);
  } });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, `https://api.github.com/repos/${repository}/issues/421`);
  assert.equal(requests[0].options.method, 'GET');
  assert.equal(requests[0].options.credentials, 'omit');
  assert.deepEqual(post, parseDiscussionIssue(raw, seed));
  assert.equal(post.topicId, 'library-first');
});

test('deep links cannot reveal PRs, other topics, different issue numbers or foreign permalinks', async () => {
  for (const raw of [
    issue(1, { body: '<!-- xjtlu-topic:other-topic -->' }), issue(1, { body: 'just a mention of topic-library' }),
    issue(1, { pull_request: {} }), issue(2), issue(1, { html_url: 'https://github.com/Other/repo/issues/1' }),
  ]) await assert.rejects(loadTopicDiscussion({ ...settings, number: 1, fetchImpl: async () => response(raw) }), { code: 'NOT_FOUND' });
  await assert.rejects(loadTopicDiscussion({ ...settings, number: 1, fetchImpl: async () => response([issue(1)]) }), { code: 'INVALID_RESPONSE' });
  await assert.rejects(loadTopicDiscussion({ ...settings, number: 1, fetchImpl: async () => response({}, { status: 404 }) }), { code: 'NOT_FOUND' });
  await assert.rejects(loadTopicDiscussion({ ...settings, number: '../issues', fetchImpl: async () => { assert.fail('invalid deep link must not fetch'); } }), { code: 'INVALID_ISSUE' });
});

test('community activity makes one request across topics, gives exact markers priority and emits each issue once', async () => {
  let calls = 0;
  const topics = [
    { id: 'library-first', catalogTopicId: topicId },
    { id: 'library-second', catalogTopicId: topicId },
    { id: 'research', catalogTopicId: 'topic-research' },
  ];
  const result = await loadCommunityActivity({ repository, topics, answers, fetchImpl: async url => {
    calls++;
    assert.equal(url, `https://api.github.com/repos/${repository}/issues?state=all&sort=updated&direction=desc&per_page=100&page=1`);
    return response([
      issue(1, { body: legacyBody() + '\n<!-- xjtlu-topic:library-second -->' }),
      issue(2, { body: legacyBody() }),
      issue(3, { body: legacyBody('article-2') }),
      issue(4, { body: legacyBody() + '\n<!-- xjtlu-topic:unconfigured -->' }),
      issue(2, { body: legacyBody() }), issue(5, { pull_request: {}, body: legacyBody() }),
    ], { headers: { Link: '<https://api.github.com/repositories/123/issues?page=2>; rel="next"' } });
  } });
  assert.equal(calls, 1);
  assert.deepEqual(result.posts.map(post => [post.number, post.topicId]), [[1, 'library-second'], [2, 'library-first'], [3, 'research']]);
  assert.equal(result.hasMore, true);
  assert.equal(result.nextPage, 2);
});

test('pagination remains visible even when a fetched repository page has no matching topics', async () => {
  const result = await loadTopicDiscussions({ ...settings, fetchImpl: async () => response([issue(1, { pull_request: {} })], {
    headers: { Link: '<https://api.github.com/repositories/123/issues?state=all&per_page=100&page=2>; rel="next", <https://api.github.com/repositories/123/issues?page=5>; rel="last"' },
  }) });
  assert.deepEqual(result.posts, []);
  assert.equal(result.hasMore, true);
  assert.equal(result.nextPage, 2);
  const full = await loadTopicDiscussions({ ...settings, fetchImpl: async () => response(Array.from({ length: 100 }, (_, index) => issue(index + 1, { pull_request: {} }))) });
  assert.deepEqual(full.posts, []);
  assert.equal(full.hasMore, true);
  assert.equal(full.nextPage, 2);
});

test('pagination validates next-page metadata without following returned URLs', () => {
  assert.deepEqual(parseDiscussionPagination({ page: 2, itemCount: 100, link: '<https://api.github.com/repositories/123/issues?page=1>; rel="prev"' }), { hasMore: false, nextPage: null });
  for (const link of [
    '<https://evil.example/?page=2>; rel="next"', '<https://api.github.com/repos/a/b/issues?page=3>; rel="next"',
    '<https://api.github.com/repos/a/b/issues?page=2&page=3>; rel="next"',
    '<javascript:alert(1)>; rel="next"',
    'malformed Link header',
  ]) assert.throws(() => parseDiscussionPagination({ link, page: 1 }), { code: 'INVALID_RESPONSE' });
});

test('invalid repository, issue and page input never produce a network request', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return response([]); };
  for (const invalid of ['https://github.com/a/b', 'owner/..', 'owner/repo?token=secret', 'owner/repo/more', 'owner/repo#fragment']) {
    await assert.rejects(loadTopicDiscussions({ ...settings, repository: invalid, fetchImpl }), { code: 'INVALID_REPOSITORY' });
  }
  for (const page of [0, -1, 1.5, '2', Number.MAX_SAFE_INTEGER + 1]) await assert.rejects(loadTopicDiscussions({ ...settings, page, fetchImpl }), { code: 'INVALID_PAGE' });
  await assert.rejects(loadDiscussionReplies({ repository, number: '../private', fetchImpl }), { code: 'INVALID_ISSUE' });
  await assert.rejects(loadTopicDiscussions({ ...settings, topicId: 'x&repository=other', fetchImpl }), { code: 'INVALID_TOPIC' });
  assert.equal(calls, 0);
});

test('HTTP, rate limit, malformed data and network errors are not converted into empty discussions', async () => {
  for (const [status, data, headers, code] of [
    [403, { message: 'rate limit exceeded' }, { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': '1893456000' }, 'RATE_LIMITED'],
    [403, { message: 'You have exceeded a secondary rate limit.' }, {}, 'RATE_LIMITED'],
    [429, {}, { 'Retry-After': '60' }, 'RATE_LIMITED'],
    [429, {}, { 'Retry-After': '9'.repeat(400) }, 'RATE_LIMITED'],
    [403, { message: 'forbidden' }, {}, 'FORBIDDEN'],
    [404, {}, {}, 'NOT_FOUND'], [410, {}, {}, 'UNAVAILABLE'], [422, {}, {}, 'INVALID_REQUEST'],
    [503, {}, {}, 'UNAVAILABLE'], [200, { unexpected: [] }, {}, 'INVALID_RESPONSE'],
  ]) await assert.rejects(loadTopicDiscussions({ ...settings, fetchImpl: async () => response(data, { status, headers }) }), error => {
    assert.ok(error instanceof DiscussionLoadError);
    assert.equal(error.code, code);
    if (status !== 200) assert.equal(error.status, status);
    if (headers['Retry-After'] === '60' || headers['X-RateLimit-Reset']) assert.ok(Number.isFinite(Date.parse(error.retryAt)));
    return true;
  });
  await assert.rejects(loadTopicDiscussions({ ...settings, fetchImpl: async () => new Response('not JSON') }), { code: 'INVALID_RESPONSE' });
  await assert.rejects(loadDiscussionReplies({ repository, number: 1, fetchImpl: async () => { throw new TypeError('fetch failed'); } }), { code: 'NETWORK' });
  await assert.rejects(loadTopicDiscussions({ ...settings, fetchImpl: async () => response({}, { status: 301, headers: { Location: 'https://api.github.com/repos/other/repo/issues' } }) }), { code: 'REPOSITORY_MOVED' });
});

test('timeout covers a stalled fetch or stalled body, and caller cancellation is separate', async () => {
  await assert.rejects(loadTopicDiscussions({ ...settings, timeoutMs: 15, fetchImpl: async () => new Promise(() => {}) }), { code: 'TIMEOUT' });
  await assert.rejects(loadDiscussionReplies({ repository, number: 1, timeoutMs: 15, fetchImpl: async () => ({ ok: true, status: 200, json: () => new Promise(() => {}) }) }), { code: 'TIMEOUT' });
  const controller = new AbortController();
  const pending = loadTopicDiscussions({ ...settings, signal: controller.signal, fetchImpl: async () => new Promise(() => {}) });
  controller.abort();
  await assert.rejects(pending, { code: 'ABORTED' });
  await assert.rejects(loadTopicDiscussions({ ...settings, signal: controller.signal, fetchImpl: async () => { assert.fail('aborted request must not fetch'); } }), { code: 'ABORTED' });
});

test('refreshes fetch again rather than serving a stale in-memory discussion copy', async () => {
  let calls = 0;
  const fetchImpl = async () => response([issue(++calls)]);
  assert.equal((await loadTopicDiscussions({ ...settings, fetchImpl })).posts[0].number, 1);
  assert.equal((await loadTopicDiscussions({ ...settings, fetchImpl })).posts[0].number, 2);
});
