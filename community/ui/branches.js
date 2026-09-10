import { buildBranchTree, branchPath, visibleBranchRows } from './core/index.js';
import { buildGuideBranchGraph, answerBranchId, topicBranchId, branchScopeLabels } from './branch-model.js';

const sessions = new WeakMap();
let instanceCount = 0;
const PAGE_SIZE = 40;
const sourceLabels = { university_official: '学校官方', user_provided: '用户提供', web: '网络资料' };
const make = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
};
function button(label, action, className = '') {
  const control = make('button', label, `guide-branch-button ${className}`.trim());
  control.type = 'button';
  control.addEventListener('click', action);
  return control;
}
function date(value) {
  if (!value) return '未注明';
  const parsed = new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString('zh-CN') : '未注明';
}
function destinationLink(candidate, title, className = 'guide-branch-read') {
  const link = make('a', title, className);
  try {
    if (typeof candidate !== 'string' || !candidate.trim()) return link;
    const url = new URL(candidate, document.baseURI);
    if (['http:', 'https:'].includes(url.protocol)) link.href = candidate;
  } catch { /* A malformed destination must not become an executable link. */ }
  return link;
}
function readLink(answer, title, answerHref) {
  return destinationLink(answerHref ? answerHref(answer) : `#/answers/${encodeURIComponent(answer.id)}`, title);
}
const countLabel = node => node.supplementCount
  ? `${node.statementCount} 条陈述 · ${node.supplementCount} 条补充`
  : `${node.count} 条陈述`;

/** Render a public, topic-based branch explorer; state belongs to this target. */
export function renderBranches(target, options = {}) {
  const { answers = [], topics = [], links = [], selectedId, answerHref, contributionHref, topicId = '', scopes = [], expandTopics = false } = options;
  const { graph, rootId } = buildGuideBranchGraph({ answers, topics, links, topicId });
  const tree = buildBranchTree(graph, rootId, { direction: 'outgoing', relationTypes: ['branch'] });
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  const branchParents = new Set(tree.entries.map(entry => entry.parentId).filter(Boolean));
  const selectedNodeId = selectedId && byId.has(answerBranchId(selectedId)) ? answerBranchId(selectedId) : undefined;
  const path = selectedNodeId ? branchPath(tree, selectedNodeId) : [];
  let state = sessions.get(target);
  if (!state) {
    state = { instance: ++instanceCount, expanded: new Set([rootId]), limit: PAGE_SIZE, relatedOpen: false };
    sessions.set(target, state);
  }
  const graphKey = JSON.stringify(tree.entries.map(entry => [entry.node.id, entry.parentId, entry.node.branchContext]));
  const graphChanged = state.graphKey !== graphKey;
  if (graphChanged) {
    state.limit = PAGE_SIZE;
    state.expanded = new Set([...state.expanded].filter(id => byId.has(id)));
    state.expanded.add(rootId);
    state.graphKey = graphKey;
  }
  if (state.topicId !== topicId) {
    if (topicId) state.expanded.add(topicBranchId(topicId));
    state.topicId = topicId;
  }
  if (expandTopics && (graphChanged || !state.expandTopics)) {
    for (const id of branchParents) state.expanded.add(id);
  }
  state.expandTopics = expandTopics;
  for (const entry of path.slice(0, -1)) state.expanded.add(entry.node.id);
  if (selectedNodeId && (graphChanged || state.selectedNodeId !== selectedNodeId)) state.expanded.add(selectedNodeId);
  state.selectedNodeId = selectedNodeId;
  const refresh = key => {
    renderBranches(target, options);
    if (key) {
      const control = [...target.querySelectorAll('[data-branch-control]')]
        .find(control => control.dataset.branchControl === key);
      (control || (key === 'more' ? target.querySelector('.guide-branch-footer') : null))?.focus({ preventScroll: true });
    }
  };
  const locate = () => {
    for (const entry of path.slice(0, -1)) state.expanded.add(entry.node.id);
    refresh();
    const current = target.querySelector('.guide-branch-answer.is-current');
    current?.scrollIntoView({ behavior: 'auto', block: 'center' });
    current?.querySelector('a')?.focus({ preventScroll: true });
  };
  const shell = make('section', undefined, 'guide-branches');
  shell.setAttribute('aria-label', '话题分支图');
  const intro = make('div', undefined, 'guide-branch-intro');
  intro.append(make('p', '同话题下的不同陈述并列收录，补充信息展开在所属陈述下，请按各自来源与适用场景核对。', 'guide-branch-note'));
  intro.append(make('p', '连线表示话题归属或补充关系；不表示陈述互相支持，也不表示修订先后。', 'guide-branch-hint'));
  shell.append(intro);
  if (!answers.length || graph.nodes.length === 1) {
    shell.append(make('p', '暂无符合条件的公开陈述。调整筛选后可查看话题分支。', 'empty'));
    target.replaceChildren(shell);
    return;
  }
  const controls = make('div', undefined, 'guide-branch-controls');
  const expand = button('展开所有话题', () => {
    for (const id of branchParents) state.expanded.add(id);
    refresh('expand');
  });
  expand.dataset.branchControl = 'expand';
  const collapse = button(selectedNodeId ? '收起其他话题' : '收起所有话题', () => {
    state.expanded = new Set([rootId, ...path.slice(0, -1).map(entry => entry.node.id)]);
    state.limit = PAGE_SIZE;
    refresh('collapse');
  });
  collapse.dataset.branchControl = 'collapse';
  controls.append(expand, collapse);
  if (selectedNodeId) {
    const locateButton = button('定位当前陈述', locate, 'guide-branch-locate');
    locateButton.dataset.branchControl = 'locate';
    controls.append(locateButton);
  }
  shell.append(controls);
  if (path.length) {
    const breadcrumb = make('p', undefined, 'guide-branch-path');
    breadcrumb.setAttribute('aria-label', '当前陈述路径');
    breadcrumb.append(make('span', '当前位置：'));
    path.forEach((entry, index) => {
      if (index) breadcrumb.append(make('span', ' › ', 'guide-branch-path-divider'));
      breadcrumb.append(make('span', entry.node.title));
    });
    shell.append(breadcrumb);
  }
  const visible = visibleBranchRows(tree, { expandedIds: state.expanded, selectedId: selectedNodeId, limit: state.limit });
  const treeList = make('ol', undefined, 'guide-branch-tree');
  treeList.setAttribute('aria-label', '公开指南、话题、陈述与补充信息');
  const childLists = new Map(), currentAncestors = new Set(path.slice(0, -1).map(entry => entry.node.id));
  for (const entry of visible.entries) {
    const { node } = entry;
    const item = make('li', undefined, `guide-branch-node guide-branch-node-${node.kind}`);
    item.dataset.branchNode = node.id;
    item.dataset.branchDepth = entry.depth;
    if (entry.depth >= 4) item.classList.add('guide-branch-node-deep');
    if (node.kind === 'root') {
      const root = make('div', undefined, 'guide-branch-root');
      root.append(make('strong', node.title), make('span', `${node.topicCount} 个话题 · ${node.supplementCount ? countLabel(node) : `${node.count} 条独立陈述`}`));
      item.append(root);
    } else if (node.kind === 'topic') {
      const heading = make('div', undefined, 'guide-branch-topic-heading');
      const expanded = state.expanded.has(node.id), controlId = `topic-${node.id}`;
      const toggle = button('', () => {
        if (state.expanded.has(node.id)) state.expanded.delete(node.id);
        else state.expanded.add(node.id);
        refresh(controlId);
      }, 'guide-branch-topic-toggle');
      toggle.dataset.branchControl = controlId;
      toggle.setAttribute('aria-label', `${expanded ? '收起' : '展开'}话题：${node.title}`);
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.setAttribute('aria-controls', `guide-branch-${state.instance}-${encodeURIComponent(node.id)}`);
      const chevron = make('span', expanded ? '−' : '+', 'guide-branch-chevron');
      chevron.setAttribute('aria-hidden', 'true');
      toggle.append(chevron, make('span', node.title), make('span', countLabel(node), 'guide-branch-topic-count'));
      if (currentAncestors.has(node.id)) {
        toggle.disabled = true;
        toggle.title = '当前陈述所在话题保持展开';
      }
      heading.append(toggle);
      if (node.description) heading.append(make('p', node.description, 'guide-branch-topic-description'));
      item.append(heading);
    } else {
      const { answer } = node;
      const current = node.id === selectedNodeId;
      const card = make('article', undefined, `guide-branch-answer${current ? ' is-current' : ''}`);
      card.dataset.answerId = answer.id;
      card.dataset.reviewStatus = answer.reviewStatus || '';
      if (node.isSupplement) card.classList.add('guide-branch-supplement');
      if (node.branchContext) card.dataset.branchContext = 'true';
      const kindLabel = node.isSupplement ? '补充信息' : '独立陈述';
      const label = make('p', [current ? '当前陈述' : '', node.branchContext ? '所属陈述 · 筛选上下文' : '', kindLabel,
        node.isSupplement ? `第 ${entry.depth - 2} 层补充` : '同话题并列分支'].filter(Boolean).join(' · '), 'guide-branch-kind');
      const title = make('h3');
      const link = readLink(answer, node.title, answerHref);
      if (current) link.setAttribute('aria-current', 'true');
      title.append(link);
      card.append(label, title);
      if (node.isSupplement) card.append(make('p', `补充于：${byId.get(entry.parentId).title}`, 'guide-branch-parent'));
      if (answer.summary) card.append(make('p', answer.summary, 'guide-branch-summary'));
      const sources = make('div', undefined, 'source-categories');
      sources.setAttribute('aria-label', '材料来源');
      for (const category of answer.sourceCategories ?? []) {
        if (!sourceLabels[category]) continue;
        const badge = make('span', sourceLabels[category], 'source-category');
        badge.dataset.sourceCategory = category;
        sources.append(badge);
      }
      card.append(sources);
      const reviewed = answer.reviewStatus === 'approved' || (!answer.reviewStatus && Boolean(answer.verifiedAt));
      const status = answer.reviewStatus === 'collected' ? '已收录 · 待人工核验' : reviewed ? '已人工核验' : '核验状态未注明';
      card.append(make('p', `${status}${reviewed ? ` · 核验 ${date(answer.verifiedAt)}` : ''} · ${(answer.citations ?? []).length} 项来源${answer.demo ? ' · 演示内容' : ''}`, 'guide-branch-metadata'));
      card.append(make('p', `适用范围：${branchScopeLabels(answer.scope, scopes).join(' · ') || '尚未明确'}`, 'guide-branch-scope'));
      const warnings = [...(answer.warnings ?? [])];
      const reviewDue = Date.parse(answer.reviewDueAt);
      if (Number.isFinite(reviewDue) && Date.now() > reviewDue && !warnings.some(warning => /待复核|已超过维护周期|已超过复核期限/u.test(warning))) {
        warnings.push('待复核：已超过维护周期，请先核对原站。');
      }
      for (const warning of warnings) card.append(make('p', warning, 'guide-branch-warning'));
      card.append(readLink(answer, '阅读陈述与来源 →', answerHref));
      if (contributionHref) {
        const contribute = destinationLink(contributionHref(answer), '补充这条信息', 'guide-branch-contribute');
        if (contribute.hasAttribute('href')) card.append(contribute);
      }
      if (node.supplementCount) {
        const expanded = state.expanded.has(node.id), controlId = `answer-${node.id}`;
        const toggle = button(`${expanded ? '收起' : '展开'} ${node.supplementCount} 条补充信息`, () => {
          if (state.expanded.has(node.id)) state.expanded.delete(node.id);
          else state.expanded.add(node.id);
          refresh(controlId);
        }, 'guide-branch-supplement-toggle');
        toggle.dataset.branchControl = controlId;
        toggle.setAttribute('aria-label', `${expanded ? '收起' : '展开'}补充：${node.title}`);
        toggle.setAttribute('aria-expanded', String(expanded));
        toggle.setAttribute('aria-controls', `guide-branch-${state.instance}-${encodeURIComponent(node.id)}`);
        if (currentAncestors.has(node.id)) {
          toggle.disabled = true;
          toggle.title = '当前陈述的补充路径保持展开';
        }
        card.append(toggle);
      } else if (current) {
        card.append(make('p', '暂无已收录补充', 'guide-branch-empty-supplements'));
      }
      item.append(card);
    }
    (entry.parentId ? childLists.get(entry.parentId) : treeList).append(item);
    if (node.kind !== 'answer' || node.supplementCount) {
      const children = make('ol', undefined, 'guide-branch-children');
      children.id = `guide-branch-${state.instance}-${encodeURIComponent(node.id)}`;
      children.hidden = !state.expanded.has(node.id);
      item.append(children);
      childLists.set(node.id, children);
    }
  }
  shell.append(treeList);
  const footer = make('div', undefined, 'guide-branch-footer');
  footer.tabIndex = -1;
  const shown = visible.entries.filter(entry => entry.node.kind === 'answer' && !entry.node.branchContext).length;
  const contextShown = visible.entries.filter(entry => entry.node.branchContext).length;
  footer.append(make('p', `当前显示 ${shown} / ${graph.nodes[0].count} 条陈述与补充${contextShown ? `，另有 ${contextShown} 条所属陈述提供上下文` : ''}，展开分支可继续查看。`, 'guide-branch-hint'));
  if (visible.hasMore) {
    const more = button('继续显示分支', () => { state.limit += PAGE_SIZE; refresh('more'); }, 'guide-branch-more');
    more.dataset.branchControl = 'more';
    footer.append(more);
  }
  shell.append(footer);
  if (tree.crossEdges.length) {
    const related = make('details', undefined, 'guide-branch-related');
    related.open = state.relatedOpen;
    related.addEventListener('toggle', () => { state.relatedOpen = related.open; });
    related.append(make('summary', `横向关联 · ${tree.crossEdges.length} 条`));
    related.append(make('p', '以下关联保留原方向及关联理由，供对照阅读。', 'guide-branch-hint'));
    const relatedList = make('ul');
    for (const edge of tree.crossEdges) {
      const row = make('li');
      row.append(readLink(byId.get(edge.from).answer, byId.get(edge.from).title, answerHref), make('span', ' → '), readLink(byId.get(edge.to).answer, byId.get(edge.to).title, answerHref));
      row.append(make('p', `关联理由：${edge.reason || '未注明'}`));
      relatedList.append(row);
    }
    related.append(relatedList);
    shell.append(related);
  }
  target.replaceChildren(shell);
}
