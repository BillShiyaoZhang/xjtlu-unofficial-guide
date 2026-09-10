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
    const intro = el('div', undefined, 'home-intro');
    intro.append(el('p', '西浦的消息与经验，一起留下来', 'eyebrow'), el('h1', '你知道的一点，\n可能正好帮到同学。'));
    intro.append(el('p', '看看校园近况，找找已有整理。遇到熟悉的问题，留一句自己的经历就好。', 'home-description'));
    const search = el('form', undefined, 'home-search'); search.setAttribute('role', 'search');
    const label = el('label', '想了解学校的什么？'); label.htmlFor = 'home-query';
    const input = el('input'); input.id = 'home-query'; input.type = 'search'; input.placeholder = '试试「暑研」「宿舍报修」「申请研究生」'; input.maxLength = 200;
    const row = el('div', undefined, 'search-row'); const submit = el('button', '找信息'); submit.type = 'submit'; row.append(input, submit); search.append(label, row);
    search.addEventListener('submit', event => { event.preventDefault(); location.hash = '#/answers?' + new URLSearchParams({ view: 'list', query: input.value }); });
    intro.append(search); target.append(intro);
    const cards = topicCards(snapshot, config);
    const featured = cards.filter(row => row.kind === 'question' && !row.collection);
    const section = el('section', undefined, 'home-section');
    const heading = el('div', undefined, 'section-title'); heading.append(el('h2', '这些问题，想听听你的经历'), link('找已有整理 →', '#/answers?view=list')); section.append(heading);
    if (featured.length) { const grid = el('div', undefined, 'topic-grid'); featured.forEach(row => grid.append(editorialCard(row, signal))); section.append(grid); }
    else section.append(el('p', '共建问题正在准备中，也可以从资料目录找到话题，补充自己的经历。', 'muted'));
    target.append(section);
    const isHistory = row => row.kind === 'event' ? eventPresentation(row.event).history
      : row.kind === 'incident' ? incidentPresentation(row.incident).history : false;
    const collections = cards.filter(row => row.collection);
    if (collections.length) {
      const collected = el('section', undefined, 'home-section collected-topics source-collection');
      collected.append(el('h2', '从公开来源整理'), el('p', '校园活动、办事消息与社区经验，保留出处和读取状态。欢迎带着自己的情况补充。', 'muted'));
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
    const browse = el('section', undefined, 'home-section'); browse.append(el('h2', '按主题找资料'));
    const categories = el('div', undefined, 'category-links');
    for (const row of catalogTopicCards(snapshot)) categories.append(link(row.title, topicHref(row)));
    browse.append(categories); target.append(browse);
  } else {
    target.append(link('← 回到校园共建', '#/discover', 'back'));
    const stage = el('p', topic.collection ? '公开来源整理 · 待人工核验' : topic.editorial ? '编辑发起的共建话题' : '资料与公开讨论', 'eyebrow topic-stage');
    target.append(stage, el('h1', topic.title), el('p', topic.prompt, 'topic-intro'));
    stateBlock(topic, target, { signal });
    sourceBlock(topic, target);
    if (topic.createdAt) target.append(el('p', `话题发布于 ${timestamp(topic.createdAt)}（北京时间）`, 'muted'));
    const topActions = el('div', undefined, 'topic-jumps');
    const composerTarget = el('section'); composerTarget.id = 'topic-composer';
    const composer = mountComposer(composerTarget, { topic });
    topActions.append(button(topic.kind === 'event' ? '补充活动消息 / 参与经历' : topic.kind === 'incident' ? '我知道后续情况' : '我也说一句', () => composer.focus(), ''));
    topActions.append(button('看原始回答 ↓', () => { const feed = target.querySelector('.topic-discussion'); feed.tabIndex = -1; feed.focus(); feed.scrollIntoView({ block: 'start' }); }));
    target.append(topActions);
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
      // Never move the input while someone is writing. On initial reading, show the
      // concrete next action for the evidence actually available in this topic.
      if (protectingInput()) { pendingPosts = posts; return; }
      pendingPosts = undefined;
      renderSummary(posts);
      const focused = document.activeElement, scrollY = window.scrollY;
      if (hasSummary) topActions.after(summary, discussion, composerTarget);
      else if (posts.length) topActions.after(discussion, composerTarget, summary);
      else topActions.after(composerTarget, discussion, summary);
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
