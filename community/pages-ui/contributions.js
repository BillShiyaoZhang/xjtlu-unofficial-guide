// GitHub supports template, title and body query parameters. A Markdown template
// lets readers review one complete draft without filling a second form.
export const contributionTypes = {
  new: { title: '新增 / 补充信息', prefix: '新资料', label: '信息正文', description: '补充手册尚未覆盖的事项、办理入口、流程变化或可靠资料。', help: '写清主要内容、适用条件，以及仍待确认的部分。' },
  supplement: { title: '补充当前陈述', prefix: '补充', label: '补充内容', description: '为当前陈述增加说明、来源或细节，经编辑核对后作为它的下级分支，保留独立来源与核验状态。', help: '写清补充哪一点、新增的信息及适用条件。也可以继续补充已有的补充信息。' },
  correction: { title: '更正 / 报告过期', prefix: '纠错', label: '哪里需要更正', description: '指出过时内容、失效链接或表述错误；暂时没有依据也可以先报告问题。', help: '说明原来的说法或位置、遇到的问题，以及你建议如何更正。' },
  experience: { title: '分享个人经验', prefix: '个人经验', label: '你的经历', description: '分享亲历过程，也欢迎提供与现有手册不同的经历。', help: '说明当时的场景、处理过程和结果，并区分亲历、听说和推测。' },
};

// A conservative limit avoids opening a URL that GitHub may reject with 414.
// Never truncate a contribution to fit: the UI offers the complete text instead.
export const maxContributionUrlLength = 7500;
export function validContributionsRepository(repository) {
  return typeof repository === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9._-]{1,100}$/u.test(repository)
    && !['.', '..'].includes(repository.split('/')[1]);
}

export function contributionArticle(snapshot, parameters) {
  const answer = snapshot.answers.find(value => value.id === parameters.get('article'));
  if (!answer) return null;
  let url = '';
  try {
    const base = new URL(snapshot.site.publicUrl);
    if (base.protocol === 'https:' && !base.username && !base.password) url = new URL('#/answers/' + encodeURIComponent(answer.id), base).href;
  } catch { /* Never copy untrusted route parameters or an unsafe site URL. */ }
  return { answer, url };
}

export function buildContributionDraft({ repository, values, article = null }) {
  if (!validContributionsRepository(repository)) throw new Error('投稿入口暂未开放。');
  const kind = Object.hasOwn(contributionTypes, values.type) ? contributionTypes[values.type] : null;
  if (!kind) throw new Error('请选择投稿类型。');
  if (values.type === 'supplement' && (!article?.answer || typeof article.answer.id !== 'string' || !article.answer.id.trim()
    || typeof article.answer.revisionId !== 'string' || !article.answer.revisionId.trim() || !Number.isInteger(article.answer.revisionNumber) || article.answer.revisionNumber < 1)) {
    throw new Error('请先从公开文章的“补充这条信息”入口选择要补充的陈述。');
  }
  const fields = ['title', 'content', 'source', 'campus', 'audience', 'time', 'ai'];
  const data = Object.fromEntries(fields.map(field => [field, String(values[field] ?? '').trim()]));
  if (fields.some(field => !data[field] && !(field === 'source' && values.type === 'correction'))) throw new Error('请完整填写必填内容。');
  if (values.public !== true) throw new Error('请确认投稿内容可以公开。');
  const sections = [
    ['投稿类型', kind.title], [kind.label, data.content], ['来源或依据', data.source || '暂未提供'],
    ['适用校区', data.campus], ['适用人群', data.audience], ['发生或有效时间', data.time], ['AI 参与说明', data.ai],
  ];
  if (article) sections.push(['关联文章', [article.answer.title, article.url, `文章 ID：${article.answer.id}`, `阅读版本：${article.answer.revisionId}（第 ${article.answer.revisionNumber} 版）`].filter(Boolean).join('\n')]);
  if (values.type === 'supplement') sections.push(['补充分支', `补充父陈述 ID：${article.answer.id}\n父陈述公开版本：${article.answer.revisionId}（第 ${article.answer.revisionNumber} 版）\n关系：补充当前陈述，作为其下级分支；请编辑核对后再纳入公开指南。`]);
  sections.push(['公开提交确认', '我知道此投稿及附件会公开，确认未包含个人资料、账号密码或非公开内部材料。']);
  const body = sections.map(([label, value]) => `### ${label}\n\n${value}`).join('\n\n');
  const title = `[${kind.prefix}] ${data.title}`;
  const url = new URL(`https://github.com/${repository}/issues/new`);
  url.searchParams.set('template', 'website-contribution.md');
  url.searchParams.set('title', title);
  const fallbackUrl = url.href;
  url.searchParams.set('body', body);
  return { title, body, url: url.href, fallbackUrl, tooLong: url.href.length > maxContributionUrlLength };
}

let current;
const drafts = new Map();
let initialized = false;
const $ = id => document.getElementById(id);
const make = (tag, text, className) => {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
};

function clearResult() {
  $('contribution-status').hidden = true;
  $('contribution-open').hidden = true;
  $('contribution-open').removeAttribute('href');
  $('contribution-long').hidden = true;
  $('contribution-long-open').removeAttribute('href');
  $('contribution-copy-body').value = '';
}

function updateType() {
  const kind = contributionTypes[$('contribution-type').value];
  $('contribution-type-description').textContent = kind.description;
  $('contribution-content-label').textContent = kind.label;
  $('contribution-content-help').textContent = kind.help;
  const optionalSource = $('contribution-type').value === 'correction';
  $('contribution-source').required = !optionalSource;
  $('contribution-source').setCustomValidity('');
  $('contribution-source-required').textContent = optionalSource ? '选填' : '必填';
  $('contribution-source-help').textContent = optionalSource ? '有公开依据请附链接；暂时没有补充依据也可以留空。' : '个人经历可以填写“本人经历”，不需要寻找官方链接。';
}

function setStatus(text) {
  $('contribution-status').textContent = text;
  $('contribution-status').hidden = false;
}

function initialize() {
  if (initialized) return;
  initialized = true;
  const form = $('contribution-form');
  form.addEventListener('input', event => {
    if (typeof event.target.setCustomValidity === 'function') event.target.setCustomValidity('');
    clearResult();
  });
  $('contribution-type').addEventListener('change', () => { updateType(); clearResult(); });
  form.addEventListener('submit', event => {
    event.preventDefault();
    clearResult();
    for (const field of form.querySelectorAll('input[required]:not([type=checkbox]), textarea[required]')) {
      field.setCustomValidity(field.value.trim() ? '' : '请填写内容，不能仅输入空格。');
    }
    if (!form.reportValidity()) return;
    const values = Object.fromEntries(new FormData(form));
    values.public = $('contribution-public').checked;
    let draft;
    try { draft = buildContributionDraft({ ...current, values }); }
    catch (error) { setStatus(error.message); return; }
    if (draft.tooLong) {
      $('contribution-copy-body').value = draft.body;
      $('contribution-long-open').href = draft.fallbackUrl;
      $('contribution-long').hidden = false;
      setStatus('投稿内容较长，已保留完整正文。请使用下方复制入口，或精简后重试。');
      return;
    }
    $('contribution-open').href = draft.url;
    $('contribution-open').hidden = false;
    $('contribution-open').click();
    setStatus('请在新打开的 GitHub 页面核对并提交。尚未创建 Issue；若页面未打开，可点击下方链接重试。');
  });
  $('contribution-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('contribution-copy-body').value);
      setStatus('完整正文已复制，请到 GitHub 粘贴并确认提交。');
    } catch {
      $('contribution-copy-body').focus();
      $('contribution-copy-body').select();
      setStatus('无法自动复制，已选中完整正文。请使用复制命令，再到 GitHub 粘贴并提交。');
    }
  });
}

export function renderContribution(snapshot, parameters) {
  initialize();
  const form = $('contribution-form');
  if (current) drafts.set(current.key, {
    values: Object.fromEntries(new FormData(form)),
    public: $('contribution-public').checked,
    revision: current.article?.answer.revisionId,
  });
  clearResult();
  const repository = snapshot.site.contributionsRepository;
  const enabled = validContributionsRepository(repository);
  const article = contributionArticle(snapshot, parameters);
  const requestedType = parameters.get('type');
  const key = (article ? `article:${article.answer.id}` : 'general') + (article && requestedType === 'supplement' ? ':supplement' : '');
  const draft = drafts.get(key);
  form.reset();
  for (const field of form.querySelectorAll('input, textarea, select')) field.setCustomValidity('');
  if (draft) {
    for (const [name, value] of Object.entries(draft.values)) {
      if (name !== 'public') form.elements.namedItem(name).value = value;
    }
    $('contribution-public').checked = draft.public && draft.revision === article?.answer.revisionId;
  } else if (Object.hasOwn(contributionTypes, requestedType) && (requestedType !== 'supplement' || article)) {
    $('contribution-type').value = requestedType;
  }
  $('contribution-type').querySelector('option[value="supplement"]').disabled = !article;
  if (!article && $('contribution-type').value === 'supplement') $('contribution-type').value = 'new';
  $('contribution-supplement-help').hidden = Boolean(article);
  current = { repository, article, key };
  const context = $('contribution-context');
  context.replaceChildren();
  context.hidden = !parameters.has('article');
  if (article) {
    const { answer } = article;
    const back = make('a', answer.title);
    back.href = '#/answers/' + encodeURIComponent(answer.id);
    const description = make('p', '正在补充：');
    description.append(back, make('span', ` · 第 ${answer.revisionNumber} 版`, 'muted'));
    context.append(description, make('p', '文章链接和当前公开版本会随正文带入 GitHub。选择“补充当前陈述”时，也会注明补充分支的父陈述。', 'muted'));
    if (parameters.has('revision') && parameters.get('revision') !== answer.revisionId) context.append(make('p', '这篇文章已更新，将引用当前公开版本。', 'muted'));
  } else if (parameters.has('article')) context.append(make('p', '未找到关联的公开文章，可按通用投稿继续补充。', 'muted'));
  $('contribution-unavailable').hidden = enabled;
  $('contribution-form').hidden = !enabled;
  updateType();
}

// Issue URL parameters only prepare a draft; posting an issue/comment is a
// separate action. In particular there is no documented comment-body query:
// https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue#creating-an-issue-from-a-url-query
// https://docs.github.com/en/rest/issues/comments#create-an-issue-comment
const quickMemoryDrafts = new Map();
const quickFields = ['content', 'sourceNature', 'campus', 'time', 'source', 'title'];
const quickIdentifier = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u.test(value);
const quickValues = values => Object.fromEntries(quickFields.map(name => [name, typeof values?.[name] === 'string' ? values[name] : '']));
let quickInstance = 0;

function quickReplyUrl(repository, reply) {
  const number = Number(reply.number);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('没有找到可以回复的 GitHub 讨论。');
  const canonical = new URL(`https://github.com/${repository}/issues/${number}`);
  if (reply.url) {
    let supplied;
    try { supplied = new URL(reply.url); } catch { throw new Error('原讨论链接无效。'); }
    if (supplied.origin !== canonical.origin || supplied.pathname.toLowerCase() !== canonical.pathname.toLowerCase()
      || supplied.username || supplied.password || supplied.search || (supplied.hash && !/^#issuecomment-\d+$/u.test(supplied.hash))) {
      throw new Error('原讨论链接与本站投稿仓库不一致。');
    }
    canonical.hash = supplied.hash;
  }
  return canonical.href;
}

/** Builds complete text without shortening user content or sending a request. */
export function buildQuickContributionDraft({ snapshot, repository = snapshot?.site?.contributionsRepository, topic, article = null, reply = null, values = {} }) {
  if (!validContributionsRepository(repository)) throw new Error('分享入口暂未开放，仍可在这里写下并保存草稿。');
  if (!quickIdentifier(topic?.id)) throw new Error('没有找到有效的共建话题。');
  if (article && !quickIdentifier(article.id)) throw new Error('关联文章无效。');
  const data = Object.fromEntries(Object.entries(quickValues(values)).map(([name, value]) => [name, value.trim()]));
  if (!data.content) throw new Error('先写一点你的经历、发现或想补充的信息。');
  if (values.public !== true) throw new Error('请确认你的 GitHub 用户名和正文可以公开。');
  const destination = reply ? quickReplyUrl(repository, reply) : null;
  const title = data.title || `[经验共建] ${String(topic.title || topic.id).trim()}`;
  const context = [`<!-- xjtlu-topic:${topic.id} -->`, `共建话题：${String(topic.title || topic.id).trim()}`];
  if (quickIdentifier(topic.catalogTopicId)) context.push(`知识分类 ID：${topic.catalogTopicId}`);
  if (article) {
    context.push(`关联文章：${String(article.title || article.id).trim()}`, `文章 ID：${article.id}`);
    if (quickIdentifier(article.revisionId)) context.push(`阅读版本：${article.revisionId}${Number.isInteger(article.revisionNumber) && article.revisionNumber > 0 ? `（第 ${article.revisionNumber} 版）` : ''}`);
    try {
      const base = new URL(snapshot?.site?.publicUrl);
      if (base.protocol === 'https:' && !base.username && !base.password) context.push(new URL(`#/answers/${encodeURIComponent(article.id)}`, base).href);
    } catch { /* An optional public article URL must never become an unsafe link. */ }
  }
  if (reply) {
    context.push(`回复原讨论：${destination}`);
    if (quickIdentifier(String(reply.id ?? ''))) context.push(`回复对象 ID：${reply.id}`);
  }
  const background = [['来源性质', data.sourceNature], ['校区', data.campus], ['学期 / 发生时间', data.time], ['链接或补充依据', data.source]]
    .filter(([, value]) => value).map(([label, value]) => `**${label}**：${value}`).join('\n\n');
  const body = [context.join('\n'), `### ${reply ? '我的回复' : '我的分享'}\n\n${data.content}`, background && `### 补充背景\n\n${background}`,
    '### 公开提交确认\n\n我知道在 GitHub 确认提交后，我的 GitHub 用户名和这段正文会公开。']
    .filter(Boolean).join('\n\n');
  if (reply) return { mode: 'reply', title, body, url: destination, fallbackUrl: destination, tooLong: false, requiresPaste: true, state: 'unsubmitted' };
  const url = new URL(`https://github.com/${repository}/issues/new`);
  url.searchParams.set('template', 'website-contribution.md');
  const blankUrl = url.href;
  url.searchParams.set('title', title);
  const fallbackUrl = url.href.length > maxContributionUrlLength ? blankUrl : url.href;
  url.searchParams.set('body', body);
  const tooLong = url.href.length > maxContributionUrlLength;
  return { mode: 'share', title, body, url: url.href, fallbackUrl, tooLong, requiresPaste: tooLong, state: 'unsubmitted' };
}

/** Mounts an isolated composer. Local-device persistence happens only on Save. */
export function mountQuickContribution(target, { snapshot, topic, article = null, reply = null, onStatus } = {}) {
  if (!target?.replaceChildren) throw new Error('轻量分享入口需要一个页面容器。');
  const doc = target.ownerDocument;
  const create = (tag, text = '', className = '') => {
    const element = doc.createElement(tag);
    element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  const repository = snapshot?.site?.contributionsRepository;
  const key = 'xjtlu:quick-draft:v1:' + JSON.stringify([repository || '', topic?.id || '', article?.id || '', article?.revisionId || '', reply?.number || '', reply?.id || '']);
  const instance = `quick-${++quickInstance}`;
  const root = create('section', '', 'quick-contribution');
  const form = create('form', '', 'quick-form');
  const heading = create('h3', reply ? '回复这条分享' : '分享一点你知道的', 'quick-heading');
  heading.id = `${instance}-heading`;
  root.setAttribute('aria-labelledby', heading.id);
  root.append(heading, create('p', reply ? '写下你的补充、不同经历或追问。稍后复制到原讨论，在 GitHub 粘贴并确认回复。' : '几句话就可以。亲历、听说、发现的问题都欢迎，不需要先找到官方证明。', 'quick-help'));
  if (reply?.author) root.append(create('p', `正在回复 ${typeof reply.author === 'string' ? reply.author : reply.author.login || '一位同学'} 的分享 · GitHub #${reply.number}`, 'quick-context'));
  if (article) root.append(create('p', `关联：${article.title || article.id}${article.revisionNumber ? ` · 第 ${article.revisionNumber} 版` : ''}`, 'quick-context'));
  const inputs = {};
  function field(name, label, { tag = 'input', parent = form, placeholder = '', rows = 3 } = {}) {
    const wrapper = create('div', '', 'quick-field');
    const caption = create('label', label);
    const input = create(tag, '', `quick-${name}`);
    input.id = `${instance}-${name}`;
    input.name = name;
    if (tag === 'input') input.type = 'text';
    if (tag === 'textarea') input.rows = rows;
    input.placeholder = placeholder;
    caption.htmlFor = input.id;
    wrapper.append(caption, input);
    parent.append(wrapper);
    inputs[name] = input;
    return input;
  }
  const content = field('content', reply ? '你的回复' : '你想分享什么？', { tag: 'textarea', rows: 5, placeholder: '比如：我当时遇到……后来发现……也欢迎只补充一个小细节。' });
  content.required = true;
  const background = create('details', '', 'quick-background');
  background.append(create('summary', '补充一点背景（选填）'));
  const grid = create('div', '', 'quick-grid');
  background.append(grid);
  const nature = field('sourceNature', '来源性质', { tag: 'select', parent: grid });
  for (const value of ['', '本人亲历', '直接观察', '听他人说过，尚未核实', '公开资料', '个人看法 / 推测']) {
    const option = create('option', value || '暂不填写');
    option.value = value;
    nature.append(option);
  }
  field('campus', '校区', { parent: grid, placeholder: '例如园区、太仓、利物浦；不确定可留空' });
  field('time', '学期 / 发生时间', { parent: grid, placeholder: '例如 2026 秋季，也可以写大概时间' });
  field('source', '链接或补充依据', { tag: 'textarea', parent: grid, placeholder: '有就写，没有也可以分享。' });
  field('title', '标题', { parent: grid, placeholder: '不填时根据话题自动生成' });
  form.append(background);
  const consent = create('label', '', 'quick-consent');
  const check = create('input');
  check.type = 'checkbox';
  check.required = true;
  check.name = 'public';
  check.id = `${instance}-public`;
  consent.append(check, create('span', '我知道在 GitHub 确认提交后，我的 GitHub 用户名和这段正文会公开。'));
  form.append(create('p', '下一步需要 GitHub 账号，并由你在 GitHub 确认提交。本站无法确认你是否已完成提交。', 'quick-help'), consent);
  const actions = create('div', '', 'quick-actions');
  const prepare = create('button', reply ? '准备回复，前往 GitHub 确认' : '准备分享，前往 GitHub 确认', 'quick-button quick-primary');
  prepare.type = 'submit';
  actions.append(prepare);
  form.append(actions);
  const storageActions = create('div', '', 'quick-storage-actions');
  const buttons = {};
  for (const [name, label] of [['save', '保存到本机'], ['restore', '恢复本机草稿'], ['clear', '清除这份草稿']]) {
    const button = create('button', label, 'quick-button');
    button.type = 'button';
    storageActions.append(button);
    buttons[name] = button;
  }
  form.append(storageActions, create('p', '切换页面时会暂存输入；刷新前请主动保存到本机。保存的内容可被使用这台设备的人读取，清除只影响本机草稿。', 'quick-help'));
  const status = create('p', '尚未提交。', 'quick-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const result = create('div', '', 'quick-result');
  result.hidden = true;
  root.append(form, status, result);
  target.replaceChildren(root);
  let active = true;
  const read = () => Object.fromEntries(quickFields.map(name => [name, inputs[name].value]));
  function setQuickStatus(message) {
    if (!active) return;
    status.textContent = message.startsWith('尚未提交') ? message : `尚未提交。${message}`;
    if (typeof onStatus === 'function') onStatus({ state: 'unsubmitted', message: status.textContent });
  }
  function remember() { quickMemoryDrafts.set(key, read()); }
  function invalidate(message = '') {
    result.replaceChildren();
    result.hidden = true;
    remember();
    setQuickStatus(message);
  }
  function restoreValues(values) {
    const safe = quickValues(values);
    for (const name of quickFields) inputs[name].value = safe[name];
    check.checked = false;
    background.open = quickFields.filter(name => name !== 'content').some(name => safe[name]);
    content.setCustomValidity('');
  }
  function readLocal() {
    const raw = doc.defaultView.localStorage.getItem(key);
    if (!raw) return null;
    const stored = JSON.parse(raw);
    if (stored?.version !== 1 || !stored.values || typeof stored.values !== 'object') throw new Error('invalid draft');
    return quickValues(stored.values);
  }
  form.addEventListener('input', () => { content.setCustomValidity(''); invalidate(); });
  form.addEventListener('change', () => invalidate());
  buttons.save.addEventListener('click', () => {
    remember();
    try {
      doc.defaultView.localStorage.setItem(key, JSON.stringify({ version: 1, values: read(), savedAt: new Date().toISOString() }));
      setQuickStatus('已保存这份草稿到本机。后续修改需要再次点击保存。');
    } catch { setQuickStatus('浏览器不允许保存到本机或空间不足。输入仍保留在当前页面，请先复制正文再离开。'); }
  });
  buttons.restore.addEventListener('click', () => {
    try {
      const stored = readLocal();
      if (!stored) { setQuickStatus('没有找到这个话题下的本机草稿。'); return; }
      restoreValues(stored);
      invalidate('已恢复本机保存的草稿，请重新确认公开选项。');
    } catch { setQuickStatus('无法读取本机草稿。你当前输入的内容没有变化。'); }
  });
  buttons.clear.addEventListener('click', () => {
    restoreValues({});
    quickMemoryDrafts.delete(key);
    result.replaceChildren();
    result.hidden = true;
    try {
      doc.defaultView.localStorage.removeItem(key);
      setQuickStatus('已清除这份草稿。GitHub 上的内容不会因此删除。');
    } catch { setQuickStatus('已清空当前输入，但浏览器不允许删除本机存储，之前保存的副本可能仍在。'); }
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    content.setCustomValidity(content.value.trim() ? '' : '先写一点你的经历、发现或想补充的信息。');
    if (!form.reportValidity()) return;
    let draft;
    try { draft = buildQuickContributionDraft({ snapshot, topic, article, reply, values: { ...read(), public: check.checked } }); }
    catch (error) { invalidate(error.message); return; }
    remember();
    result.replaceChildren();
    result.hidden = false;
    const open = create('a', draft.requiresPaste ? (reply ? '前往原讨论，粘贴回复并确认' : '前往 GitHub，粘贴标题和正文并确认') : '前往 GitHub，核对并提交', 'quick-link');
    open.href = draft.requiresPaste ? draft.fallbackUrl : draft.url;
    open.target = '_blank';
    open.rel = 'noopener noreferrer';
    let firstAction = open;
    if (draft.requiresPaste) {
      result.append(create('p', reply ? 'GitHub 评论不能可靠预填。请先复制下面的完整回复，再打开原讨论，粘贴到评论框并提交。' : '内容较长，无法安全放入预填链接。完整标题和正文都保留在下方，请复制到 GitHub 后确认提交。', 'quick-help'));
      if (!reply) {
        const titleLabel = create('label', '完整标题');
        const titleCopy = create('textarea', '', 'quick-copy-title');
        titleCopy.id = `${instance}-copy-title`;
        titleLabel.htmlFor = titleCopy.id;
        titleCopy.readOnly = true;
        titleCopy.rows = 2;
        titleCopy.value = draft.title;
        result.append(titleLabel, titleCopy);
      }
      const copyLabel = create('label', reply ? '完整回复' : '完整正文');
      const copyBody = create('textarea', '', 'quick-copy-body');
      copyBody.id = `${instance}-copy-body`;
      copyLabel.htmlFor = copyBody.id;
      copyBody.readOnly = true;
      copyBody.rows = 7;
      copyBody.value = draft.body;
      const copy = create('button', reply ? '复制完整回复' : '复制完整正文', 'quick-button');
      copy.type = 'button';
      firstAction = copy;
      copy.addEventListener('click', async () => {
        try {
          await doc.defaultView.navigator.clipboard.writeText(draft.body);
          if (!result.contains(copyBody)) return;
          setQuickStatus('已复制完整文字。请打开 GitHub，粘贴并确认提交。');
        } catch {
          if (!result.contains(copyBody)) return;
          copyBody.focus();
          copyBody.select();
          setQuickStatus('无法自动复制，已选中完整文字。请使用复制命令，再到 GitHub 粘贴并确认提交。');
        }
      });
      result.append(copyLabel, copyBody, copy);
    }
    open.addEventListener('click', () => setQuickStatus(draft.requiresPaste ? '请在 GitHub 粘贴完整内容并确认提交。本站无法确认提交结果。' : '已准备好 GitHub 预填入口，请在 GitHub 核对并确认提交。本站无法确认提交结果。'));
    result.append(open);
    setQuickStatus(draft.requiresPaste ? '完整文字已准备好，请复制后前往 GitHub 粘贴并确认。' : '预填内容已准备好，请点击下方链接，在 GitHub 核对并确认提交。');
    firstAction.focus();
  });
  if (quickMemoryDrafts.has(key)) {
    restoreValues(quickMemoryDrafts.get(key));
    setQuickStatus('已恢复本次浏览中暂存的输入，请重新确认公开选项。');
  } else {
    try {
      const stored = readLocal();
      if (stored) {
        restoreValues(stored);
        remember();
        setQuickStatus('已恢复你主动保存到本机的草稿，请重新确认公开选项。');
      }
    } catch { setQuickStatus('无法读取本机草稿，你仍可以继续填写。'); }
  }
  if (!validContributionsRepository(repository)) setQuickStatus('分享入口暂未开放，仍可写下并保存草稿。');
  return {
    element: root,
    focus() { content.focus(); },
    destroy() { remember(); active = false; root.remove(); },
  };
}
