const $ = id => document.getElementById(id);
const make = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
};
let snapshot;
let listHash = '#/answers';
const date = value => {
  if (!value) return '未注明';
  const parsed = new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString('zh-CN') : '未注明';
};
const normalize = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('zh-CN').trim();
const answerHash = answer => '#/answers/' + encodeURIComponent(answer.id);

function message(text = '') {
  $('message').textContent = text;
  $('message').hidden = !text;
}

function show(view) {
  for (const element of document.querySelectorAll('.view')) element.hidden = element.id !== `${view}-view`;
  for (const [id, selected] of [['answers-nav', ['answers', 'detail', 'missing'].includes(view)], ['contribute-nav', view === 'contribute'], ['about-nav', view === 'about']]) {
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
  $('edition-label').textContent = collected || approved || empty ? '公开只读指南' : '公开只读演示';
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
      + '后续修改、隐藏或撤回，需要再次同步后才会反映到此站点。此处只提供阅读，不接收账户登录、私件投稿或研究活动记录。学校网站由其各自的维护方提供。'
    : '此版本仅包含构建时可公开的示范内容，不接收账户登录、私件投稿或研究活动记录。学校网站由其各自的维护方提供。';
}

function searchTerms(query) {
  const normalized = normalize(query);
  const alternatives = [normalized];
  for (const [canonical, aliases] of Object.entries(snapshot.search?.aliases ?? {})) {
    const group = [canonical, ...(Array.isArray(aliases) ? aliases : [])].map(normalize);
    if (group.includes(normalized)) alternatives.push(...group);
  }
  return [...new Set(alternatives)];
}

function matches(answer, alternatives) {
  const haystack = normalize([answer.title, answer.summary, answer.topic?.title,
    ...(answer.sentences ?? []).map(sentence => sentence.text),
    ...(answer.citations ?? []).map(citation => citation.title),
  ].join(' '));
  return alternatives.some(term => term.split(/\s+/u).every(word => haystack.includes(word)));
}

function renderList(parameters) {
  const query = parameters.get('query') ?? '', topic = parameters.get('topic') ?? '';
  $('query').value = query;
  $('topic').value = snapshot.catalog.topics.some(value => value.id === topic) ? topic : '';
  const selectedTopic = snapshot.catalog.topics.find(value => value.id === $('topic').value);
  $('topic-description').textContent = selectedTopic?.description ?? '';
  const terms = searchTerms(query);
  const answers = snapshot.answers.filter(answer => (!$('topic').value || answer.topic?.id === $('topic').value) && (!query.trim() || matches(answer, terms)))
    .sort((left, right) => Number(left.demo) - Number(right.demo));
  $('count').textContent = `${answers.length} 条答案`;
  $('answer-list').replaceChildren();
  for (const answer of answers) {
    const item = make('article', undefined, 'answer-item');
    item.dataset.reviewStatus = answer.reviewStatus ?? (answer.demo ? 'demo' : '');
    const link = make('a'); link.href = answerHash(answer);
    link.append(make('h3', answer.title));
    item.append(make('span', answer.topic?.title ?? '校园信息', 'topic-label'), link, make('p', answer.summary));
    const collected = answer.reviewStatus === 'collected';
    item.append(make('span', `${collected ? '资料整理 ' + date(answer.researchedAt) : '核验 ' + date(answer.verifiedAt)} · ${(answer.citations ?? []).length} 项来源`, 'metadata'));
    if (collected) item.append(make('span', ' · 待人工核验', 'collected-status'));
    if (answer.demo) item.append(make('span', ' · 演示内容', 'demo'));
    warnings(item, answer);
    $('answer-list').append(item);
  }
  if (!answers.length) $('answer-list').append(make('p', '暂无符合条件的公开答案。', 'empty'));
  show('answers');
}

function renderDetail(answer) {
  const target = $('answer-detail');
  target.replaceChildren(make('p', answer.topic?.title ?? '校园信息', 'eyebrow'), make('h1', answer.title));
  const metadata = make('div', undefined, 'detail-meta');
  const collected = answer.reviewStatus === 'collected';
  for (const text of [`第 ${answer.revisionNumber} 版`, `信息截至 ${date(answer.asOf)}`,
    collected ? `资料整理 ${date(answer.researchedAt)}` : `人工核验 ${date(answer.verifiedAt)}`,
    collected ? '待人工核验' : answer.reviewOwnerLabel, `复核期限 ${date(answer.reviewDueAt)}`]) {
    if (text) metadata.append(make('span', text));
  }
  target.append(metadata);
  if (answer.demo) target.append(make('p', answer.reviewStatus === 'approved' ? '演示内容，已完成人工审核。' : '演示内容，真实试点前需重新审核。', 'warning'));
  if (collected) target.append(make('p', '内容来源：AI 辅助资料整理，尚未逐条人工核验。', 'warning collected-notice'));
  else if (answer.originalOrigin === 'ai_draft') target.append(make('p', answer.reviewStatus === 'approved'
    ? '内容来源：AI 辅助初稿，经人工审核确认。' : '内容来源：AI 辅助整理。', 'muted'));
  warnings(target, answer);
  const scope = Object.entries(answer.scope ?? {}).flatMap(([dimension, values]) => values.map(value => snapshot.catalog.scopes.find(item => item.dimension === dimension && (item.id === value || item.code === value))?.labelZh ?? value));
  target.append(make('p', `适用范围：${scope.join(' · ') || '尚未明确'}`, 'muted'));
  if (answer.evidenceNote) target.append(make('p', answer.evidenceNote, 'warning'));
  for (const sentence of answer.sentences ?? []) {
    target.append(make('p', sentence.text, 'answer-body'));
    for (const citation of (answer.citations ?? []).filter(value => value.sentenceId === sentence.id)) {
      const box = make('div', undefined, 'citation');
      const href = safeLink(citation.url);
      const title = make(href ? 'a' : 'span', citation.title ?? '原始来源');
      if (href) { title.href = href; title.target = '_blank'; title.rel = 'noopener noreferrer'; }
      box.append(title, make('span', citation.mode === 'link-only' ? ' · 原站链接' : ' · 授权摘录', 'muted'));
      if (citation.excerpt) box.append(make('p', citation.excerpt));
      target.append(box);
    }
  }
  const contribution = make('section', undefined, 'contribution-prompt');
  const contributionLink = make('a', '补充/更正这篇', 'contribution-link');
  contributionLink.href = '#/contribute?' + new URLSearchParams({ article: answer.id, revision: answer.revisionId });
  contribution.append(make('h2', '补充这篇文章'), make('p', '欢迎提供更正、补充来源或分享不同的办理经验。'), contributionLink);
  target.append(contribution);
  if (answer.history?.length) {
    target.append(make('h2', '公开版本记录'));
    const history = make('div', undefined, 'history');
    for (const revision of answer.history) history.append(make('span', `第 ${revision.number} 版${revision.id === answer.revisionId ? ' · 当前快照' : ''}`));
    target.append(history);
  }
  const related = snapshot.answers.filter(value => value.id !== answer.id && value.topic?.id === answer.topic?.id);
  if (related.length) {
    const section = make('section', undefined, 'related'); section.append(make('h2', '同话题答案'));
    for (const value of related) { const paragraph = make('p'), link = make('a', value.title); link.href = answerHash(value); paragraph.append(link); section.append(paragraph); }
    target.append(section);
  }
  $('back-to-list').href = listHash;
  show('detail');
}

function renderContribution(parameters) {
  const repository = snapshot.site.contributionsRepository;
  const enabled = typeof repository === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9._-]{1,100}$/u.test(repository)
    && !['.', '..'].includes(repository.split('/')[1]);
  const answer = snapshot.answers.find(value => value.id === parameters.get('article'));
  const context = $('contribution-context');
  context.replaceChildren();
  context.hidden = !parameters.has('article');
  if (answer) {
    const back = make('a', answer.title);
    back.href = answerHash(answer);
    const description = make('p', '正在补充：');
    description.append(back, make('span', ` · 第 ${answer.revisionNumber} 版`, 'muted'));
    context.append(description, make('p', '文章链接和当前公开版本会带入 GitHub 表单。', 'muted'));
    if (parameters.has('revision') && parameters.get('revision') !== answer.revisionId) {
      context.append(make('p', '这篇文章已更新，将引用当前公开版本。', 'muted'));
    }
  } else if (parameters.has('article')) context.append(make('p', '未找到关联的公开文章，可按通用投稿继续补充。', 'muted'));
  $('contribution-unavailable').hidden = enabled;
  $('contribution-options').hidden = !enabled;
  for (const [id, template] of [
    ['contribution-new', 'new-information.yml'], ['contribution-correction', 'correction.yml'], ['contribution-experience', 'experience.yml'],
  ]) {
    const link = $(id);
    link.removeAttribute('href');
    if (!enabled) continue;
    const url = new URL(`https://github.com/${repository}/issues/new`);
    url.searchParams.set('template', template);
    if (answer) {
      let articleUrl;
      try {
        const base = new URL(snapshot.site.publicUrl);
        if (base.protocol === 'https:' && !base.username && !base.password) articleUrl = new URL(answerHash(answer), base).href;
      } catch { /* A malformed public site URL must never become an executable link. */ }
      if (articleUrl) url.searchParams.set('article', articleUrl);
      url.searchParams.set('revision', answer.revisionId);
      url.searchParams.set('context', `${answer.title} · 文章 ID：${answer.id}`.slice(0, 1000));
    }
    link.href = url.href;
    link.referrerPolicy = 'no-referrer';
  }
  show('contribute');
}

function route({ scroll = true } = {}) {
  if (!snapshot) return;
  message();
  const raw = location.hash.slice(1) || '/answers';
  const split = raw.indexOf('?');
  const path = split < 0 ? raw : raw.slice(0, split);
  const parameters = new URLSearchParams(split < 0 ? '' : raw.slice(split + 1));
  if (path === '/about') {
    show('about'); document.title = `关于本指南 | ${snapshot.site.name}`;
  } else if (path === '/contribute') {
    renderContribution(parameters); document.title = `补充信息 | ${snapshot.site.name}`;
  } else if (path === '/answers' || path === '/') {
    listHash = '#' + raw;
    renderList(parameters); document.title = snapshot.site.name;
  } else {
    let id;
    try { id = path.startsWith('/answers/') ? decodeURIComponent(path.slice('/answers/'.length)) : null; } catch { id = null; }
    const answer = snapshot.answers.find(value => value.id === id);
    if (answer) { renderDetail(answer); document.title = `${answer.title} | ${snapshot.site.name}`; }
    else { $('answer-detail').replaceChildren(); show('missing'); document.title = `未找到公开答案 | ${snapshot.site.name}`; }
  }
  if (scroll) window.scrollTo({ top: 0, behavior: 'instant' });
}

function search() {
  const parameters = new URLSearchParams();
  if ($('query').value.trim()) parameters.set('query', $('query').value);
  if ($('topic').value) parameters.set('topic', $('topic').value);
  const target = '#/answers' + (parameters.size ? '?' + parameters : '');
  history.replaceState(null, '', target);
  route({ scroll: false });
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
$('retry').addEventListener('click', load);
window.addEventListener('hashchange', () => route());
load();
