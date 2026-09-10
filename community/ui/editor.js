import { createArticleReview, reviewDecisionLabels } from './batch-review.js';

const $ = selector => document.querySelector(selector);
const sessionKey = 'guide-editor-session';
const pageSize = 8;
const typeLabels = { question: '问题线索', material: '材料投稿', report: '内容报告', privacy_report: '隐私报告', research_event: '研究记录' };
const statusLabels = { submitted: '待筛查', screening: '筛查中', actioned: '已采用', rejected: '未采用', expired: '已到期', received: '待受理', reviewing: '审核中', resolved: '已处理', closed: '已关闭', recorded: '已记录' };
const fieldLabels = { title: '标题', body: '正文', text: '内容', note: '说明', description: '描述', summary: '摘要', reportType: '报告类型', reason: '理由', category: '分类', question: '问题', material: '材料', url: '链接', sourceUrl: '来源链接', entityId: '关联内容', revisionId: '关联修订' };
let token = sessionStorage.getItem(sessionKey) ?? '';
let principal = null;
let generation = 0;
let detailGeneration = 0;
let revisionGeneration = 0;
let historyGeneration = 0;
let rows = [];
let selected = null;
let page = 0;
let workflows = {};
let permissions = [];
const retries = new Map();
let suspendedReview = null;
let resumingReview = null;
const articleReview = createArticleReview({ api, mutate, message, errorMessage, getPermissions: () => permissions });

function message(text = '', kind = 'status') {
  $('#message').textContent = text;
  $('#message').dataset.kind = kind;
  $('#message').hidden = !text;
}

function clearDetail() {
  detailGeneration++;
  selected = null;
  $('#record-detail').hidden = true;
  $('#detail-empty').hidden = false;
  $('#detail-empty').textContent = '未选择私件';
  for (const id of ['detail-title', 'detail-status', 'detail-meta', 'payload', 'internal-notes']) $(`#${id}`).replaceChildren();
  $('#transition-form').reset();
  $('#transition-form [name=status]').replaceChildren();
  $('#transition-form [name=decisionCode]').replaceChildren();
}

function clearSensitive() {
  generation++;
  revisionGeneration++;
  historyGeneration++;
  rows = [];
  page = 0;
  retries.clear();
  suspendedReview = null;
  resumingReview = null;
  articleReview.clear();
  clearDetail();
  for (const id of ['record-list', 'queue-count', 'revision-result', 'review-history-result']) $(`#${id}`).replaceChildren();
  for (const form of ['login-form', 'content-form', 'revision-form']) $(`#${form}`).reset();
  $('#page-label').textContent = '0 / 0';
  $('#previous-page').disabled = true;
  $('#next-page').disabled = true;
  updateContentFields();
}

function forgetSession() {
  token = '';
  principal = null;
  permissions = [];
  sessionStorage.removeItem(sessionKey);
  clearSensitive();
  $('#operator').textContent = '';
  $('#session-bar').hidden = true;
  $('#workspace').hidden = true;
  $('#login-section').hidden = false;
}

function errorMessage(error) {
  if (error.code === 'STALE_RESPONSE') return;
  const known = {
    UNAUTHENTICATED: '会话已失效，请重新登录。', INVALID_CREDENTIALS: '账户、密码或验证码不正确。',
    FORBIDDEN: '当前账户没有执行此操作的权限。', RECORD_EXPIRED: '该私件已到期或撤回，详情已清除。',
    VERSION_CONFLICT: '私件已被其他操作更新，请刷新后重新核对。',
    CONFLICT: '内容版本或审核记录已变化，请刷新后重新核对。',
    IDEMPOTENCY_CONFLICT: '重复请求的内容不一致，请刷新后重新核对。',
    RATE_LIMITED: '尝试次数过多，请稍后重试。',
    PERSONAL_DATA: '内部备注不能包含邮箱、电话、学号或证件号。',
    GUIDE_REASON: '审核理由需要 8 至 400 字；请检查所填内容。',
    GUIDE_REVIEW_MODE: '工作台已更新为通过并发布，请重新加载页面后核对并提交。',
    CONTENT_HIDDEN: '所选文章已隐藏，请先处理可见性再审核发布；本批未保存。',
    SOURCE_UNAVAILABLE: '所选文章的引用来源已隐藏、撤回或使用权到期；本批未保存，请核对来源。',
    POLICY_REJECTED: '所选文章尚不满足发布规则；本批未保存。高影响内容仍需相应审核流程。',
    EVIDENCE_REQUIRED: '所选文章有事实句缺少有效引用；本批未保存，请补齐引用后重审。',
    GUIDE_DECISION: '处理中不能提前记录结案结果。',
    GUIDE_RESULT_LINK: '请核对结果关联的答案与精确版本；隐藏结论须关联已隐藏答案。',
    GUIDE_RESULT_IMMUTABLE: '追加备注不能改变已经记录的决定与结果关联。',
    GUIDE_NO_CHANGE: '请添加备注或调整负责人。',
    GUIDE_FIELD: '请核对字段内容、长度与所选决定。',
  };
  message(known[error.code] ?? (error.status ? `操作未完成（${error.code ?? error.status}）。` : '网络暂不可用。再次提交相同内容将沿用本次请求编号。'), 'error');
}

async function api(path, { input, key } = {}) {
  const current = generation;
  const response = await fetch(path, {
    method: input === undefined ? 'GET' : 'POST', cache: 'no-store',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(input === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  });
  const body = await response.json();
  if (current !== generation) throw Object.assign(new Error('Stale response'), { code: 'STALE_RESPONSE' });
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/auth/login') forgetSession();
    else if ([403, 410].includes(response.status)) clearSensitive();
    throw Object.assign(new Error('Request rejected'), { status: response.status, code: body.code });
  }
  return body;
}

async function mutate(path, input) {
  const fingerprint = JSON.stringify([path, input]);
  if (!retries.has(fingerprint)) retries.set(fingerprint, crypto.randomUUID());
  const result = await api(path, { input, key: retries.get(fingerprint) });
  retries.delete(fingerprint);
  return result;
}

function option(value, text) {
  const node = document.createElement('option');
  node.value = value;
  node.textContent = text;
  return node;
}

function date(value) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString('zh-CN', { hour12: false }) : '-';
}

function renderValue(container, value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const list = document.createElement('dl');
    for (const [key, entry] of Object.entries(value)) {
      const term = document.createElement('dt'), definition = document.createElement('dd');
      term.textContent = fieldLabels[key] ?? key;
      if (entry && typeof entry === 'object') {
        const pre = document.createElement('pre');
        pre.textContent = JSON.stringify(entry, null, 2);
        definition.append(pre);
      } else definition.textContent = entry === null ? '-' : String(entry);
      list.append(term, definition);
    }
    container.replaceChildren(list);
  } else {
    const pre = document.createElement('pre');
    pre.textContent = value === null || value === undefined ? '无可读取正文' : typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    container.replaceChildren(pre);
  }
}

function deadline(row) {
  const hours = row.type === 'privacy_report' ? 1 : row.reportType === 'source_mismatch' ? 24 : 72;
  return Number(row.createdAt) + hours * 3_600_000;
}

function isClosed(row) {
  return row.purgedAt !== null || Number(row.expiresAt) <= Date.now() || (workflows[row.type]?.terminalStates ?? []).includes(row.status);
}

function filteredRows() {
  const type = $('#type-filter').value, status = $('#status-filter').value;
  const result = rows.filter(row => (!type || row.type === type) && (!status || row.status === status));
  const sort = $('#sort-filter').value;
  result.sort((a, b) => {
    if (sort === 'newest') return b.createdAt - a.createdAt;
    if (sort === 'oldest') return a.createdAt - b.createdAt;
    if (sort === 'updated') return b.updatedAt - a.updatedAt;
    return Number(isClosed(a)) - Number(isClosed(b)) || Number(b.type === 'privacy_report') - Number(a.type === 'privacy_report') || deadline(a) - deadline(b);
  });
  return result;
}

function renderQueue() {
  const filtered = filteredRows(), pages = Math.ceil(filtered.length / pageSize);
  page = Math.max(0, Math.min(page, Math.max(0, pages - 1)));
  $('#queue-count').textContent = `${filtered.length} 件`;
  $('#page-label').textContent = `${pages ? page + 1 : 0} / ${pages}`;
  $('#previous-page').disabled = page === 0;
  $('#next-page').disabled = page + 1 >= pages;
  const list = $('#record-list');
  list.replaceChildren();
  for (const row of filtered.slice(page * pageSize, (page + 1) * pageSize)) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'record-row';
    button.setAttribute('aria-pressed', String(selected?.id === row.id));
    const top = document.createElement('span'), title = document.createElement('span'), badge = document.createElement('span');
    top.className = 'record-top';
    title.textContent = typeLabels[row.type] ?? row.type;
    badge.className = row.type === 'privacy_report' && !isClosed(row) ? 'tag urgent' : 'tag';
    badge.textContent = statusLabels[row.status] ?? row.status;
    top.append(title, badge);
    const id = document.createElement('span'), time = document.createElement('span');
    id.className = 'record-id'; id.textContent = row.id;
    time.className = 'record-time';
    time.textContent = isClosed(row) ? `更新 ${date(row.updatedAt)}` : `处理时限 ${date(deadline(row))}`;
    if (!isClosed(row) && deadline(row) < Date.now()) time.classList.add('due-soon');
    button.append(top, id, time);
    button.addEventListener('click', () => loadDetail(row.id).catch(errorMessage));
    list.append(button);
  }
  if (!filtered.length) {
    const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = '暂无符合条件的私件'; list.append(empty);
  }
}

function configureFilters() {
  const type = $('#type-filter'), status = $('#status-filter');
  const oldType = type.value, oldStatus = status.value;
  type.replaceChildren(option('', '全部分类'));
  for (const name of Object.keys(workflows)) type.append(option(name, typeLabels[name] ?? name));
  type.value = Object.hasOwn(workflows, oldType) ? oldType : '';
  status.replaceChildren(option('', '全部状态'));
  const states = [...new Set(Object.entries(workflows).filter(([name]) => !type.value || name === type.value).flatMap(([, workflow]) => workflow.states ?? []))];
  for (const name of states) status.append(option(name, statusLabels[name] ?? name));
  status.value = states.includes(oldStatus) ? oldStatus : '';
}

function showView(name) {
  if ($(`#${name}-tab`).getAttribute('aria-selected') !== 'true') {
    generation++;
    revisionGeneration++;
    historyGeneration++;
    retries.clear();
    suspendedReview = null;
    resumingReview = null;
    articleReview.clear();
    clearDetail();
    $('#revision-result').replaceChildren();
    $('#review-history-result').replaceChildren();
    $('#content-form').reset();
    $('#revision-form').reset();
    updateContentFields();
  }
  for (const view of ['queue', 'content']) {
    const active = name === view;
    $(`#${view}-tab`).setAttribute('aria-selected', String(active));
    $(`#${view}-view`).hidden = !active;
  }
}

async function refreshWorkspace(savedReview = null) {
  clearSensitive();
  resumingReview = savedReview;
  message();
  $('#workspace').hidden = false;
  const config = await api('/api/guide/editor-config');
  workflows = config.workflows ?? {};
  permissions = config.permissions ?? [];
  configureFilters();
  const canQueue = permissions.includes('lifecycle:manage');
  const canContent = ['content:read', 'content:publish', 'content:visibility'].some(permission => permissions.includes(permission));
  $('#queue-tab').disabled = !canQueue;
  $('#content-tab').disabled = !canContent;
  $('#revision-form button').disabled = !permissions.includes('content:read');
  $('#review-history').disabled = !['content:read', 'content:visibility'].some(permission => permissions.includes(permission));
  if (!canQueue || $('#content-tab').getAttribute('aria-selected') === 'true') showView('content');
  else showView('queue');
  const current = generation, currentPrincipal = principal?.id;
  if (canQueue) {
    rows = await api('/api/private/list');
    renderQueue();
  }
  if ($('#content-tab').getAttribute('aria-selected') === 'true') {
    await articleReview.load(savedReview?.review ?? null);
    if (current !== generation || currentPrincipal !== principal?.id) return;
    for (const [fingerprint, key] of savedReview?.retries ?? []) retries.set(fingerprint, key);
  }
  if (current === generation && currentPrincipal === principal?.id) resumingReview = null;
}

async function loadDetail(id) {
  clearDetail();
  $('#detail-empty').textContent = '正在读取';
  const current = detailGeneration;
  const record = await api(`/api/private/${encodeURIComponent(id)}`);
  if (current !== detailGeneration) return;
  if (!record.payload || record.purgedAt !== null || Number(record.expiresAt) <= Date.now()) {
    clearDetail();
    $('#detail-empty').textContent = '该私件已到期或撤回，正文不可读取。';
    return;
  }
  selected = record;
  $('#detail-empty').hidden = true;
  $('#record-detail').hidden = false;
  $('#detail-title').textContent = record.id;
  $('#detail-status').textContent = statusLabels[record.status] ?? record.status;
  for (const [label, value] of [['分类', typeLabels[record.type] ?? record.type], ['版本', record.version], ['收到时间', date(record.createdAt)], ['处理时限', date(deadline({ ...record, reportType: record.payload?.data?.type ?? record.payload?.data?.reportType }))], ['保留至', date(record.expiresAt)], ['负责人', record.assignee ?? '-']]) {
    const term = document.createElement('dt'), definition = document.createElement('dd');
    term.textContent = label; definition.textContent = String(value); $('#detail-meta').append(term, definition);
  }
  renderValue($('#payload'), record.payload.data ?? record.payload);
  const notes = record.payload.internalNotes ?? [];
  if (!notes.length) $('#internal-notes').textContent = '暂无内部备注';
  for (const note of notes) {
    const article = document.createElement('article'), text = document.createElement('p'), metadata = document.createElement('small');
    article.className = 'note'; text.textContent = note.text;
    metadata.textContent = `${note.actorId} · ${date(note.createdAt)}`;
    article.append(text, metadata); $('#internal-notes').append(article);
  }
  const workflow = workflows[record.type] ?? {}, next = workflow.transitions?.[record.status] ?? [];
  const form = $('#transition-form');
  form.hidden = !next.length;
  $('#record-closed').hidden = Boolean(next.length);
  for (const status of next) form.elements.status.append(option(status, statusLabels[status] ?? status));
  if (next.includes(record.status)) form.elements.status.value = record.status;
  form.elements.decisionCode.append(option('', '无'));
  for (const code of workflow.decisionCodes ?? []) form.elements.decisionCode.append(option(code, `${code} · ${workflow.publicResults?.[code]?.label ?? code}`));
  form.elements.decisionCode.value = record.decisionCode ?? '';
  for (const field of ['entityId', 'revisionId', 'assignee']) form.elements[field].value = record[field] ?? '';
  updateTransitionFields();
  renderQueue();
  if (matchMedia('(max-width: 640px)').matches) $('#detail-pane').scrollIntoView({ block: 'start', behavior: 'smooth' });
}

async function busy(form, work) {
  const button = form.querySelector('button[type=submit]');
  button.disabled = true; button.setAttribute('aria-busy', 'true');
  try { await work(); } catch (error) { errorMessage(error); }
  finally { button.disabled = false; button.removeAttribute('aria-busy'); }
}

$('#login-form').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  const input = { accountId: form.elements.accountId.value.trim(), password: form.elements.password.value, code: form.elements.code.value.trim() };
  busy(form, async () => {
    clearSensitive();
    const result = await api('/api/auth/login', { input });
    token = result.token; principal = result.principal;
    sessionStorage.setItem(sessionKey, token);
    showSession();
    await refreshWorkspace();
  });
});

function showSession() {
  $('#operator').textContent = principal.displayName ?? principal.id;
  $('#session-bar').hidden = false;
  $('#login-section').hidden = true;
}

$('#logout').addEventListener('click', async () => {
  const outgoing = token;
  forgetSession();
  message();
  if (!outgoing) return;
  try {
    const response = await fetch('/api/auth/logout', { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${outgoing}` }, body: '{}' });
    if (!response.ok && response.status !== 401) message('本地会话已清除；服务端退出未确认。', 'error');
  } catch { message('本地会话已清除；服务端退出未确认。', 'error'); }
});
$('#refresh').addEventListener('click', () => refreshWorkspace().catch(errorMessage));
for (const view of ['queue', 'content']) $(`#${view}-tab`).addEventListener('click', () => {
  const changed = $(`#${view}-tab`).getAttribute('aria-selected') !== 'true';
  showView(view);
  if (changed && view === 'content') articleReview.load().catch(errorMessage);
});
$('#type-filter').addEventListener('change', () => { clearDetail(); configureFilters(); page = 0; renderQueue(); });
for (const name of ['status-filter', 'sort-filter']) $(`#${name}`).addEventListener('change', () => { clearDetail(); page = 0; renderQueue(); });
$('#previous-page').addEventListener('click', () => { clearDetail(); page--; renderQueue(); });
$('#next-page').addEventListener('click', () => { clearDetail(); page++; renderQueue(); });

$('#transition-form').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget, record = selected;
  if (!record) return;
  const input = { action: 'transition', id: record.id, expectedVersion: record.version,
    status: form.elements.status.value, decisionCode: form.elements.decisionCode.value || null,
    assignee: form.elements.assignee.value.trim() || null,
  };
  for (const field of ['entityId', 'revisionId', 'note']) if (form.elements[field].value.trim()) input[field] = form.elements[field].value.trim();
  busy(form, async () => {
    await mutate('/api/private/command', input);
    await refreshWorkspace();
    await loadDetail(record.id);
    message('处理决定已保存。');
  });
});

function updateTransitionFields() {
  const form = $('#transition-form');
  const terminal = ['actioned', 'rejected', 'resolved', 'closed'].includes(form.elements.status.value);
  form.elements.note.required = terminal && selected?.status !== form.elements.status.value;
  form.elements.note.minLength = form.elements.note.required ? 8 : 4;
}
$('#transition-form [name=status]').addEventListener('change', updateTransitionFields);

function updateContentFields() {
  const form = $('#content-form'), action = form.elements.action.value;
  $('#publish-revision-field').hidden = action !== 'publish';
  form.elements.revisionId.required = action === 'publish';
  $('#hidden-field').hidden = action !== 'hide';
  $('#disposition-field').hidden = action !== 'source';
}
$('#content-form [name=action]').addEventListener('change', updateContentFields);

async function loadHistory(entityId) {
  const current = ++historyGeneration;
  $('#review-history-result').replaceChildren();
  const result = await api(`/api/guide/reviews?entityId=${encodeURIComponent(entityId)}`);
  if (current !== historyGeneration) return;
  const history = Array.isArray(result) ? result : result.reviews ?? [];
  if (!history.length) $('#review-history-result').textContent = '暂无审核记录';
  for (const entry of history) {
    const article = document.createElement('article'), text = document.createElement('p'), meta = document.createElement('small');
    article.className = 'note'; text.textContent = entry.reason;
    meta.textContent = `${entry.actorId} · ${entry.action} · v${entry.version} · ${date(entry.createdAt)}`;
    article.append(text, meta);
    if (entry.outcome) {
      const outcome = document.createElement('p');
      const labels = [];
      if (entry.action === 'content.review' && entry.outcome.decision) labels.push(`审核结论：${reviewDecisionLabels[entry.outcome.decision] ?? entry.outcome.decision}`);
      if (entry.outcome.publishedRevisionId) labels.push(`本次审核发布修订 ${entry.outcome.publishedRevisionId}`);
      if (typeof entry.outcome.hidden === 'boolean') labels.push(entry.outcome.hidden ? '已隐藏' : '未隐藏');
      if (entry.action === 'content.source' && entry.outcome.disposition) labels.push(({ active: '来源有效', withdrawn: '来源已撤回', 'rights-expired': '来源使用权到期' })[entry.outcome.disposition] ?? entry.outcome.disposition);
      if (entry.outcome.publicRevisionId) labels.push(`公开修订 ${entry.outcome.publicRevisionId}`);
      outcome.className = 'muted'; outcome.textContent = labels.join(' · '); article.append(outcome);
    }
    $('#review-history-result').append(article);
  }
}

$('#review-history').addEventListener('click', () => {
  const id = $('#content-form').elements.entityId.value.trim();
  if (!id) return message('请填写内容或来源 ID。', 'error');
  loadHistory(id).catch(errorMessage);
});

$('#content-form').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget, action = form.elements.action.value;
  const input = { entityId: form.elements.entityId.value.trim(), expectedVersion: Number(form.elements.expectedVersion.value), reason: form.elements.reason.value.trim() };
  if (action === 'publish') input.revisionId = form.elements.revisionId.value.trim();
  if (action === 'hide') input.hidden = form.elements.hidden.value === 'true';
  if (action === 'source') input.disposition = form.elements.disposition.value;
  busy(form, async () => {
    const result = await mutate(`/api/content/${action}`, input);
    form.elements.expectedVersion.value = result.version;
    form.elements.reason.value = '';
    if (['content:read', 'content:visibility'].some(permission => permissions.includes(permission))) await loadHistory(input.entityId);
    message(`操作已执行，当前实体版本 ${result.version}。`);
  });
});

$('#revision-form').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget, id = form.elements.revisionId.value.trim(), current = ++revisionGeneration;
  $('#revision-result').replaceChildren();
  busy(form, async () => {
    const result = await api(`/api/editor/revisions/${encodeURIComponent(id)}`);
    if (current === revisionGeneration) renderValue($('#revision-result'), result);
  });
});

async function restoreSession(savedReview = null) {
  if (!token) return;
  resumingReview = savedReview;
  try {
    principal = await api('/api/auth/me');
    showSession();
    await refreshWorkspace(savedReview?.principalId === principal.id ? savedReview : null);
  } catch (error) { errorMessage(error); }
}

window.addEventListener('pagehide', clearSensitive);
window.addEventListener('pageshow', event => { if (event.persisted) restoreSession(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    const review = articleReview.snapshot();
    const savedReview = $('#content-tab').getAttribute('aria-selected') === 'true' ? review ? {
      review, principalId: principal?.id,
      retries: [...retries].filter(([fingerprint]) => fingerprint.startsWith('["/api/guide/reviews/batch",')),
    } : suspendedReview ?? resumingReview : null;
    clearSensitive(); suspendedReview = savedReview; $('#workspace').hidden = true;
  } else if (token) {
    const savedReview = suspendedReview; suspendedReview = null;
    restoreSession(savedReview);
  }
});
setInterval(() => {
  if (selected && Number(selected.expiresAt) <= Date.now()) {
    clearSensitive();
    message('该私件已到期，详情已清除。', 'error');
  }
}, 15_000);
clearSensitive();
restoreSession();
