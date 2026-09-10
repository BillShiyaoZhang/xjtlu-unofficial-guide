// This module replaces contributions.js in HTTP responses from preview-cold-start only.
// No network, external URL, clipboard or persistent draft storage is used.
export function mountQuickContribution(target, { reply } = {}) {
  const doc = target.ownerDocument;
  const create = (tag, text) => {
    const node = doc.createElement(tag);
    if (text) node.textContent = text;
    return node;
  };
  const root = create('section'); root.className = 'quick-contribution';
  const heading = create('h3', reply ? '【测试样例】本地回复演练' : '【测试样例】本地投稿演练');
  const description = create('p', '可以输入文字并预览；不会发布、保存，也不会打开外部网站。刷新或离开后清空。');
  const form = create('form');
  const label = create('label', '演练文字（仅留在当前页面）');
  const input = create('textarea'); input.rows = 4;
  label.append(input);
  const submit = create('button', '在本页预览文字'); submit.type = 'submit';
  const result = create('p'); result.setAttribute('role', 'status');
  form.append(label, submit); root.append(heading, description, form, result);
  const preview = event => {
    event.preventDefault();
    result.textContent = input.value.trim() ? `【测试样例 · 未提交】${input.value.trim()}` : '请先输入一点演练文字。';
  };
  form.addEventListener('submit', preview);
  target.replaceChildren(root);
  return { focus() { input.focus(); }, destroy() { form.removeEventListener('submit', preview); } };
}

export function renderContribution() {
  const target = document.getElementById('contribute-view');
  mountQuickContribution(target);
}
