import { renderBranches } from './branches.js';
import { withBranchAncestors } from './branch-model.js';

const $ = id => document.getElementById(id);
const create = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
let token = sessionStorage.getItem('guide-participant') ?? '';
let epoch = Number(sessionStorage.getItem('guide-consent-epoch') ?? 0);
let catalog, notice, answers = [], contextAnswers = [], links = [];
let readerView = 'list';
let directoryUrl = '/#answers';
let appliedQuery = '';
const answerHref = answer => '/answers/' + encodeURIComponent(answer.slug);
let queryEventId = null;
let routeGeneration = 0, searchGeneration = 0;
const pendingRequests = new Map();
const date = value => value ? new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value).toLocaleDateString('zh-CN') : '未注明';
const sourceLabels = { university_official: '学校官方', user_provided: '用户提供', web: '网络资料' };
const universalScopeLabels = { campus: '两校区通用入口', audience: '学生通用入口', academic_year: '不限学年' };
function sourceBadges(answer) {
  const group = create('div', undefined, 'source-categories');
  group.setAttribute('aria-label', '材料来源');
  for (const category of answer.sourceCategories ?? []) {
    if (!sourceLabels[category]) continue;
    const badge = create('span', sourceLabels[category], 'source-category');
    badge.dataset.sourceCategory = category;
    group.append(badge);
  }
  return group;
}
function message(value) { $('message').textContent = value; $('message').hidden = !value; }
async function api(path, { data, auth = token, key, requestContext } = {}) {
  const request = data ? JSON.stringify([path, auth, data, requestContext]) : null;
  if (request && !key) {
    key = pendingRequests.get(request);
    if (!key) {
      key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
      pendingRequests.set(request, key);
    }
  }
  const response = await fetch(path, { method: data ? 'POST' : 'GET', cache: 'no-store', headers: {
    ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
    ...(data ? { 'Content-Type': 'application/json', 'Idempotency-Key': key } : {}),
  }, ...(data ? { body: JSON.stringify(data) } : {}) });
  const result = await response.json();
  if (response.status < 500) pendingRequests.delete(request);
  if (!response.ok) {
    if (response.status === 401 && auth && auth === token) {
      token = ''; epoch = 0; saveSession(); $('activity').replaceChildren();
      throw new Error('参与会话已失效，请重新兑换邀请。');
    }
    throw Object.assign(new Error(typeof result.error === 'string' ? result.error : result.code), { code: result.code });
  }
  return result;
}
async function action(form, callback) {
  const button = form.querySelector('button');
  if (button) button.disabled = true;
  try { await callback(); } catch (error) { message(error.message); }
  finally { if (button) button.disabled = false; }
}
function saveSession() {
  queryEventId = null;
  pendingRequests.clear();
  if (token) sessionStorage.setItem('guide-participant', token); else sessionStorage.removeItem('guide-participant');
  sessionStorage.setItem('guide-consent-epoch', String(epoch));
  $('redeem').hidden = !!token; $('consent').hidden = !token || !!epoch;
  $('participant-tools').hidden = !token || !epoch; $('session-actions').hidden = !token;
  $('participant-state').textContent = token ? epoch ? '已参与' : '待确认同意' : '未加入';
}
function option(value, text) { const node = create('option', text); node.value = value; return node; }
function directoryParameters() {
  const parameters = new URLSearchParams({ view: readerView });
  const query = $('search').elements.query.value.trim();
  if (query) parameters.set('query', query);
  if ($('topic').value) parameters.set('topic', $('topic').value);
  for (const input of $('scope-filters').querySelectorAll('select')) if (input.value) parameters.set('scope.' + input.name, input.value);
  return parameters;
}
function restoreDirectory(parameters) {
  readerView = parameters.get('view') === 'branches' ? 'branches' : 'list';
  $('search').elements.query.value = (parameters.get('query') ?? '').slice(0, 500);
  $('topic').value = [...$('topic').options].some(item => item.value === parameters.get('topic')) ? parameters.get('topic') : '';
  for (const input of $('scope-filters').querySelectorAll('select')) {
    const value = parameters.get('scope.' + input.name);
    input.value = [...input.options].some(item => item.value === value) ? value : '';
  }
  directoryUrl = '/?' + directoryParameters() + '#answers';
}
function rememberDirectory() {
  directoryUrl = '/?' + directoryParameters() + '#answers';
  history.replaceState({}, '', directoryUrl);
}
async function applyDirectoryControls() {
  rememberDirectory();
  // A topic or view choice also applies any keyword still waiting in the input.
  // Otherwise the URL would describe a different query from the displayed data.
  if ($('search').elements.query.value.trim() !== appliedQuery) await refreshAnswers();
  else renderAnswers();
}
async function resetSearch() {
  $('search').reset(); $('topic').value = '';
  for (const input of $('scope-filters').querySelectorAll('select')) input.value = '';
  rememberDirectory();
  await refreshAnswers();
  $('search').elements.query.focus();
}
function show(view) {
  for (const section of document.querySelectorAll('.view')) section.hidden = section.id !== view;
  for (const link of document.querySelectorAll('nav a')) {
    if (link.hash === '#' + view) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  }
}
function renderAnswers() {
  const visible = answers.filter(answer => !$('topic').value || answer.topic?.id === $('topic').value);
  $('count').textContent = `${visible.length} 条答案`;
  $('answer-list').hidden = readerView !== 'list';
  $('answer-branches').hidden = readerView !== 'branches' || !visible.length;
  $('branches-view').setAttribute('aria-pressed', String(readerView === 'branches'));
  $('list-view').setAttribute('aria-pressed', String(readerView === 'list'));
  $('reader-view-help').textContent = readerView === 'branches' ? '展开主题，查看不同陈述之间的关联与补充；也可以切回列表阅读摘要。' : '先读标题和摘要，找到相关资料后打开全文。';
  const filtered = Boolean($('search').elements.query.value.trim() || $('topic').value || [...$('scope-filters').querySelectorAll('select')].some(input => input.value));
  $('reset-search').hidden = !filtered;
  $('answer-empty').hidden = visible.length > 0;
  $('answer-empty').querySelector('h2').textContent = filtered ? '暂时没有找到相关资料' : '资料正在准备中';
  $('answer-empty').querySelector('p').textContent = filtered ? '试试更短的关键词，或清空主题和适用范围后再找一次。' : '当前还没有已发布的资料。之后可以回来看看，或在关于页面了解来源与复核方式。';
  $('empty-reset').hidden = !filtered;
  for (const button of $('reader-topics').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.topic === $('topic').value));
  renderBranches($('answer-branches'), { answers: withBranchAncestors([...answers, ...contextAnswers], visible), topics: catalog.topics, links, topicId: $('topic').value, scopes: catalog.scopes, answerHref, expandTopics: Boolean($('search').elements.query.value.trim()) });
  $('answer-list').replaceChildren();
  for (const answer of visible) {
    const item = create('article', undefined, 'answer-item');
    item.append(create('span', answer.topic?.title ?? '校园信息', 'topic-label'));
    const link = create('a'); link.href = '/answers/' + encodeURIComponent(answer.slug);
    link.addEventListener('click', event => { event.preventDefault(); history.pushState({}, '', link.href); route(); });
    link.append(create('h3', answer.title)); item.append(link, create('p', answer.summary));
    item.append(sourceBadges(answer));
    item.append(create('span', `核验 ${date(answer.verifiedAt)} · ${answer.citations.length} 项来源`, 'metadata'));
    if (answer.demo) item.append(create('span', ' · 演示内容', 'demo'));
    for (const warning of answer.warnings) item.append(create('p', warning, 'warning'));
    $('answer-list').append(item);
  }
}
async function research(payload, requestContext) {
  if (!researchActive()) { queryEventId = null; return null; }
  try {
    return await api('/api/private/command', { data: { action: 'create', type: 'research_event', consentEpoch: epoch, payload }, requestContext });
  } catch (error) {
    if (!['RESEARCH_DISABLED', 'RESEARCH_WINDOW_CLOSED'].includes(error.code)) throw error;
    notice.research.enabled = false; queryEventId = null; return null;
  }
}
function researchActive() {
  return notice?.research?.enabled === true && Date.now() >= Date.parse(notice.research.startAt) && Date.now() < Date.parse(notice.research.endAt);
}
async function refreshAnswers(record = false) {
  const generation = ++searchGeneration, participant = token;
  queryEventId = null;
  const query = new FormData($('search')).get('query');
  const scope = {};
  for (const input of $('scope-filters').querySelectorAll('select')) if (input.value) scope[input.name] = [input.value];
  const result = await api('/api/guide/branches?q=' + encodeURIComponent(query) + '&scope=' + encodeURIComponent(JSON.stringify(scope)), { auth: '' });
  if (generation !== searchGeneration) return;
  answers = result.answers; contextAnswers = result.contextAnswers ?? []; links = result.links;
  appliedQuery = query.trim();
  renderAnswers();
  if (record && participant && token === participant && epoch && query.trim() && researchActive()) {
    const normalized = query.normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim();
    const length = [...normalized].length;
    const event = await research({ kind: 'query', queryLengthBand: length <= 8 ? 'short' : length <= 40 ? 'medium' : 'long' }, { query, scope });
    if (generation === searchGeneration && token === participant) queryEventId = event?.id ?? null;
  }
}
async function detail(slug, revision, generation) {
  const answer = await api('/api/guide/answers/' + encodeURIComponent(slug) + (revision ? '?revision=' + encodeURIComponent(revision) : ''), { auth: '' });
  if (generation !== routeGeneration) return;
  const target = $('answer-detail'); target.replaceChildren(create('p', answer.topic?.title ?? '', 'eyebrow'), create('h1', answer.title));
  $('reader-back').href = directoryUrl;
  target.append(create('p', '先确认适用校区与信息时间，再通过每段下方的来源核对具体安排。', 'reader-detail-help'));
  const parentContext = create('p', undefined, 'supplement-parent'); parentContext.hidden = true; target.append(parentContext);
  const metadata = create('div', undefined, 'detail-meta');
  for (const text of [`第 ${answer.revisionNumber} 版`, `信息截至 ${date(answer.asOf)}`, `人工核验 ${date(answer.verifiedAt)}`, `复核期限 ${date(answer.reviewDueAt)}`, answer.reviewOwnerLabel]) if (text) metadata.append(create('span', text));
  target.append(metadata);
  target.append(sourceBadges(answer));
  for (const warning of answer.warnings) target.append(create('p', warning, 'warning'));
  if (answer.demo) target.append(create('p', '演示内容，真实试点前需重新审核。', 'warning'));
  const scopeLabels = Object.entries(answer.scope).flatMap(([dimension, values]) => values.map(value => catalog.scopes.find(scope => scope.dimension === dimension && (scope.id === value || scope.code === value))?.labelZh
    ?? (value === 'universal' ? universalScopeLabels[dimension] ?? '通用' : value)));
  target.append(create('p', `适用范围：${scopeLabels.join(' · ') || '尚未明确'}`, 'muted'));
  if (answer.evidenceNote) target.append(create('p', answer.evidenceNote, 'warning'));
  for (const sentence of answer.sentences) {
    target.append(create('p', sentence.text, 'answer-body'));
    for (const citation of answer.citations.filter(item => item.sentenceId === sentence.id)) {
      const box = create('div', undefined, 'citation');
      const link = create('a', citation.title); link.href = citation.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      if (sourceLabels[citation.sourceCategory]) {
        const badge = create('span', sourceLabels[citation.sourceCategory], 'source-category');
        badge.dataset.sourceCategory = citation.sourceCategory;
        box.append(badge, document.createTextNode(' '));
      }
      box.append(link, create('span', citation.mode === 'link-only' ? ' · 原站链接' : ' · 授权摘录', 'muted'));
      if (citation.publisher) box.append(create('span', ` · 发布方：${citation.publisher}`, 'muted'));
      if (citation.excerpt) box.append(create('p', citation.excerpt));
      target.append(box);
    }
  }
  target.append(create('h2', '版本记录'));
  const versions = create('div', undefined, 'history');
  for (const version of answer.history) {
    const link = create('a', `第 ${version.number} 版`); link.href = '?revision=' + encodeURIComponent(version.id);
    link.addEventListener('click', event => { event.preventDefault(); history.pushState({}, '', link.href); route(); }); versions.append(link);
  }
  target.append(versions, create('h2', '同话题的陈述与补充'));
  // Detail navigation always uses the full public set, independent of directory search.
  const branches = create('div'); target.append(branches);
  const related = await api('/api/guide/branches', { auth: '' });
  if (generation !== routeGeneration) return;
  related.answers = related.answers.filter(item => item.topic?.id === answer.topic?.id);
  const parent = related.answers.find(item => item.id === answer.supplementTo && item.id !== answer.id);
  if (parent) {
    const link = create('a', parent.title); link.href = answerHref(parent);
    parentContext.append(document.createTextNode('这条信息补充了：'), link); parentContext.hidden = false;
  }
  if (related.answers.some(item => item.id === answer.id && item.revisionId === answer.revisionId)) {
    renderBranches(branches, { ...related, topics: catalog.topics, scopes: catalog.scopes, selectedId: answer.id, topicId: answer.topic?.id, answerHref });
  } else {
    renderBranches(branches, { ...related, topics: catalog.topics, scopes: catalog.scopes, topicId: answer.topic?.id, answerHref });
    branches.prepend(create('p', '正在阅读历史修订。分支图展示各条陈述的当前公开版本。', 'muted'));
  }
  show('detail');
  if (token && epoch && queryEventId && researchActive()) {
    try {
      const queryId = queryEventId, participant = token;
      const opened = await research({ kind: 'open', queryEventId: queryId, revisionId: answer.revisionId });
      if (!opened) return;
      if (generation !== routeGeneration || queryId !== queryEventId || token !== participant) return;
      const form = create('form'), legend = create('legend', '这条答案解决了问题吗？');
      const fieldset = create('fieldset'); fieldset.append(legend);
      for (const [value, text] of [['resolved', '已解决'], ['unclear', '仍不清楚']]) {
        const label = create('label', undefined, 'check'), input = create('input');
        input.type = 'radio'; input.name = 'outcome'; input.value = value; input.required = true;
        label.append(input, create('span', text)); fieldset.append(label);
      }
      const button = create('button', '提交反馈'); form.append(fieldset, button);
      form.addEventListener('submit', event => { event.preventDefault(); action(form, async () => {
        const recorded = await research({ kind: 'feedback', queryEventId: queryId, revisionId: answer.revisionId, outcome: new FormData(form).get('outcome') });
        if (!recorded) { form.remove(); return; }
        form.replaceChildren(create('p', '反馈已记录。')); message('');
      }); });
      target.append(form);
    } catch (error) { if (generation === routeGeneration) message(error.message); }
  }
}
async function activity() {
  if (!token || !epoch) return;
  const participant = token, consent = epoch;
  const records = await api('/api/private/self');
  if (participant !== token || consent !== epoch) return;
  const visible = records.filter(record => record.type !== 'research_event');
  $('activity').replaceChildren();
  for (const record of visible) $('activity').append(create('div', `${record.type} · ${record.status} · ${date(record.updatedAt)}${record.result ? ' · ' + record.result.label : ''}`, 'activity-row'));
  if (!visible.length) $('activity').append(create('p', '暂无活动。', 'muted'));
}
async function route() {
  const generation = ++routeGeneration;
  message('');
  try {
    const match = location.pathname.match(/^\/answers\/([^/]+)(?:\/versions\/([^/]+))?$/u);
    if (match) return await detail(decodeURIComponent(match[1]), new URLSearchParams(location.search).get('revision') ?? match[2], generation);
    const view = location.pathname === '/' ? location.hash.slice(1) || 'answers' : location.pathname.slice(1);
    if (view === 'answers') {
      const previous = directoryParameters().toString();
      restoreDirectory(new URLSearchParams(location.search));
      if (previous !== directoryParameters().toString()) await refreshAnswers();
      if (generation !== routeGeneration) return;
    }
    show(['answers', 'participate', 'report', 'about'].includes(view) ? view : 'answers');
    if (view === 'about' && location.hash === '#method') $('method').scrollIntoView();
    if (view === 'participate') await activity();
  } catch (error) { if (generation === routeGeneration) { show('answers'); message(error.message); } }
}
$('search').addEventListener('submit', event => { event.preventDefault(); rememberDirectory(); action(event.target, () => refreshAnswers(true)); });
$('topic').addEventListener('change', () => applyDirectoryControls().catch(error => message(error.message)));
for (const view of ['branches', 'list']) $(view + '-view').addEventListener('click', () => { readerView = view; applyDirectoryControls().catch(error => message(error.message)); });
for (const id of ['reset-search', 'empty-reset']) $(id).addEventListener('click', () => resetSearch().catch(error => message(error.message)));
document.querySelector('.skip-link').addEventListener('click', event => { event.preventDefault(); $('main').focus(); $('main').scrollIntoView(); });
document.addEventListener('click', event => {
  const link = event.target.closest('#answer-branches a, #answer-detail .guide-branches a, #answer-detail .supplement-parent a');
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const url = new URL(link.href);
  if (url.origin !== location.origin || !url.pathname.startsWith('/answers/')) return;
  event.preventDefault(); history.pushState({}, '', link.href); route();
});
$('scope-filters').addEventListener('change', () => { rememberDirectory(); refreshAnswers().catch(error => message(error.message)); });
$('redeem').addEventListener('submit', event => {
  event.preventDefault(); action(event.target, async () => {
    const result = await api('/api/participants/redeem', { data: { token: new FormData(event.target).get('token').trim() }, auth: '' });
    token = result.token; epoch = 0; saveSession(); event.target.reset(); message('邀请已兑换。');
  });
});
$('consent').addEventListener('submit', event => {
  event.preventDefault(); action(event.target, async () => {
    const result = await api('/api/private/command', { data: { action: 'consent', type: 'question', version: notice.version, accepted: true } });
    epoch = result.consentEpoch; saveSession(); await activity(); message('已记录同意。');
  });
});
$('intake').addEventListener('submit', event => {
  event.preventDefault(); action(event.target, async () => {
    const fields = Object.fromEntries(new FormData(event.target));
    const payload = { body: fields.body, contextScope: fields.contextScope };
    if (fields.type === 'material' && fields.sourceUrl) payload.sourceUrl = fields.sourceUrl;
    if (fields.type === 'material') payload.provenanceRole = fields.provenanceRole;
    await api('/api/private/command', { data: { action: 'create', type: fields.type, consentEpoch: epoch, payload } });
    event.target.reset(); await activity(); message('线索已提交。');
  });
});
function intakeFields() {
  const material = $('intake').elements.type.value === 'material';
  $('material-fields').hidden = !material;
  $('intake').elements.provenanceRole.required = material;
  $('intake').elements.provenanceRole.disabled = !material;
  $('intake').elements.sourceUrl.disabled = !material;
  $('intake').elements.body.required = !material;
  $('intake').elements.body.minLength = material ? 0 : 10;
}
$('intake').elements.type.addEventListener('change', intakeFields);
$('intake').addEventListener('reset', () => queueMicrotask(intakeFields));
$('refresh-activity').addEventListener('click', () => activity().catch(error => message(error.message)));
$('logout').addEventListener('click', async () => { try { await api('/api/auth/logout', { data: {} }); token = ''; epoch = 0; saveSession(); $('activity').replaceChildren(); message('已退出当前设备。'); } catch (error) { message(error.message); } });
$('withdraw').addEventListener('click', async () => {
  if (!confirm('撤回将清理私有载荷和研究关联，并使全部设备退出。确认撤回？')) return;
  try { await api('/api/private/command', { data: { action: 'withdraw' } }); token = ''; epoch = 0; saveSession(); $('activity').replaceChildren(); message('已撤回同意。'); } catch (error) { message(error.message); }
});
$('report-form').addEventListener('submit', event => {
  event.preventDefault(); action(event.target, async () => {
    const fields = Object.fromEntries(new FormData(event.target));
    if (fields.type === 'privacy') {
      const data = { type: 'privacy', affectedArea: fields.affectedArea };
      if (fields.cardId) data.cardId = fields.cardId;
      const result = await api('/api/reports', { data, auth: '' });
      $('receipt-result').hidden = false; $('receipt').textContent = result.receipt;
      $('receipt-form').elements.receipt.value = result.receipt;
      message('隐私报告已受理。');
    } else {
      if (!token || !epoch) throw new Error('非隐私报告仅向已同意参与的受邀参与者开放。');
      await api('/api/private/command', { data: { action: 'create', type: 'report', consentEpoch: epoch, payload: { cardId: fields.cardId, type: fields.type } } });
      message('报告已提交，可在我的活动查看状态。');
    }
  });
});
$('receipt-form').addEventListener('submit', event => {
  event.preventDefault(); action(event.target, async () => {
    const result = await api('/api/reports/status', { auth: new FormData(event.target).get('receipt').trim() });
    $('report-status').textContent = `${result.status} · ${date(result.updatedAt)}${result.result ? ' · ' + result.result.label : ''}`;
  });
});
window.addEventListener('hashchange', route); window.addEventListener('popstate', route);
try {
  [catalog, notice] = await Promise.all([api('/api/guide/catalog', { auth: '' }), api('/api/guide/notice', { auth: '' })]);
  for (const topic of catalog.topics.filter(item => item.status !== 'hidden')) $('topic').append(option(topic.id, topic.titleZh));
  for (const topic of catalog.topics.filter(item => item.status !== 'hidden').slice(0, 6)) {
    const button = create('button', topic.titleZh, 'secondary'); button.type = 'button'; button.dataset.topic = topic.id;
    button.addEventListener('click', () => { $('topic').value = topic.id; $('topic').focus(); applyDirectoryControls().catch(error => message(error.message)); });
    $('reader-topics').append(button);
  }
  $('reader-topics').hidden = !$('reader-topics').children.length;
  for (const dimension of [...new Set(catalog.scopes.map(scope => scope.dimension))]) {
    const label = create('label', { campus: '校区', audience: '人群', academic_year: '入学届' }[dimension] ?? dimension);
    const select = create('select'); select.name = dimension; select.append(option('', '不限'));
    for (const scope of catalog.scopes.filter(item => item.dimension === dimension && item.status !== 'hidden')) select.append(option(scope.code, scope.labelZh));
    label.append(select); $('scope-filters').append(label);
  }
  const terms = create('dl');
  for (const section of notice.sections ?? []) terms.append(create('dt', section.term), create('dd', section.detail));
  $('notice').append(terms); $('consent-text').textContent = notice.consent ?? '同意参与'; saveSession();
  if (token) { try { await api('/api/auth/me'); } catch (error) { message(error.message); } }
  intakeFields();
  await refreshAnswers();
  for (const answer of answers) $('report-card').append(option(answer.id, answer.title));
  const initialDirectory = directoryParameters().toString();
  restoreDirectory(location.pathname === '/' || location.pathname === '/answers' ? new URLSearchParams(location.search) : new URLSearchParams());
  if (initialDirectory !== directoryParameters().toString()) await refreshAnswers();
  await route();
} catch (error) { message(error.message); }
