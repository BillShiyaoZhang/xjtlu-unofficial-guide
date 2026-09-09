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
  for (const [id, selected] of [['answers-nav', ['answers', 'detail', 'missing'].includes(view)], ['about-nav', view === 'about']]) {
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
  for (const text of answer.warnings ?? []) target.append(make('p', text, 'warning'));
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
  const answers = snapshot.answers.filter(answer => (!$('topic').value || answer.topic?.id === $('topic').value) && (!query.trim() || matches(answer, terms)));
  $('count').textContent = `${answers.length} 条答案`;
  $('answer-list').replaceChildren();
  for (const answer of answers) {
    const item = make('article', undefined, 'answer-item');
    const link = make('a'); link.href = answerHash(answer);
    link.append(make('h3', answer.title));
    item.append(make('span', answer.topic?.title ?? '校园信息', 'topic-label'), link, make('p', answer.summary));
    item.append(make('span', `核验 ${date(answer.verifiedAt)} · ${(answer.citations ?? []).length} 项来源`, 'metadata'));
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
  for (const text of [`第 ${answer.revisionNumber} 版`, `信息截至 ${date(answer.asOf)}`, `人工核验 ${date(answer.verifiedAt)}`, `复核期限 ${date(answer.reviewDueAt)}`, answer.reviewOwnerLabel]) {
    if (text) metadata.append(make('span', text));
  }
  target.append(metadata);
  if (answer.demo) target.append(make('p', '演示内容，真实试点前需重新审核。', 'warning'));
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

function route({ scroll = true } = {}) {
  if (!snapshot) return;
  message();
  const raw = location.hash.slice(1) || '/answers';
  const split = raw.indexOf('?');
  const path = split < 0 ? raw : raw.slice(0, split);
  const parameters = new URLSearchParams(split < 0 ? '' : raw.slice(split + 1));
  if (path === '/about') {
    show('about'); document.title = `关于本指南 | ${snapshot.site.name}`;
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
    if (value.schemaVersion !== 1 || value.mode !== 'public-demo' || !Array.isArray(value.answers) || !value.catalog || !Array.isArray(value.catalog.topics) || !Array.isArray(value.catalog.scopes) || typeof value.site?.name !== 'string') throw new Error('Unsupported snapshot');
    snapshot = value;
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
