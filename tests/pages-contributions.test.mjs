import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildContributionDraft, contributionArticle, maxContributionUrlLength, validContributionsRepository } from '../community/pages-ui/contributions.js';

const values = { type: 'new', title: '图书馆 & 自习 📚', content: '第一段\n第二段含 # 与 &body= 不应改写参数', source: 'https://example.com/?a=1&b=2', campus: '两校区均适用', audience: '新生', time: '2026 年 9 月', ai: '未使用', public: true };
const repository = 'SyntheticOwner/public-guide-feedback';
const snapshot = { site: { publicUrl: 'https://guide.example/project/' }, answers: [{ id: 'article-1', revisionId: 'article-1-v2', revisionNumber: 2, title: '当前公开文章' }] };

test('draft URLs preserve complete Unicode text, Markdown and newlines for every contribution type', () => {
  for (const [type, prefix] of [['new', '新资料'], ['correction', '纠错'], ['experience', '个人经验']]) {
    const draft = buildContributionDraft({ repository, values: { ...values, type } });
    const url = new URL(draft.url);
    assert.equal(url.origin + url.pathname, `https://github.com/${repository}/issues/new`);
    assert.deepEqual([...url.searchParams.keys()], ['template', 'title', 'body']);
    assert.equal(url.searchParams.get('template'), 'website-contribution.md');
    assert.equal(url.searchParams.get('title'), `[${prefix}] ${values.title}`);
    assert.equal(url.searchParams.get('body'), draft.body);
    for (const field of ['content', 'source', 'campus', 'audience', 'time', 'ai']) assert.ok(draft.body.includes(values[field]));
    assert.match(draft.body, /公开提交确认/u);
    assert.equal(draft.tooLong, false);
  }
});

test('drafts use only current public article context and ignore forged route values', () => {
  const article = contributionArticle(snapshot, new URLSearchParams({ article: 'article-1', revision: 'private-draft', context: 'private-note' }));
  const draft = buildContributionDraft({ repository, values, article });
  assert.ok(draft.body.includes('https://guide.example/project/#/answers/article-1'));
  assert.ok(draft.body.includes('article-1-v2'));
  assert.doesNotMatch(draft.body, /private-draft|private-note/u);
  assert.equal(contributionArticle(snapshot, new URLSearchParams({ article: 'unknown-private' })), null);
  for (const publicUrl of ['javascript:alert(1)', 'https://name:secret@example.com/']) {
    assert.equal(contributionArticle({ ...snapshot, site: { publicUrl } }, new URLSearchParams({ article: 'article-1' })).url, '');
  }
});

test('supplement drafts require a public parent and describe its current version as a child branch', () => {
  const parameters = new URLSearchParams({ article: 'article-1', revision: 'forged-private-version', type: 'supplement' });
  const article = contributionArticle(snapshot, parameters);
  const draft = buildContributionDraft({ repository, values: { ...values, type: 'supplement' }, article });
  assert.equal(draft.title, `[补充] ${values.title}`);
  assert.match(draft.body, /### 补充内容/u);
  assert.match(draft.body, /补充父陈述 ID：article-1/u);
  assert.match(draft.body, /父陈述公开版本：article-1-v2（第 2 版）/u);
  assert.match(draft.body, /作为其下级分支/u);
  assert.doesNotMatch(draft.body, /forged-private-version/u);
  assert.equal(new URL(draft.url).searchParams.get('body'), draft.body);
  for (const invalid of [null, { answer: {} }, { answer: { id: 'article-1', revisionId: '', revisionNumber: 1 } }, { answer: { id: 'article-1', revisionId: 'article-1-v2', revisionNumber: 0 } }]) {
    assert.throws(() => buildContributionDraft({ repository, values: { ...values, type: 'supplement' }, article: invalid }), /选择要补充的陈述/u);
  }
  assert.throws(() => buildContributionDraft({ repository, values: { ...values, type: 'supplement', source: '' }, article }), /必填/u);
});

test('drafts require fields and public confirmation, with source optional only for corrections', () => {
  for (const field of ['title', 'content', 'source', 'campus', 'audience', 'time', 'ai']) assert.throws(() => buildContributionDraft({ repository, values: { ...values, [field]: '  ' } }), /必填/u);
  assert.throws(() => buildContributionDraft({ repository, values: { ...values, public: false } }), /可以公开/u);
  assert.throws(() => buildContributionDraft({ repository, values: { ...values, type: '__proto__' } }), /投稿类型/u);
  assert.match(buildContributionDraft({ repository, values: { ...values, type: 'correction', source: '' } }).body, /暂未提供/u);
  for (const invalid of ['', 'https://github.com/a/b', 'owner/..', 'owner/repo?token=secret', 'owner/repo/more']) {
    assert.equal(validContributionsRepository(invalid), false);
    assert.throws(() => buildContributionDraft({ repository: invalid, values }), /暂未开放/u);
  }
});

test('overlong URLs preserve the full draft and offer a short title-only destination', () => {
  const content = '完整的长篇经验。'.repeat(1000);
  const draft = buildContributionDraft({ repository, values: { ...values, content } });
  assert.equal(draft.tooLong, true);
  assert.ok(draft.url.length > maxContributionUrlLength);
  assert.ok(draft.body.includes(content));
  const fallback = new URL(draft.fallbackUrl);
  assert.equal(fallback.searchParams.has('body'), false);
  assert.equal(fallback.searchParams.get('title'), draft.title);
});

test('the website destination is a Markdown template with no second required form', async () => {
  const template = await readFile(new URL('../.github/ISSUE_TEMPLATE/website-contribution.md', import.meta.url), 'utf8');
  assert.match(template, /^---\r?\nname:/u);
  assert.doesNotMatch(template, /validations:|required:|\[ \]/u);
  assert.match(template, /完整正文/u);
});
