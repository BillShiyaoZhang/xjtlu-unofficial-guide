import { topicCards, catalogTopicCards, eventPresentation, incidentPresentation } from './topic-model.js';
import { loadTopicDiscussions, loadTopicDiscussion, loadCommunityActivity, loadDiscussionReplies, summariesForDiscussion, discussionPresentation } from './discussions.js';
import { mountQuickContribution } from './contributions.js';

const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const link = (text, href, className) => {
  const node = el('a', text, className); node.href = href;
  if (href.startsWith('https://')) { node.target = '_blank'; node.rel = 'noopener noreferrer'; }
  return node;
};
const button = (text, action, className = 'secondary') => {
  const node = el('button', text, className); node.type = 'button'; node.addEventListener('click', action); return node;
};
const timestamp = value => {
  if (!value) return '时间未注明';
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '时间未注明';
};
const topicHref = topic => '#/topics/' + encodeURIComponent(topic.id);
const articleHref = (answer, topic) => '#/answers/' + encodeURIComponent(answer.id) + (topic ? '?' + new URLSearchParams({ fromTopic: topic.id }) : '');
const directoryHref = topic => '#/answers?' + new URLSearchParams({ view: 'list', ...(topic ? { topic } : {}) });
// A small editorial reading order, resolved against the current public snapshot.
// Unpublished or withdrawn articles can never become a suggested link.
const journeys = [
  { id: 'arrival', title: '刚到西浦', description: '账号、到校、住宿，先安顿下来', heading: '把第一周安排明白',
    note: '从基本入口开始，再慢慢熟悉校园。', topics: ['topic-arrival', 'topic-systems', 'topic-housing'],
    articles: ['handbook-first-week-action-list', 'handbook-arrival-system-bookmarks', 'handbook-life-move-in-checklist'] },
  { id: 'daily', title: '处理日常', description: '找教室、报修、办事，少绕一点路', heading: '眼前的小问题，从这里找线索',
    note: '先找到对应的服务，再核对校区和办理安排。', topics: ['topic-services', 'topic-campus', 'topic-housing'],
    articles: ['handbook-arrival-onestop', 'handbook-life-campus-map', 'handbook-life-sip-dorm-repair'] },
  { id: 'explore', title: '探索机会', description: '社团、交换、科研，发现新的可能', heading: '校园里，还有这些可能',
    note: '选一个感兴趣的方向，看看从哪里开始。', topics: ['topic-clubs', 'topic-exchange', 'topic-research'],
    articles: ['handbook-life-clubs-discovery', 'handbook-semester-exchange-plan', 'handbook-surf-research-start'] },
];
let activeJourney = 'arrival';

function journeyAnswers(snapshot, journey) {
  const selected = journey.articles.map(id => snapshot.answers.find(answer => answer.id === id)).filter(Boolean);
  for (const answer of snapshot.answers) {
    if (selected.length >= 3) break;
    if (journey.topics.includes(answer.topic?.id) && !selected.includes(answer)) selected.push(answer);
  }
  return selected;
}

function discoveryStart(target, snapshot) {
  const intro = el('div', undefined, 'home-intro');
  const copy = el('div', undefined, 'home-intro-copy');
  copy.append(el('p', '一份可以一起完善的校园指南', 'eyebrow'), el('h1', '在西浦，\n从一个小问题开始。'));
  copy.append(el('p', '找办事入口，读同学经验，发现校园里的更多可能。还没有具体问题，也可以从下面的一条路线逛起。', 'home-description'));
  const search = el('form', undefined, 'home-search'); search.setAttribute('role', 'search');
  const label = el('label', '你想了解什么？'); label.htmlFor = 'home-query';
  const input = el('input'); input.id = 'home-query'; input.type = 'search'; input.placeholder = '搜索宿舍、课程、校园服务…'; input.maxLength = 200;
  const row = el('div', undefined, 'search-row'); const submit = el('button', '找信息'); submit.type = 'submit'; row.append(input, submit); search.append(label, row);
  search.addEventListener('submit', event => { event.preventDefault(); location.hash = '#/answers?' + new URLSearchParams({ view: 'list', ...(input.value.trim() ? { query: input.value.trim() } : {}) }); });
  const examples = el('div', undefined, 'search-examples'); examples.append(el('span', '试着搜：'));
  for (const query of ['宿舍', '选课', '地图']) examples.append(link(query + ' →', '#/answers?' + new URLSearchParams({ view: 'list', query })));
  copy.append(search, examples);
  const start = el('aside', undefined, 'home-start-card'); start.setAttribute('aria-label', '第一次来，从这里开始');
  start.append(el('p', '第一次来 · 从这里开始', 'eyebrow'), el('h2', '先把校园生活安排明白'));
  start.append(el('p', '不用一次读完。选一篇，解决一个小问题。', 'start-description'));
  const first = snapshot.answers.find(answer => answer.id === 'handbook-first-week-action-list')
    ?? journeyAnswers(snapshot, journeys[0])[0] ?? snapshot.answers[0];
  if (first) {
    const featured = link('', articleHref(first) + '?from=discover', 'start-reading');
    featured.append(el('span', '推荐起点', 'start-label'), el('strong', first.title), el('span', '开始阅读 →', 'start-action'));
    start.append(featured);
  } else start.append(el('p', '资料正在准备中，可以先看看已有话题。', 'start-description'));
  const steps = el('ol', undefined, 'reading-steps');
  for (const [title, text] of [['找一个问题', '从当前需要出发'], ['核对来源', '留意校区、时间与原文'], ['留下一点经验', '有补充时，再来分享']]) {
    const item = el('li'); item.append(el('strong', title), el('span', text)); steps.append(item);
  }
  start.append(steps); intro.append(copy, start); target.append(intro);

  const section = el('section', undefined, 'home-section journey-section');
  const heading = el('div', undefined, 'section-title');
  heading.append(el('h2', '你现在想做什么？'), link('浏览全部资料 →', directoryHref())); section.append(heading);
  const choices = el('div', undefined, 'journey-options'); choices.setAttribute('role', 'group'); choices.setAttribute('aria-label', '选择探索路线');
  const results = el('div', undefined, 'journey-results'); results.id = 'journey-results';
  const status = el('p', '', 'visually-hidden'); status.setAttribute('role', 'status');
  function selectJourney(journey, announce = true) {
    activeJourney = journey.id;
    for (const choice of choices.children) choice.setAttribute('aria-pressed', String(choice.dataset.journey === journey.id));
    results.replaceChildren();
    const caption = el('div', undefined, 'journey-caption'); caption.append(el('h3', journey.heading), el('p', journey.note)); results.append(caption);
    const answers = journeyAnswers(snapshot, journey);
    const grid = el('div', undefined, 'journey-grid');
    answers.forEach((answer, index) => {
      const card = link('', articleHref(answer) + '?from=discover', 'journey-article');
      const top = el('div', undefined, 'journey-article-top'); top.append(el('span', `0${index + 1}`, 'journey-number'), el('span', answer.topic?.title ?? '校园资料', 'topic-label'));
      card.append(top, el('h4', answer.title), el('p', answer.summary || '打开资料，查看具体说明与原始来源。'), el('span', '读这篇 →', 'text-action')); grid.append(card);
    });
    if (!answers.length) grid.append(el('p', '这条路线的资料正在准备中。可以换一条路线，或看看全部资料。', 'muted'));
    results.append(grid);
    const related = el('div', undefined, 'journey-more'); related.append(el('span', '还可以看看'));
    for (const id of journey.topics) {
      const topic = snapshot.catalog.topics.find(topic => topic.id === id);
      if (topic) related.append(link(topic.titleZh + ' →', directoryHref(id)));
    }
    results.append(related);
    if (announce) status.textContent = `已选择${journey.title}，推荐 ${answers.length} 篇资料。`;
  }
  for (const [index, journey] of journeys.entries()) {
    const choice = button('', () => selectJourney(journey), 'journey-option');
    choice.dataset.journey = journey.id; choice.setAttribute('aria-controls', results.id);
    choice.append(el('span', `0${index + 1}`, 'journey-index'), el('strong', journey.title), el('span', journey.description)); choices.append(choice);
  }
  section.append(choices, results, status); selectJourney(journeys.find(journey => journey.id === activeJourney) ?? journeys[0], false); target.append(section);

  const browse = el('section', undefined, 'home-section topic-browser');
  const browseHeading = el('div', undefined, 'section-title');
  browseHeading.append(el('h2', '或者，从一个主题逛起'), el('span', `${snapshot.answers.length} 篇资料 · 按主题整理`, 'muted')); browse.append(browseHeading);
  const categories = el('div', undefined, 'category-links');
  const allTopics = catalogTopicCards(snapshot);
  for (const topic of allTopics.slice(0, 8)) categories.append(link(topic.title, directoryHref(topic.id)));
  browse.append(categories);
  if (allTopics.length > 8) {
    const more = el('details', undefined, 'more-topics'); more.append(el('summary', `展开全部 ${allTopics.length} 个主题`));
    const extra = el('div', undefined, 'category-links');
    for (const topic of allTopics.slice(8)) extra.append(link(topic.title, directoryHref(topic.id)));
    more.append(extra); browse.append(more);
  }
  target.append(browse);
}
export const updatesTopic = {
  id: 'campus-updates', catalogTopicId: 'topic-campus', title: '校园里，有什么新消息？',
  prompt: '一次活动、临时变化，或你刚刚遇到的校园情况。说清发生时间和地点，后续有变化也可以回来补充。', kind: 'question', editorial: true,
};
export function communityTopics(snapshot, config) {
  const result = topicCards(snapshot, config);
  if (snapshot.catalog.topics.some(topic => topic.id === updatesTopic.catalogTopicId)) result.push(updatesTopic);
  const ids = new Set(result.map(topic => topic.id));
  return [...result, ...catalogTopicCards(snapshot).filter(topic => !ids.has(topic.id))];
}

function appendBody(node, body, { preview = false } = {}) {
  const content = discussionPresentation(body);
  if (content.context && !preview) node.append(el('p', content.context, 'discussion-context'));
  node.append(el('p', content.text, preview ? 'discussion-body preview-text' : 'discussion-body'));
  if (content.formatted && !preview) {
    const original = el('details', undefined, 'discussion-original');
    original.append(el('summary', '查看完整投稿文本'), el('p', content.raw, 'discussion-original-text'));
    node.append(original);
  }
}
function errorText(error) {
  if (error.code === 'RATE_LIMITED') return 'GitHub 读取额度暂时用完了。' + (error.retryAt ? `可在 ${timestamp(error.retryAt)} 后重试。` : '请稍后重试。');
  if (error.code === 'NOT_FOUND') return '暂时找不到公开讨论入口，请稍后重试。';
  if (error.code === 'TIMEOUT') return '读取讨论超时了，请重试。';
  return '暂时连不上 GitHub，讨论尚未读到。可以重试，或打开原始讨论。';
}
function stateBlock(topic, target, { compact = false, signal } = {}) {
  if (topic.kind === 'question') return;
  const box = el('div', undefined, 'event-state'); target.append(box);
  let timer;
  function update() {
    box.replaceChildren();
    const state = topic.kind === 'event' ? eventPresentation(topic.event) : incidentPresentation(topic.incident);
    box.append(el('span', state.label, 'state-label'), el('p', state.timeLabel, 'event-time'));
    if (topic.kind === 'incident') {
      if (topic.incident?.summary) box.append(el('p', topic.incident.summary));
      box.append(el('p', state.updateLabel, 'muted'));
    } else {
      box.append(el('p', state.registrationLabel, 'muted'));
      if (state.canRegister && !compact) {
        const register = link('前往报名', state.registrationUrl, 'contribution-link');
        register.addEventListener('click', event => {
          if (!eventPresentation(topic.event).canRegister) { event.preventDefault(); update(); box.tabIndex = -1; box.focus(); }
        });
        box.append(register);
      }
    }
    if (state.history) box.append(el('p', '保留经过和后续补充，供以后查找。', 'muted'));
  }
  update();
  if (signal) {
    const tick = () => {
      if (signal.aborted) return;
      update();
      const boundaries = Object.entries(topic.event ?? {}).filter(([key]) => key.endsWith('At')).map(([, value]) => Date.parse(value)).filter(value => value > Date.now());
      timer = setTimeout(tick, Math.min(60000, ...boundaries.map(value => value - Date.now() + 20)));
    };
    tick();
    document.addEventListener('visibilitychange', update, { signal });
    signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  }
}
function sourceBlock(topic, target) {
  if (!topic.sources?.length) return;
  const section = el('section', undefined, 'topic-sources');
  section.append(el('h2', '来源与整理说明'), el('p', '下方摘要由 AI 辅助整理，保留原文链接，尚未经过人工核验。读取时间表示本次访问来源的时间。', 'muted'));
  for (const source of topic.sources) {
    const row = el('article', undefined, 'topic-source');
    row.dataset.accessStatus = source.accessStatus;
    const title = el('h3'); title.append(link(`${source.title} ↗`, source.url, 'topic-source-link'));
    row.append(el('p', `${source.category === 'official' ? '学校官方来源' : '社区公开来源'} · ${source.publisher}`, 'source-provenance'), title);
    if (source.accessStatus === 'read') {
      if (source.summary) row.append(el('p', source.summary, 'source-summary'));
      row.append(el('p', `资料读取于 ${timestamp(source.accessedAt)}（北京时间）`, 'muted'));
    } else {
      row.append(el('p', '本次未读到正文，仅保留原文链接，内容待补充。', 'source-unavailable'));
      row.append(el('p', `尝试读取于 ${timestamp(source.accessedAt)}（北京时间）`, 'muted'));
    }
    row.append(el('p', source.publishedOn ? `原文日期：${source.publishedOn}` : '原文日期：未注明', 'muted'));
    section.append(row);
  }
  target.append(section);
}
function editorialCard(topic, signal) {
  const card = el('article', undefined, 'topic-card');
  card.dataset.collection = String(topic.collection === true);
  const kindLabel = topic.kind === 'event' ? '校园活动' : topic.kind === 'incident' ? '校园情况' : '编辑发起 · 邀你回答';
  card.append(el('p', topic.collection ? `公开来源整理 · ${topic.kind === 'question' ? '问题与经验' : kindLabel}` : kindLabel, 'eyebrow'));
  const title = el('h3'); title.append(link(topic.title, topicHref(topic))); card.append(title);
  card.append(el('p', topic.prompt, 'topic-prompt'));
  stateBlock(topic, card, { compact: true, signal });
  if (topic.sources?.length) card.append(el('p', topic.sources.every(source => source.accessStatus === 'unavailable')
    ? '原文待读取 · 仅保留链接线索' : 'AI 辅助整理 · 待人工核验', 'source-provenance'));
  const foot = el('div', undefined, 'topic-card-foot');
  foot.append(link(topic.collection ? '看整理与来源 →' : topic.kind === 'question' ? '我知道一点 →' : '看消息与后续 →', topicHref(topic), 'text-action'));
  if (topic.answerCount) foot.append(el('span', `${topic.answerCount} 篇相关资料`, 'muted'));
  card.append(foot); return card;
}

/** Route-scoped controller: abort network reads and preserve composer drafts on departure. */
export function mountCommunity(target, { snapshot, config, topicId, parameters = new URLSearchParams() }) {
  const controller = new AbortController();
  const { signal } = controller;
  const topics = communityTopics(snapshot, config);
  const composers = [];
  const mountComposer = (node, options) => {
    const mounted = mountQuickContribution(node, { snapshot, ...options }); composers.push(mounted); return mounted;
  };
  const repository = snapshot.site.contributionsRepository;
  const topic = topicId ? topics.find(row => row.id === topicId) : null;
  target.replaceChildren();
  if (topicId && !topic) {
    target.append(el('h1', '这个话题暂未收录'), link('回到校园共建', '#/discover'));
    return { destroy: () => controller.abort() };
  }

  function referencedSummaries(post, node) {
    const answers = summariesForDiscussion(snapshot.answers, post);
    if (!answers.length) return;
    const group = el('div', undefined, 'discussion-used');
    group.append(el('span', '这条原文已被引用：'));
    for (const answer of answers) group.append(link(answer.title, articleHref(answer, topic)));
    node.append(group);
  }

  function postNode(post, { preview = false } = {}) {
    const card = el('article', undefined, 'discussion-post'); card.id = post.id;
    const postTopic = topics.find(row => row.id === post.topicId) ?? topic;
    const meta = el('p', `${post.author} · 发布于 ${timestamp(post.createdAt)}（北京时间）`, 'discussion-meta');
    const title = el('h3');
    if (preview && postTopic) title.append(link(post.title, topicHref(postTopic) + '?' + new URLSearchParams({ discussion: post.id })));
    else title.textContent = post.title;
    card.append(meta, title);
    if (preview && postTopic) stateBlock(postTopic, card, { compact: true, signal });
    if (post.updatedAt && post.updatedAt !== post.createdAt) card.append(el('p', `讨论更新于 ${timestamp(post.updatedAt)}；不代表活动时间有变化`, 'muted'));
    appendBody(card, post.body, { preview });
    if (preview) {
      if (postTopic) card.append(link(`进入话题 · ${postTopic.title}`, topicHref(postTopic), 'text-action'));
      return card;
    }
    referencedSummaries(post, card);
    const actions = el('div', undefined, 'discussion-actions');
    actions.append(link('查看原始投稿 ↗', post.url));
    const replies = el('div', undefined, 'discussion-replies');
    const replyComposer = el('div'); let replyMounted;
    actions.append(button('回复这条', () => {
      if (!replyMounted) replyMounted = mountComposer(replyComposer, { topic, reply: post });
      replyMounted.focus();
    }));
    const replyButton = button(`查看回复（${post.commentCount}）`, () => loadReplies());
    replyButton.setAttribute('aria-expanded', 'false');
    const status = el('p', '', 'muted'); status.setAttribute('role', 'status');
    let page = 1, loading = false;
    const moreReplies = button('继续读取回复', () => loadReplies()); moreReplies.hidden = true;
    async function loadReplies() {
      if (loading) return;
      loading = true; replyButton.disabled = true; moreReplies.disabled = true;
      status.textContent = '正在读取原始回复…';
      try {
        const result = await loadDiscussionReplies({ repository, number: post.number, page, signal });
        if (signal.aborted) return;
        for (const reply of result.replies) {
          if ([...replies.children].some(node => node.id === reply.id)) continue;
          const row = el('article', undefined, 'discussion-reply'); row.id = reply.id;
          row.append(el('p', `${reply.author} · ${timestamp(reply.createdAt)}（北京时间）`, 'discussion-meta'));
          appendBody(row, reply.body);
          row.append(link('这条回复的原文 ↗', reply.url));
          const replyTarget = el('div'); let nestedComposer;
          row.append(button('回复这条回答', () => {
            if (!nestedComposer) nestedComposer = mountComposer(replyTarget, { topic, reply: { ...reply, number: post.number } });
            nestedComposer.focus();
          }));
          referencedSummaries(reply, row); replies.append(row);
          row.append(replyTarget);
        }
        status.textContent = result.hasMore ? '已显示部分回复。' : result.replies.length || replies.children.length ? '已读到回复末尾。' : '还没有回复。';
        page = result.nextPage; moreReplies.hidden = !result.hasMore; replyButton.hidden = true;
        replyButton.setAttribute('aria-expanded', 'true');
      } catch (error) { if (!signal.aborted) status.textContent = errorText(error); }
      finally { loading = false; replyButton.disabled = false; moreReplies.disabled = false; }
    }
    actions.append(replyButton); card.append(actions, replies, status, moreReplies, replyComposer);
    return card;
  }

  function liveFeed(node, { currentTopic, preview = false, stage, onPostsChange } = {}) {
    const status = el('p', '正在读取真实投稿…', 'feed-status'); status.setAttribute('role', 'status');
    const list = el('div', undefined, 'discussion-list');
    const actions = el('div', undefined, 'discussion-actions');
    let nextPage = 1, loading = false, allPosts = new Map(), requestedLoaded = false, requestedFocused = false;
    const requested = parameters.get('discussion');
    const more = button('继续读取较早投稿', () => load(false)); more.hidden = true;
    const refresh = button('刷新讨论', () => load(true));
    if (repository) actions.append(refresh, more, link('在 GitHub 查看公开投稿 ↗', `https://github.com/${repository}/issues`));
    node.append(status, list, actions);
    if (!repository) { status.textContent = '公开投稿入口暂未开放。'; return; }
    async function load(reset) {
      if (loading || signal.aborted) return;
      const initiatingControl = [refresh, more].includes(document.activeElement) ? document.activeElement : null;
      loading = true; refresh.disabled = true; more.disabled = true;
      status.textContent = reset ? '正在刷新讨论…' : '正在读取真实投稿…';
      try {
        const result = currentTopic
          ? await loadTopicDiscussions({ repository, topicId: currentTopic.id, catalogTopicId: currentTopic.catalogTopicId, answers: snapshot.answers, signal, page: reset ? 1 : nextPage })
          : await loadCommunityActivity({ repository, topics, answers: snapshot.answers, signal, page: reset ? 1 : nextPage });
        if (signal.aborted) return;
        if (reset) { allPosts = new Map(); list.replaceChildren(); requestedLoaded = false; }
        for (const post of result.posts) {
          if (!allPosts.has(post.id)) list.append(postNode(post, { preview }));
          allPosts.set(post.id, post);
        }
        if (currentTopic && !requestedLoaded && /^issue-\d+$/u.test(requested ?? '')) {
          requestedLoaded = true;
          if (!allPosts.has(requested)) {
            try {
              const selected = await loadTopicDiscussion({ repository, number: Number(requested.slice(6)), topicId: currentTopic.id, catalogTopicId: currentTopic.catalogTopicId, answers: snapshot.answers, signal });
              if (signal.aborted) return;
              allPosts.set(selected.id, selected); list.prepend(postNode(selected));
            } catch (error) {
              if (signal.aborted) return;
              const unavailable = el('p', error.code === 'NOT_FOUND' ? '指定投稿不属于此话题，或已不可用。' : '指定投稿暂时未读到，请刷新重试。', 'warning');
              list.prepend(unavailable); requestedLoaded = false;
            }
          }
        }
        onPostsChange?.([...allPosts.values()]);
        nextPage = result.nextPage; more.hidden = !result.hasMore;
        status.textContent = allPosts.size
          ? `已读到 ${allPosts.size} 条投稿${result.hasMore ? '，还有更早的页面可读取' : '，已到当前记录末尾'}。读取于 ${timestamp(result.fetchedAt)}。`
          : result.hasMore ? '已读取的页面没有匹配投稿，可以继续读取更早的页面。' : currentTopic ? '还没有读到这个话题的公开投稿。你可以先写一句自己的经历。' : '还没有读到这些话题的公开投稿。选一个熟悉的问题，先留下一点经历吧。';
        if (stage) stage.textContent = currentTopic?.collection ? '公开来源整理 · 待人工核验'
          : allPosts.size ? '讨论正在积累 · 原始回答保留在下方' : result.hasMore ? '正在查找已有回答' : '编辑提问 · 等你分享第一条经历';
        if (!requestedFocused && requested && /^issue-\d+$/u.test(requested)) {
          const selected = [...list.children].find(row => row.id === requested);
          if (selected) {
            requestedFocused = true;
            if (!document.activeElement?.closest('.quick-contribution')) {
              selected.tabIndex = -1; selected.focus({ preventScroll: true }); selected.scrollIntoView({ block: 'center' });
            }
          }
        }
      } catch (error) { if (!signal.aborted) status.textContent = errorText(error) + (allPosts.size ? '下面保留上次已读到的内容。' : ''); }
      finally {
        loading = false; refresh.disabled = false; more.disabled = false;
        if (!signal.aborted && initiatingControl && document.activeElement === document.body) {
          const destination = initiatingControl.hidden ? status : initiatingControl;
          if (destination === status) destination.tabIndex = -1;
          destination.focus({ preventScroll: true });
        }
      }
    }
    load(false);
  }

  if (!topic) {
    discoveryStart(target, snapshot);
    const cards = topicCards(snapshot, config);
    const featured = cards.filter(row => row.kind === 'question' && !row.collection);
    const section = el('section', undefined, 'home-section');
    section.classList.add('participation-section');
    const heading = el('div', undefined, 'section-title'); heading.append(el('h2', '你知道的一点，也能帮到同学'), link('分享一段经验 →', '#/share')); section.append(heading);
    section.append(el('p', '遇到熟悉的话题，留一句经历就好。阅读无需登录；发布分享时，在 GitHub 确认。', 'muted'));
    if (featured.length) { const grid = el('div', undefined, 'topic-grid'); featured.forEach(row => grid.append(editorialCard(row, signal))); section.append(grid); }
    else section.append(el('p', '共建问题正在准备中，也可以从资料目录找到话题，补充自己的经历。', 'muted'));
    const isHistory = row => row.kind === 'event' ? eventPresentation(row.event).history
      : row.kind === 'incident' ? incidentPresentation(row.incident).history : false;
    const collections = cards.filter(row => row.collection);
    if (collections.length) {
      const collected = el('section', undefined, 'home-section collected-topics source-collection');
      collected.append(el('p', '多看一点校园', 'eyebrow'), el('h2', '从公开来源整理'), el('p', '看看校园消息和同学关心的问题。每条整理都可以继续追溯原文。', 'muted'));
      const current = collections.filter(row => !isHistory(row));
      if (current.length) {
        const grid = el('div', undefined, 'topic-grid');
        current.slice(0, 3).forEach(row => grid.append(editorialCard(row, signal))); collected.append(grid);
      }
      if (current.length > 3) {
        const more = el('details', undefined, 'happenings-history');
        more.append(el('summary', `查看更多 ${current.length - 3} 条来源整理`));
        const grid = el('div', undefined, 'topic-grid');
        current.slice(3).forEach(row => grid.append(editorialCard(row, signal))); more.append(grid); collected.append(more);
      }
      const historical = collections.filter(isHistory);
      if (historical.length) {
        const history = el('details', undefined, 'happenings-history');
        history.append(el('summary', `查看 ${historical.length} 条往期来源整理`));
        const grid = el('div', undefined, 'topic-grid');
        historical.forEach(row => grid.append(editorialCard(row, signal))); history.append(grid); collected.append(history);
      }
      target.append(collected);
    }
    const happenings = cards.filter(row => row.kind !== 'question' && !row.collection);
    const updates = el('section', undefined, 'home-section');
    const updatesHeading = el('div', undefined, 'section-title'); updatesHeading.append(el('h2', '校园近况与新回答'));
    if (topics.some(row => row.id === updatesTopic.id)) updatesHeading.append(link('发个校园消息 →', topicHref(updatesTopic), 'text-action'));
    updates.append(updatesHeading, el('p', '活动、临时变化，也有值得留下的经过。消息的发生时间和讨论更新时间分别显示。', 'muted'));
    const current = happenings.filter(row => !isHistory(row)), historical = happenings.filter(isHistory);
    if (current.length) { const grid = el('div', undefined, 'topic-grid'); current.forEach(row => grid.append(editorialCard(row, signal))); updates.append(grid); }
    if (historical.length) {
      const history = el('details', undefined, 'happenings-history'); history.append(el('summary', `查看 ${historical.length} 条往期活动与情况`));
      const grid = el('div', undefined, 'topic-grid'); historical.forEach(row => grid.append(editorialCard(row, signal))); history.append(grid); updates.append(history);
    }
    const feed = el('div'); updates.append(feed); liveFeed(feed, { preview: true }); target.append(updates);
    target.append(section);
  } else {
    target.append(link('← 回到开始探索', '#/discover', 'back'));
    const stage = el('p', topic.collection ? '公开来源整理 · 待人工核验' : topic.editorial ? '编辑发起的共建话题' : '资料与公开讨论', 'eyebrow topic-stage');
    target.append(stage, el('h1', topic.title), el('p', topic.prompt, 'topic-intro'));
    stateBlock(topic, target, { signal });
    if (topic.createdAt) target.append(el('p', `话题发布于 ${timestamp(topic.createdAt)}（北京时间）`, 'muted'));
    const topActions = el('div', undefined, 'topic-jumps');
    const composerTarget = el('details', undefined, 'topic-composer-disclosure'); composerTarget.id = 'topic-composer';
    composerTarget.append(el('summary', '分享我的经历'));
    const composerBody = el('div'); composerTarget.append(composerBody);
    const composer = mountComposer(composerBody, { topic });
    topActions.append(button(topic.kind === 'event' ? '补充活动消息 / 参与经历' : topic.kind === 'incident' ? '我知道后续情况' : '我也说一句', () => { composerTarget.open = true; composer.focus(); }, 'secondary'));
    topActions.append(button('看原始回答 ↓', () => { const feed = target.querySelector('.topic-discussion'); feed.tabIndex = -1; feed.focus(); feed.scrollIntoView({ block: 'start' }); }));
    topActions.prepend(button(topic.collection ? '看整理与来源 ↓' : '先看相关资料 ↓', () => {
      const section = target.querySelector(topic.collection ? '.topic-sources' : '.topic-summary');
      if (section) { section.tabIndex = -1; section.focus({ preventScroll: true }); section.scrollIntoView({ block: 'start' }); }
    }, ''));
    target.append(topActions);
    sourceBlock(topic, target);
    // A catalog relationship is not evidence of editorial adoption. Show those materials separately.
    const related = snapshot.answers.filter(answer => answer.topic?.id === topic.catalogTopicId);
    const summary = el('section', undefined, 'topic-summary');
    function renderSummary(posts = [], draw = true) {
      const originalUrls = new Set(posts.map(post => post.url.toLowerCase()));
      const isTopicSource = citation => {
        try {
          const url = new URL(citation.url);
          if (url.protocol !== 'https:' || url.username || url.password || url.search || !/^(?:#issuecomment-\d+)?$/u.test(url.hash)) return false;
          url.hash = '';
          return originalUrls.has(url.href.toLowerCase());
        } catch { return false; }
      };
      const discussionDerived = related.filter(answer => answer.citations?.some(isTopicSource));
      if (!draw) return discussionDerived.length > 0;
      summary.replaceChildren();
      summary.append(el('h2', discussionDerived.length ? '目前整理' : '先看看相关资料'));
      summary.append(el('p', discussionDerived.length ? '整理保留原文出处，你可以继续补充或提出不同经历。' : '这些资料提供背景，还不是对上面问题的共同结论。大家的原始回答会持续保留。', 'muted'));
      const visibleAnswers = discussionDerived.length ? discussionDerived : related.slice(0, 3);
      if (!visibleAnswers.length) summary.append(el('p', '还没有相关整理。先留下消息或经历，之后有需要再一起整理。', 'muted'));
      for (const answer of visibleAnswers) {
        const card = el('article', undefined, 'summary-item'); const title = el('h3'); title.append(link(answer.title, articleHref(answer, topic)));
        card.append(title, el('p', answer.summary));
        card.append(el('p', answer.reviewStatus === 'collected' ? 'AI 辅助资料整理 · 待人工核验' : answer.demo ? '演示内容' : '已审核 · 查看原文了解适用范围', 'muted'));
        if (discussionDerived.includes(answer)) {
          for (const citation of answer.citations ?? []) {
            try {
              const url = new URL(citation.url);
              if (isTopicSource(citation)) card.append(link('对应原始讨论 ↗', url.href, 'summary-source'));
            } catch { /* Invalid source links stay inert. */ }
          }
        }
        summary.append(card);
      }
      if (related.length > visibleAnswers.length) summary.append(link(`查看全部 ${related.length} 篇相关资料 →`, '#/answers?' + new URLSearchParams({ view: 'list', topic: topic.catalogTopicId })));
      return discussionDerived.length > 0;
    }
    renderSummary();
    target.append(summary);
    const discussion = el('section', undefined, 'topic-discussion');
    discussion.append(el('h2', '大家的原始回答'), el('p', '经历、追问和不同意见都留在这里。被整理引用的回答会显示去向；讨论关闭不代表内容已被采纳。', 'muted'));
    let pendingPosts;
    const protectingInput = () => composerTarget.contains(document.activeElement)
      || discussion.contains(document.activeElement?.closest('.quick-contribution'))
      || summary.contains(document.activeElement);
    function arrange(posts) {
      const hasSummary = renderSummary(posts, false);
      target.dataset.stage = hasSummary ? 'summarized' : posts.length ? 'discussing' : 'inviting';
      // Keep reading first and the layout stable while discussion loads.
      // Delay replacing summaries when their links or a composer have focus.
      if (protectingInput()) { pendingPosts = posts; return; }
      pendingPosts = undefined;
      renderSummary(posts);
      const focused = document.activeElement, scrollY = window.scrollY;
      if (focused?.isConnected && focused !== document.body) focused.focus({ preventScroll: true });
      window.scrollTo({ top: scrollY, behavior: 'instant' });
    }
    target.addEventListener('focusout', () => queueMicrotask(() => {
      if (!signal.aborted && pendingPosts && !protectingInput()) arrange(pendingPosts);
    }), { signal });
    target.append(discussion, composerTarget);
    arrange([]);
    liveFeed(discussion, { currentTopic: topic, stage, onPostsChange: arrange });
  }
  return { destroy() { controller.abort(); composers.forEach(composer => composer.destroy()); } };
}
