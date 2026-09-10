import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQuickContributionDraft, maxContributionUrlLength } from '../community/pages-ui/contributions.js';

const repository = 'SyntheticOwner/public-guide-feedback';
const snapshot = { site: { contributionsRepository: repository, publicUrl: 'https://guide.example/project/' } };
const topic = { id: 'course-first-tip', catalogTopicId: 'topic-learning', title: '给刚开始上课的自己一句提醒' };
const values = { content: '我在第一次作业才发现要先学 Git。\n不用先找官方证明 📚 &body=oops #notes', public: true };
const article = { id: 'article-1', revisionId: 'article-1-v2', revisionNumber: 2, title: '公开的课程经验' };

test('a quick share needs only content and consent, with an exact topic marker and generated title', () => {
  const draft = buildQuickContributionDraft({ snapshot, topic, values });
  assert.equal(draft.title, `[经验共建] ${topic.title}`);
  assert.ok(draft.body.includes(values.content));
  assert.ok(draft.body.startsWith('<!-- xjtlu-topic:course-first-tip -->\n'));
  assert.match(draft.body, /知识分类 ID：topic-learning/u);
  assert.doesNotMatch(draft.body, /来源性质|学期 \/ 发生时间|补充背景/u);
  assert.match(draft.body, /GitHub 用户名和这段正文会公开/u);
  const url = new URL(draft.url);
  assert.equal(url.origin + url.pathname, `https://github.com/${repository}/issues/new`);
  assert.equal(url.searchParams.get('body'), draft.body);
  assert.equal(url.searchParams.get('title'), draft.title);
  assert.equal(url.searchParams.get('template'), 'website-contribution.md');
  assert.equal(draft.requiresPaste, false);
  assert.equal(draft.tooLong, false);
  assert.equal(draft.state, 'unsubmitted');
});

test('optional context preserves firsthand and unverified experiences, links and custom titles', () => {
  const extra = { sourceNature: '听他人说过，尚未核实', campus: '太仓', time: '2026 秋季', source: '同组同学提到；https://example.com/?a=1&b=2', title: '我还没核实的一条线索' };
  const draft = buildQuickContributionDraft({ snapshot, topic, article, values: { ...values, ...extra } });
  for (const [key, value] of Object.entries(extra)) assert.ok((key === 'title' ? draft.title : draft.body).includes(value));
  assert.match(draft.body, /文章 ID：article-1/u);
  assert.match(draft.body, /阅读版本：article-1-v2（第 2 版）/u);
  assert.ok(draft.body.includes('https://guide.example/project/#/answers/article-1'));
});

test('blank content or absent public confirmation cannot produce a submission destination', () => {
  for (const content of ['', ' \n\t ']) assert.throws(() => buildQuickContributionDraft({ snapshot, topic, values: { ...values, content } }), /先写一点/u);
  for (const consent of [undefined, false, 'true', 1]) assert.throws(() => buildQuickContributionDraft({ snapshot, topic, values: { ...values, public: consent } }), /GitHub 用户名和正文可以公开/u);
  assert.throws(() => buildQuickContributionDraft({ snapshot, topic }), /先写一点/u);
});

test('markers and destination reject invalid context and unsafe repositories', () => {
  for (const id of ['', '<!-- bad -->', 'topic\n<!-- xjtlu-topic:other -->', '../secret']) {
    assert.throws(() => buildQuickContributionDraft({ snapshot, topic: { ...topic, id }, values }), /有效的共建话题/u);
  }
  for (const invalid of ['', 'https://github.com/a/b', 'owner/..', 'owner/repo?token=secret', 'owner/repo/more']) {
    assert.throws(() => buildQuickContributionDraft({ repository: invalid, topic, values }), /暂未开放/u);
  }
  assert.throws(() => buildQuickContributionDraft({ snapshot, topic, article: { ...article, id: 'bad\nid' }, values }), /关联文章无效/u);
});

test('optional public article links never include credentials or a non-HTTPS scheme', () => {
  for (const publicUrl of ['javascript:alert(1)', 'https://name:secret@example.com/', 'http://guide.example/']) {
    const draft = buildQuickContributionDraft({ snapshot: { site: { contributionsRepository: repository, publicUrl } }, topic, article, values });
    assert.match(draft.body, /文章 ID：article-1/u);
    assert.doesNotMatch(draft.body, /javascript:|name:secret|http:\/\/guide/u);
  }
});

test('reply drafts keep complete reply context and use the original issue without invented prefill parameters', () => {
  const reply = { number: 42, url: `https://github.com/${repository}/issues/42#issuecomment-123`, id: 'comment-123', author: 'student', body: 'Original text must not be recopied automatically.' };
  const draft = buildQuickContributionDraft({ snapshot, topic, article, reply, values });
  assert.equal(draft.mode, 'reply');
  assert.equal(draft.requiresPaste, true);
  assert.equal(draft.state, 'unsubmitted');
  assert.equal(draft.url, reply.url);
  assert.equal(new URL(draft.url).search, '');
  assert.match(draft.body, /### 我的回复/u);
  assert.ok(draft.body.includes(values.content));
  assert.ok(draft.body.includes(`回复原讨论：${reply.url}`));
  assert.match(draft.body, /回复对象 ID：comment-123/u);
  assert.doesNotMatch(draft.body, /Original text must not be recopied/u);
  assert.equal(buildQuickContributionDraft({ snapshot, topic, values, reply: { number: 42 } }).url, `https://github.com/${repository}/issues/42`);
});

test('reply destinations cannot redirect a prepared response to a different repository or issue', () => {
  for (const url of ['javascript:alert(1)', `https://github.com/OtherOwner/other/issues/42`, `https://github.com/${repository}/issues/43`, `https://github.com/${repository}/issues/42?body=changed`, `https://name:secret@github.com/${repository}/issues/42`, `https://github.com/${repository}/issues/42#anything`]) {
    assert.throws(() => buildQuickContributionDraft({ snapshot, topic, values, reply: { number: 42, url } }), /原讨论链接/u);
  }
  for (const number of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => buildQuickContributionDraft({ snapshot, topic, values, reply: { number } }), /可以回复的 GitHub 讨论/u);
  }
});

test('long shares and replies keep the entire text and never claim to have submitted it', () => {
  const content = '完整长文与真实经历。📚\n'.repeat(2000);
  const draft = buildQuickContributionDraft({ snapshot, topic, values: { ...values, content } });
  assert.equal(draft.tooLong, true);
  assert.equal(draft.requiresPaste, true);
  assert.ok(draft.url.length > maxContributionUrlLength);
  assert.ok(draft.fallbackUrl.length < maxContributionUrlLength);
  assert.ok(draft.body.includes(content.trim()));
  assert.equal(new URL(draft.url).searchParams.get('body'), draft.body);
  assert.equal(new URL(draft.fallbackUrl).searchParams.has('body'), false);
  const reply = buildQuickContributionDraft({ snapshot, topic, reply: { number: 42 }, values: { ...values, content } });
  assert.ok(reply.body.includes(content.trim()));
  assert.equal(reply.requiresPaste, true);
  assert.equal(reply.state, 'unsubmitted');
});

test('even an overlong custom title is preserved with a safe short fallback destination', () => {
  const title = '完整标题'.repeat(1000);
  const draft = buildQuickContributionDraft({ snapshot, topic, values: { ...values, title } });
  assert.equal(draft.title, title);
  assert.equal(draft.tooLong, true);
  assert.ok(draft.fallbackUrl.length < maxContributionUrlLength);
  assert.equal(new URL(draft.fallbackUrl).searchParams.has('title'), false);
  assert.equal(new URL(draft.url).searchParams.get('title'), title);
});
