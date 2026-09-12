import { renderContribution as renderContributionForm, mountQuickContribution } from './contributions.js';
import { renderBranches } from './branches.js';
import { withBranchAncestors } from './branch-model.js';
import { searchAnswers, searchCollections, scopeText } from './search.js';
import { validateTopicsConfig } from './topic-model.js';
import { mountCommunity, communityTopics } from './community.js';

const $ = id => document.getElementById(id);
const make = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
};
let snapshot;
let topicsConfig = { schemaVersion: 1, topics: [] };
let listHash = '#/answers?view=list';
let mountedCommunity, mountedQuick;
let previousHash;
const positions = new Map();
const date = value => {
  if (!value) return '未注明';
  const parsed = new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString('zh-CN') : '未注明';
};
const answerHash = answer => '#/answers/' + encodeURIComponent(answer.id) + listHash.slice(listHash.indexOf('?'));
const supplementHash = answer => '#/contribute?' + new URLSearchParams({ article: answer.id, revision: answer.revisionId, type: 'supplement' });
function directoryParameters(parameters) {
  const result = new URLSearchParams({ view: parameters.get('view') === 'branches' ? 'branches' : 'list' });
  if (parameters.get('query')?.trim()) result.set('query', parameters.get('query'));
  if (snapshot.catalog.topics.some(topic => topic.id === parameters.get('topic'))) result.set('topic', parameters.get('topic'));
  return result;
}
const sourceLabels = { university_official: '学校官方', user_provided: '用户提供', web: '网络资料' };
const universalScopeLabels = { campus: '两校区通用入口', audience: '学生通用入口', academic_year: '不限学年' };
function renderSourceCategories(answer) {
  const group = make('div', undefined, 'source-categories');
  group.setAttribute('aria-label', '材料来源');
  for (const category of answer.sourceCategories ?? []) {
    if (!sourceLabels[category]) continue;
    const badge = make('span', sourceLabels[category], 'source-category');
    badge.dataset.sourceCategory = category;
    group.append(badge);
  }
  return group;
}

function message(text = '') {
  $('message').textContent = text;
  $('message').hidden = !text;
}

function show(view) {
  for (const element of document.querySelectorAll('.view')) element.hidden = element.id !== `${view}-view`;
  for (const [id, selected] of [['discover-nav', ['discover', 'topic'].includes(view)], ['answers-nav', ['answers', 'detail', 'missing'].includes(view)], ['contribute-nav', ['contribute', 'share'].includes(view)], ['about-nav', view === 'about']]) {
    if (selected) $(id).setAttribute('aria-current', 'page');
    else $(id).removeAttribute('aria-current');
  }
}

function safeLink(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

function warnings(target, answer) {
  const values = [...(answer.warnings ?? [])];
  const due = Date.parse(answer.reviewDueAt);
  if (Number.isFinite(due) && Date.now() > due && !values.some(text => /待复核|已超过维护周期|已超过复核期限/u.test(text))) {
    values.push('待复核：已超过维护周期，请先核对原站。');
  }
  for (const text of values) target.append(make('p', text, 'warning'));
}

function renderEdition() {
  const guide = snapshot.mode !== 'public-demo';
  const approved = guide && snapshot.answers.some(answer => answer.reviewStatus === 'approved');
  const collected = snapshot.answers.some(answer => answer.reviewStatus === 'collected');
  const demos = snapshot.answers.some(answer => answer.demo);
  const empty = guide && !snapshot.answers.length;
  $('edition-label').textContent = collected || approved || empty ? '校园资料与共同记录' : '公开演示';
  $('edition-note').textContent = empty ? '暂无已发布内容' : collected ? '资料整理内容待人工核验 · 非学校官方信息' : approved
    ? demos ? '含审核文章和演示内容 · 非学校官方信息' : '经人工审核 · 非学校官方信息'
    : '示范内容，不代表学校官方信息';
  $('about-content-title').textContent = empty ? '暂无已发布内容' : collected ? '资料整理与核验状态' : approved ? demos ? '审核文章与演示内容' : '已审核内容' : '示范内容';
  $('about-content-description').textContent = empty ? '目前没有可供阅读的已发布文章。'
    : collected
      ? '手册包含按公开来源整理的校园信息，资料整理日期会在文章中标明。标有「待人工核验」的内容由 AI 辅助整理，尚未逐条人工核验，请对照原始来源确认具体安排。'
        + (approved ? '已经人工审核的文章会单独标注核验日期。' : '')
        + (demos ? '演示文章另有明确标注。' : '')
    : approved
      ? '这里收录已由编辑审核并发布的校园信息，保留逐句来源、适用范围和复核时间。AI 辅助整理的内容在详情中注明。'
        + (demos ? '其中标有「演示内容」的文章，请结合其单独说明阅读。' : '')
        + '编辑审核不代替学校的正式通知，具体事项请向相关部门核实。'
      : '本页公开展示项目中的示范答案及其原始来源。示范答案尚不代表真实试点的正式审核结果，不能作为选课、入学或其他重要决定的唯一依据。具体事项请向学校相关部门核实。';
  $('about-snapshot-description').textContent = guide
    ? (collected ? '这是按当前发布清单生成的公开快照。' : '这是从本地已发布内容同步的公开快照。')
      + '资料的后续修改、隐藏或撤回，需要再次同步后才会反映到此站点。话题中的公开投稿与回复则直接从 GitHub 读取，可手动刷新。此处可阅读及填写公开投稿，发布需跳转 GitHub；不接收账户登录、私件投稿或研究活动记录。学校网站由其各自的维护方提供。'
    : '此版本仅包含构建时可公开的示范内容，不接收账户登录、私件投稿或研究活动记录。学校网站由其各自的维护方提供。';
}

function renderCollectionResults(collections) {
  let section = $('collection-results');
  if (!section) {
    section = make('section'); section.id = 'collection-results';
    section.setAttribute('aria-labelledby', 'collection-results-title');
    $('directory-empty').after(section);
  }
  section.replaceChildren();
  section.hidden = !collections.length;
  if (!collections.length) return;
  const heading = make('h2', '来源整理'); heading.id = 'collection-results-title';
  const count = make('p', `${collections.length} 条相关话题`, 'muted'); count.setAttribute('aria-live', 'polite');
  const list = make('div', undefined, 'topic-grid');
  for (const topic of collections) {
    const item = make('article', undefined, 'topic-card collection-result');
    const title = make('h3'), link = make('a', topic.title);
    link.href = '#/topics/' + encodeURIComponent(topic.id); title.append(link);
    item.append(make('p', snapshot.catalog.topics.find(row => row.id === topic.catalogTopicId)?.titleZh ?? '校园信息', 'eyebrow'),
      title, make('p', topic.prompt, 'topic-prompt'), make('p', `${topic.sources.length} 项来源 · 待人工核验`, 'metadata'));
    list.append(item);
  }
  section.append(heading, count, list);
}

function renderList(parameters) {
  const view = parameters.get('view') === 'branches' ? 'branches' : 'list';
  const query = parameters.get('query') ?? '', topic = parameters.get('topic') ?? '';
  $('query').value = query;
  $('topic').value = snapshot.catalog.topics.some(value => value.id === topic) ? topic : '';
  const selectedTopic = snapshot.catalog.topics.find(value => value.id === $('topic').value);
  $('topic-description').textContent = selectedTopic?.description ?? '还没有具体问题？选一个主题，看看有哪些已整理的资料。';
  const filtered = Boolean(query.trim() || selectedTopic);
  $('reset-filters').hidden = !filtered;
  $('directory-context').textContent = filtered
    ? [query.trim() ? `关键词「${query.trim()}」` : '', selectedTopic?.titleZh].filter(Boolean).join(' · ')
    : '全部已整理资料 · 选择标题开始阅读';
  const answers = searchAnswers(snapshot, query, $('topic').value);
  const collections = searchCollections(snapshot, topicsConfig, query, $('topic').value);
  $('count').textContent = `${answers.length} 条答案`;
  $('branches-mode').setAttribute('aria-pressed', String(view === 'branches'));
  $('list-mode').setAttribute('aria-pressed', String(view === 'list'));
  $('directory-branches').hidden = view !== 'branches';
  $('branches-description').hidden = view !== 'branches';
  $('answer-list').hidden = view !== 'list';
  $('answer-list').replaceChildren();
  $('directory-branches').replaceChildren();
  if (view === 'branches' && answers.length) renderBranches($('directory-branches'), {
    answers: withBranchAncestors(snapshot.answers, answers), topics: snapshot.catalog.topics, links: snapshot.links ?? [],
    answerHref: answerHash, contributionHref: supplementHash, topicId: $('topic').value, scopes: snapshot.catalog.scopes, expandTopics: Boolean(query.trim()),
  });
  for (const answer of view === 'list' ? answers : []) {
    const item = make('article', undefined, 'answer-item');
    item.dataset.reviewStatus = answer.reviewStatus ?? (answer.demo ? 'demo' : '');
    const link = make('a'); link.href = answerHash(answer);
    link.append(make('h3', answer.title));
    item.append(make('span', answer.topic?.title ?? '校园信息', 'topic-label'), link, make('p', answer.summary));
    const readAction = make('span', '阅读资料 →', 'answer-read-action'); readAction.setAttribute('aria-hidden', 'true');
    link.append(readAction);
    item.append(renderSourceCategories(answer));
    item.append(make('p', scopeText(answer, snapshot.catalog), 'scope-label'));
    const collected = answer.reviewStatus === 'collected';
    item.append(make('span', `${collected ? '资料整理 ' + date(answer.researchedAt) : '核验 ' + date(answer.verifiedAt)} · ${(answer.citations ?? []).length} 项来源`, 'metadata'));
    if (collected) item.append(make('span', ' · 待人工核验', 'collected-status'));
    if (answer.demo) item.append(make('span', ' · 演示内容', 'demo'));
    warnings(item, answer);
    $('answer-list').append(item);
  }
  const empty = $('directory-empty');
  empty.replaceChildren();
  empty.hidden = Boolean(answers.length);
  if (!answers.length) {
    const heading = make('h2', filtered ? '这次还没找到匹配的文章' : '这里还没有已发布的文章'); heading.id = 'directory-empty-title';
    empty.append(heading, make('p', collections.length
      ? '暂无符合条件的公开答案。下方有相关来源整理话题，可以先查看其中的资料与线索。'
      : filtered ? '暂无符合条件的公开答案。试试更短的关键词，例如“宿舍”；也可以清除主题筛选，扩大查找范围。'
        : '你仍可以从探索页查看话题与公开来源，或留下想了解的问题。'));
    const actions = make('div', undefined, 'empty-actions');
    if (filtered) {
      const reset = make('button', '清除筛选，浏览全部资料', 'secondary'); reset.type = 'button';
      reset.addEventListener('click', resetFilters); actions.append(reset);
    }
    const discover = make('a', '看看可以探索什么 →'); discover.href = '#/discover';
    const ask = make('a', '留下问题或经验'); ask.href = '#/share';
    actions.append(discover, ask); empty.append(actions);
  }
  renderCollectionResults(collections);
  show('answers');
}

function renderDetail(answer, parameters = new URLSearchParams()) {
  const target = $('answer-detail');
  const originTopic = communityTopics(snapshot, topicsConfig).find(topic => topic.id === parameters.get('fromTopic') && topic.catalogTopicId === answer.topic?.id);
  const fromDiscover = !originTopic && parameters.get('from') === 'discover' && !['view', 'query', 'topic'].some(key => parameters.has(key));
  const detailHref = value => originTopic ? '#/answers/' + encodeURIComponent(value.id) + '?' + new URLSearchParams({ fromTopic: originTopic.id })
    : fromDiscover ? '#/answers/' + encodeURIComponent(value.id) + '?from=discover' : answerHash(value);
  target.replaceChildren(make('p', answer.topic?.title ?? '校园信息', 'eyebrow'), make('h1', answer.title));
  const summary = typeof answer.summary === 'string' ? answer.summary.trim() : '';
  const firstParagraph = String(answer.sentences?.[0]?.text ?? '').replace(/\s+/gu, '');
  if (summary && !firstParagraph.includes(summary.replace(/\s+/gu, ''))) target.append(make('p', summary, 'reader-summary directory-intro'));
  const body = make('section', undefined, 'reader-body'); body.id = 'reader-body';
  const evidence = make('section', undefined, 'reader-evidence'); evidence.id = 'reader-evidence';
  const next = make('section', undefined, 'reader-next'); next.id = 'reader-next';
  const readingNavigation = make('nav', undefined, 'reader-navigation');
  readingNavigation.setAttribute('aria-label', '文章阅读导航');
  for (const [label, destination] of [['正文', body], ['来源说明', evidence], ['继续阅读', next]]) {
    const jump = make('button', label, 'secondary'); jump.type = 'button';
    jump.setAttribute('aria-controls', destination.id);
    jump.addEventListener('click', () => focusSection(destination));
    readingNavigation.append(jump);
  }
  target.append(readingNavigation);
  const parent = snapshot.answers.find(value => value.id === answer.supplementTo && value.id !== answer.id && value.topic?.id === answer.topic?.id);
  if (parent) {
    const context = make('p', '这条信息补充了：', 'supplement-parent');
    const link = make('a', parent.title); link.href = detailHref(parent);
    context.append(link);
    target.append(context);
  }
  const metadata = make('div', undefined, 'detail-meta');
  const collected = answer.reviewStatus === 'collected';
  for (const text of [`第 ${answer.revisionNumber} 版`, `信息截至 ${date(answer.asOf)}`,
    collected ? `资料整理 ${date(answer.researchedAt)}` : `人工核验 ${date(answer.verifiedAt)}`,
    collected ? '待人工核验' : answer.reviewOwnerLabel, `复核期限 ${date(answer.reviewDueAt)}`]) {
    if (text) metadata.append(make('span', text));
  }
  // Detailed dates stay available below the content; the essential review status stays above it.
  target.append(renderSourceCategories(answer));
  if (answer.demo) target.append(make('p', answer.reviewStatus === 'approved' ? '演示内容，已完成人工审核。' : '演示内容，真实试点前需重新审核。', 'warning'));
  if (collected) target.append(make('p', '整理方式：AI 辅助资料整理，尚未逐条人工核验。', 'warning collected-notice'));
  else if (answer.originalOrigin === 'ai_draft') target.append(make('p', answer.reviewStatus === 'approved'
    ? '整理方式：AI 辅助初稿，经人工审核确认。' : '整理方式：AI 辅助整理。', 'muted'));
  else if (answer.reviewStatus === 'approved' && !answer.demo) target.append(make('p', '核验状态：已人工核验。', 'muted'));
  const notes = make('div', undefined, 'article-notes');
  warnings(notes, answer);
  const scope = Object.entries(answer.scope ?? {}).flatMap(([dimension, values]) => values.map(value => snapshot.catalog.scopes.find(item => item.dimension === dimension && (item.id === value || item.code === value))?.labelZh
    ?? (value === 'universal' ? universalScopeLabels[dimension] ?? '通用' : value)));
  target.append(make('p', `适用范围：${scope.join(' · ') || '尚未明确'}`, 'muted'));
  if (answer.evidenceNote) notes.append(make('p', answer.evidenceNote, 'warning'));
  const bodyHeading = make('h2', '正文', 'reader-section-title'); bodyHeading.id = 'reader-body-title';
  body.setAttribute('aria-labelledby', bodyHeading.id); body.append(bodyHeading);
  target.append(body);
  for (const sentence of answer.sentences ?? []) {
    const paragraph = make('p', sentence.text, 'answer-body'); paragraph.id = 'sentence-' + sentence.id;
    body.append(paragraph);
    const sources = (answer.citations ?? []).filter(value => value.sentenceId === sentence.id);
    const sourceDetails = make('details', undefined, 'sentence-sources');
    sourceDetails.append(make('summary', `查看这段的 ${sources.length} 项原始来源`));
    for (const citation of (answer.citations ?? []).filter(value => value.sentenceId === sentence.id)) {
      const box = make('div', undefined, 'citation');
      const href = safeLink(citation.url);
      const title = make(href ? 'a' : 'span', citation.title ?? '原始来源');
      if (href) { title.href = href; title.target = '_blank'; title.rel = 'noopener noreferrer'; }
      if (sourceLabels[citation.sourceCategory]) {
        const badge = make('span', sourceLabels[citation.sourceCategory], 'source-category');
        badge.dataset.sourceCategory = citation.sourceCategory;
        box.append(badge, document.createTextNode(' '));
      }
      box.append(title, make('span', citation.mode === 'link-only' ? ' · 原站链接' : ' · 授权摘录', 'muted'));
      if (citation.publisher) box.append(make('span', ` · 发布方：${citation.publisher}`, 'muted'));
      if (citation.excerpt) box.append(make('p', citation.excerpt));
      sourceDetails.append(box);
    }
    if (sources.length) body.append(sourceDetails);
  }
  const evidenceHeading = make('h2', '来源与核验说明'); evidenceHeading.id = 'reader-evidence-title';
  evidence.setAttribute('aria-labelledby', evidenceHeading.id);
  evidence.append(evidenceHeading, make('p', body.querySelector('.sentence-sources')
    ? '有来源的段落下方可以展开原始材料。办理具体事项前，请核对原文中的适用条件和最新安排。'
    : '当前公开快照没有附逐段来源链接。办理具体事项前，请向相关部门核实适用条件和最新安排。', 'muted'), metadata, notes);
  if (body.querySelector('.sentence-sources')) {
    const openSources = make('button', '展开正文中的原始来源', 'secondary reader-source-action'); openSources.type = 'button';
    openSources.addEventListener('click', () => {
      for (const details of body.querySelectorAll('.sentence-sources')) details.open = true;
      focusSection(body.querySelector('.sentence-sources summary'));
    });
    evidence.append(openSources);
  }
  if (answer.history?.length) {
    const historyDetails = make('details', undefined, 'reader-history');
    historyDetails.append(make('summary', '公开版本记录'));
    const history = make('div', undefined, 'history');
    for (const revision of answer.history) history.append(make('span', `第 ${revision.number} 版${revision.id === answer.revisionId ? ' · 当前快照' : ''}`));
    historyDetails.append(history); evidence.append(historyDetails);
  }
  target.append(evidence);
  const nextHeading = make('h2', '接下来，可以继续看'); nextHeading.id = 'reader-next-title';
  next.setAttribute('aria-labelledby', nextHeading.id); next.append(nextHeading);
  const relatedIds = new Set([answer.id]);
  const related = snapshot.answers.filter(value => {
    if (!answer.topic?.id || value.topic?.id !== answer.topic.id || relatedIds.has(value.id)) return false;
    relatedIds.add(value.id); return true;
  }).slice(0, 3);
  if (related.length) {
    next.append(make('p', `这些资料也属于「${answer.topic?.title ?? '校园信息'}」，可以从感兴趣的一篇接着读。`, 'muted'));
    const list = make('div', undefined, 'reader-next-list');
    for (const value of related) {
      const item = make('article', undefined, 'reader-next-item'); item.dataset.answerId = value.id;
      const title = make('h3'), link = make('a', value.title); link.href = detailHref(value); title.append(link);
      item.append(title, make('p', value.summary, 'muted'));
      list.append(item);
    }
    next.append(list);
  } else next.append(make('p', '这个主题暂时没有其他文章。可以回到资料目录，或换个校园场景继续探索。', 'muted'));
  const nextActions = make('div', undefined, 'reader-next-actions');
  const browse = make('a', related.length ? '查看这个主题的全部资料 →' : '去资料目录看看 →');
  browse.href = '#/answers?' + new URLSearchParams({ view: 'list', ...(related.length && answer.topic?.id ? { topic: answer.topic.id } : {}) });
  const discover = make('a', '换个场景探索'); discover.href = '#/discover';
  nextActions.append(browse, discover); next.append(nextActions); target.append(next);
  const contribution = make('section', undefined, 'contribution-prompt');
  const supplementLink = make('a', '补充这条信息', 'contribution-link');
  supplementLink.href = supplementHash(answer);
  const contributionLink = make('a', '补充/更正这篇', 'contribution-link secondary');
  contributionLink.href = '#/contribute?' + new URLSearchParams({ article: answer.id, revision: answer.revisionId });
  const actions = make('div', undefined, 'contribution-actions');
  actions.append(supplementLink, contributionLink);
  contribution.append(make('h2', '发现缺漏，或有不同经历？'), make('p', '补充一条信息、指出过期内容，或分享你实际遇到的情况。经编辑核对后，补充可成为这条资料的下级分支。'), actions);
  target.append(contribution);
  const linkedTopic = originTopic ?? communityTopics(snapshot, topicsConfig).find(topic => topic.id === answer.topic?.id);
  if (linkedTopic) {
    const discussionLink = make('a', '查看这个话题的原始讨论 →'); discussionLink.href = '#/topics/' + encodeURIComponent(linkedTopic.id);
    const discussion = make('p', undefined, 'reader-discussion-link'); discussion.append(discussionLink); contribution.append(discussion);
    const quickDetails = make('details', undefined, 'reader-share'); quickDetails.id = 'reader-share';
    quickDetails.append(make('summary', '写下我的经历或补充'));
    const quick = make('div'); quickDetails.append(quick); contribution.append(quickDetails);
    let quickMounted = false;
    quickDetails.addEventListener('toggle', () => {
      if (!quickDetails.open || !quickDetails.isConnected || $('detail-view').hidden || quickMounted) return;
      mountedQuick = mountQuickContribution(quick, { snapshot, topic: linkedTopic, article: answer });
      quickMounted = true;
    });
  }
  renderBranches($('answer-branches'), {
    answers: snapshot.answers.filter(value => value.topic?.id === answer.topic?.id),
    topics: snapshot.catalog.topics, links: snapshot.links ?? [], selectedId: answer.id,
    answerHref: detailHref, contributionHref: supplementHash, topicId: answer.topic?.id, scopes: snapshot.catalog.scopes,
  });
  $('back-to-list').href = originTopic ? '#/topics/' + encodeURIComponent(originTopic.id) : fromDiscover ? '#/discover' : listHash;
  $('back-to-list').textContent = originTopic ? '← 回到话题与讨论' : fromDiscover ? '← 回到开始探索' : '← 返回资料目录';
  show('detail');
}

function focusSection(target) {
  if (!target) return;
  if (!target.matches('button, a, summary, input, textarea, select')) target.tabIndex = -1;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'start', behavior: 'instant' });
}

function renderContribution(parameters) {
  renderContributionForm(snapshot, parameters);
  show('contribute');
}

function route({ scroll = true } = {}) {
  if (!snapshot) return;
  if (!location.hash) history.replaceState(null, '', '#/discover');
  if (previousHash && scroll) positions.set(previousHash, { y: window.scrollY, href: document.activeElement?.getAttribute('href') });
  mountedCommunity?.destroy(); mountedCommunity = null;
  mountedQuick?.destroy(); mountedQuick = null;
  message();
  const raw = location.hash.slice(1) || '/discover';
  const split = raw.indexOf('?');
  const path = split < 0 ? raw : raw.slice(0, split);
  const parameters = new URLSearchParams(split < 0 ? '' : raw.slice(split + 1));
  if (path === '/discover' || path === '/') {
    mountedCommunity = mountCommunity($('community-home'), { snapshot, config: topicsConfig });
    show('discover'); document.title = `开始探索 | ${snapshot.site.name}`;
  } else if (path.startsWith('/topics/')) {
    let topicId; try { topicId = decodeURIComponent(path.slice('/topics/'.length)); } catch { topicId = 'invalid'; }
    mountedCommunity = mountCommunity($('community-topic'), { snapshot, config: topicsConfig, topicId, parameters });
    show('topic'); document.title = `${communityTopics(snapshot, topicsConfig).find(topic => topic.id === topicId)?.title ?? '共建话题'} | ${snapshot.site.name}`;
  } else if (path === '/share') {
    const topics = communityTopics(snapshot, topicsConfig);
    $('share-topic').replaceChildren(...topics.map(topic => { const option = make('option', topic.title); option.value = topic.id; return option; }));
    if (topics.some(topic => topic.id === parameters.get('topic'))) $('share-topic').value = parameters.get('topic');
    const topic = topics.find(topic => topic.id === $('share-topic').value);
    if (topic) mountedQuick = mountQuickContribution($('share-composer'), { snapshot, topic });
    show('share'); document.title = `分享经验 | ${snapshot.site.name}`;
  } else if (path === '/about') {
    show('about'); document.title = `关于本指南 | ${snapshot.site.name}`;
  } else if (path === '/contribute') {
    renderContribution(parameters); document.title = `补充信息 | ${snapshot.site.name}`;
  } else if (path === '/answers') {
    listHash = '#/answers?' + directoryParameters(parameters);
    renderList(parameters); document.title = `查资料 | ${snapshot.site.name}`;
  } else {
    let id;
    try { id = path.startsWith('/answers/') ? decodeURIComponent(path.slice('/answers/'.length)) : null; } catch { id = null; }
    const answer = snapshot.answers.find(value => value.id === id);
    if (answer) {
      if (['view', 'query', 'topic'].some(key => parameters.has(key))) listHash = '#/answers?' + directoryParameters(parameters);
      renderDetail(answer, parameters); document.title = `${answer.title} | ${snapshot.site.name}`;
    }
    else { $('answer-detail').replaceChildren(); show('missing'); document.title = `未找到公开答案 | ${snapshot.site.name}`; }
  }
  $('answers-nav').href = listHash;
  if (scroll) {
    const restored = positions.get(location.hash);
    const visible = document.querySelector('.view:not([hidden])');
    const prior = restored?.href ? [...visible.querySelectorAll('a')].find(link => link.getAttribute('href') === restored.href) : null;
    const focus = prior ?? visible.querySelector('h1');
    if (focus) { focus.tabIndex = -1; focus.focus({ preventScroll: true }); }
    window.scrollTo({ top: restored?.y ?? 0, behavior: 'instant' });
  }
  previousHash = location.hash;
}

function search(view) {
  const parameters = new URLSearchParams({ view: typeof view === 'string' ? view : $('list-mode').getAttribute('aria-pressed') === 'true' ? 'list' : 'branches' });
  if ($('query').value.trim()) parameters.set('query', $('query').value);
  if ($('topic').value) parameters.set('topic', $('topic').value);
  const target = '#/answers' + (parameters.size ? '?' + parameters : '');
  history.replaceState(null, '', target);
  route({ scroll: false });
}

function resetFilters() {
  $('query').value = '';
  $('topic').value = '';
  search();
  $('query').focus();
}

async function load() {
  $('retry').hidden = true;
  message('正在读取公开内容');
  try {
    const response = await fetch('./public.json', { credentials: 'omit' });
    if (!response.ok) throw new Error('Snapshot unavailable');
    const value = await response.json();
    if (value.schemaVersion !== 1 || !['public-demo', 'public-reviewed', 'public-guide'].includes(value.mode) || !Array.isArray(value.answers) || !value.catalog || !Array.isArray(value.catalog.topics) || !Array.isArray(value.catalog.scopes) || typeof value.site?.name !== 'string') throw new Error('Unsupported snapshot');
    snapshot = value;
    const topicsResponse = await fetch('./community-topics.json', { credentials: 'omit' });
    if (!topicsResponse.ok) throw new Error('Topic configuration unavailable');
    topicsConfig = validateTopicsConfig(await topicsResponse.json(), snapshot.catalog);
    renderEdition();
    $('topic').replaceChildren(make('option', '全部主题'));
    $('topic').firstElementChild.value = '';
    for (const topic of snapshot.catalog.topics) { const option = make('option', topic.titleZh); option.value = topic.id; $('topic').append(option); }
    $('generated-at').textContent = `公开快照 ${date(snapshot.generatedAt)}`;
    $('about-generated-at').textContent = new Date(snapshot.generatedAt).toLocaleString('zh-CN', { hour12: false });
    document.body.dataset.ready = 'true';
    route({ scroll: false });
  } catch {
    snapshot = null;
    for (const element of document.querySelectorAll('.view')) element.hidden = true;
    document.body.dataset.ready = 'error';
    message('公开内容暂时无法读取，请稍后重试。');
    $('retry').hidden = false;
  }
}

$('search').addEventListener('submit', event => { event.preventDefault(); search(); });
let composing = false;
$('query').addEventListener('compositionstart', () => { composing = true; });
$('query').addEventListener('compositionend', () => { composing = false; search(); });
$('query').addEventListener('input', () => { if (!composing) search(); });
$('topic').addEventListener('change', search);
$('branches-mode').addEventListener('click', () => search('branches'));
$('list-mode').addEventListener('click', () => search('list'));
$('reset-filters').addEventListener('click', resetFilters);
for (const example of document.querySelectorAll('[data-search-example]')) example.addEventListener('click', () => {
  $('query').value = example.dataset.searchExample;
  $('topic').value = '';
  search('list');
  $('query').focus();
});
$('retry').addEventListener('click', load);
$('share-topic').addEventListener('change', () => {
  const topic = communityTopics(snapshot, topicsConfig).find(topic => topic.id === $('share-topic').value);
  mountedQuick?.destroy();
  if (topic) mountedQuick = mountQuickContribution($('share-composer'), { snapshot, topic });
  history.replaceState(null, '', '#/share?' + new URLSearchParams({ topic: topic.id }));
});
document.querySelector('.skip-link').addEventListener('click', event => { event.preventDefault(); $('main').focus(); $('main').scrollIntoView(); });
window.addEventListener('hashchange', () => route());
load();
