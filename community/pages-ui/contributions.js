// GitHub supports template, title and body query parameters. A Markdown template
// lets readers review one complete draft without filling a second form.
export const contributionTypes = {
  new: { title: '新增 / 补充信息', prefix: '新资料', label: '信息正文', description: '补充手册尚未覆盖的事项、办理入口、流程变化或可靠资料。', help: '写清主要内容、适用条件，以及仍待确认的部分。' },
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
  const fields = ['title', 'content', 'source', 'campus', 'audience', 'time', 'ai'];
  const data = Object.fromEntries(fields.map(field => [field, String(values[field] ?? '').trim()]));
  if (fields.some(field => !data[field] && !(field === 'source' && values.type === 'correction'))) throw new Error('请完整填写必填内容。');
  if (values.public !== true) throw new Error('请确认投稿内容可以公开。');
  const sections = [
    ['投稿类型', kind.title], [kind.label, data.content], ['来源或依据', data.source || '暂未提供'],
    ['适用校区', data.campus], ['适用人群', data.audience], ['发生或有效时间', data.time], ['AI 参与说明', data.ai],
  ];
  if (article) sections.push(['关联文章', [article.answer.title, article.url, `文章 ID：${article.answer.id}`, `阅读版本：${article.answer.revisionId}（第 ${article.answer.revisionNumber} 版）`].filter(Boolean).join('\n')]);
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
  const key = article ? `article:${article.answer.id}` : 'general';
  const draft = drafts.get(key);
  form.reset();
  for (const field of form.querySelectorAll('input, textarea, select')) field.setCustomValidity('');
  if (draft) {
    for (const [name, value] of Object.entries(draft.values)) {
      if (name !== 'public') form.elements.namedItem(name).value = value;
    }
    $('contribution-public').checked = draft.public && draft.revision === article?.answer.revisionId;
  }
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
    context.append(description, make('p', '文章链接和当前公开版本会随正文带入 GitHub。', 'muted'));
    if (parameters.has('revision') && parameters.get('revision') !== answer.revisionId) context.append(make('p', '这篇文章已更新，将引用当前公开版本。', 'muted'));
  } else if (parameters.has('article')) context.append(make('p', '未找到关联的公开文章，可按通用投稿继续补充。', 'muted'));
  $('contribution-unavailable').hidden = enabled;
  $('contribution-form').hidden = !enabled;
  updateType();
}
