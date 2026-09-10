// Adapt public answer DTOs into browsing branches. Edges describe topic grouping
// or an explicit supplement parent, never agreement or revision history.
export const answerBranchId = id => `answer:${id}`;
export const topicBranchId = id => `topic:${id}`;
const ROOT_ID = 'guide:root';
const validId = value => typeof value === 'string' && value.trim().length > 0;

/** Add public ancestors to filtered results without counting them as matches. */
export function withBranchAncestors(allAnswers = [], matchedAnswers = []) {
  const all = new Map();
  for (const answer of allAnswers) if (validId(answer?.id) && !all.has(answer.id)) all.set(answer.id, answer);
  const included = new Map();
  for (const answer of matchedAnswers) {
    if (!validId(answer?.id) || included.has(answer.id)) continue;
    included.set(answer.id, answer.branchContext ? { ...answer, branchContext: false } : answer);
  }
  for (const answer of [...included.values()]) {
    const seen = new Set([answer.id]);
    let child = answer;
    while (validId(child.supplementTo)) {
      const parent = all.get(child.supplementTo);
      if (!parent || seen.has(parent.id) || (parent.topic?.id ?? null) !== (child.topic?.id ?? null)) break;
      seen.add(parent.id);
      if (!included.has(parent.id)) included.set(parent.id, { ...parent, branchContext: true });
      child = parent;
    }
  }
  return [...included.values()];
}

export function buildGuideBranchGraph({ answers = [], topics = [], links = [], topicId = '' } = {}) {
  const catalog = new Map();
  for (const topic of topics) {
    if (validId(topic?.id) && !catalog.has(topic.id)) catalog.set(topic.id, topic);
  }
  const byAnswer = new Map(), groups = new Map();
  for (const answer of answers) {
    if (!validId(answer?.id) || byAnswer.has(answer.id)) continue;
    const groupId = validId(answer.topic?.id) ? answer.topic.id : '';
    if (topicId && groupId !== topicId) continue;
    byAnswer.set(answer.id, answer);
    if (!groups.has(groupId)) groups.set(groupId, []);
    groups.get(groupId).push(answer);
  }
  const parents = new Map(), invalid = new Set();
  for (const answer of byAnswer.values()) {
    const parent = byAnswer.get(answer.supplementTo);
    if (parent && parent.id !== answer.id && (parent.topic?.id ?? null) === (answer.topic?.id ?? null)) {
      parents.set(answer.id, parent.id);
    } else if (Object.hasOwn(answer, 'supplementTo')) {
      invalid.add(answer.id);
    }
  }
  // Reject every edge inside a cycle rather than choosing an arbitrary parent.
  // Missing/filtered parents cannot be guessed or promoted to standalone roots.
  const checked = new Set();
  for (const answerId of parents.keys()) {
    const path = [], positions = new Map();
    let cursor = answerId;
    while (parents.has(cursor) && !checked.has(cursor) && !positions.has(cursor)) {
      positions.set(cursor, path.length);
      path.push(cursor);
      cursor = parents.get(cursor);
    }
    if (positions.has(cursor)) {
      for (const cycleId of path.slice(positions.get(cursor))) invalid.add(cycleId);
    }
    for (const id of path) checked.add(id);
  }
  const children = new Map();
  for (const [childId, parentId] of parents) {
    if (!children.has(parentId)) children.set(parentId, []);
    children.get(parentId).push(childId);
  }
  const rejected = [...invalid];
  for (let cursor = 0; cursor < rejected.length; cursor++) {
    for (const childId of children.get(rejected[cursor]) || []) {
      if (!invalid.has(childId)) { invalid.add(childId); rejected.push(childId); }
    }
  }
  for (const id of invalid) { byAnswer.delete(id); parents.delete(id); }
  for (const [groupId, grouped] of groups) {
    const visible = grouped.filter(answer => byAnswer.has(answer.id));
    if (visible.length) groups.set(groupId, visible);
    else groups.delete(groupId);
  }
  const orderedGroups = [
    ...[...catalog.keys()].filter(id => groups.has(id)),
    ...[...groups.keys()].filter(id => !catalog.has(id)),
  ];
  const childCounts = new Map();
  for (const parentId of parents.values()) childCounts.set(parentId, (childCounts.get(parentId) || 0) + 1);
  const counts = values => {
    const matched = values.filter(answer => !answer.branchContext);
    const supplementCount = matched.filter(answer => validId(answer.supplementTo)).length;
    return { count: matched.length, statementCount: matched.length - supplementCount, supplementCount, contextCount: values.length - matched.length };
  };
  const nodes = [{ id: ROOT_ID, kind: 'root', title: '公开指南', ...counts([...byAnswer.values()]), topicCount: groups.size }];
  const edges = [];
  for (const groupId of orderedGroups) {
    const grouped = groups.get(groupId), topic = catalog.get(groupId);
    const nodeId = topicBranchId(groupId);
    nodes.push({
      id: nodeId, kind: 'topic', topicId: groupId,
      title: topic?.titleZh || grouped[0].topic?.title || '其他校园信息',
      description: topic?.description || '', ...counts(grouped),
    });
    edges.push({ id: `group:${nodeId}`, from: ROOT_ID, to: nodeId, type: 'branch' });
    for (const answer of grouped) {
      const id = answerBranchId(answer.id);
      const parentId = parents.get(answer.id), isSupplement = validId(answer.supplementTo);
      nodes.push({
        id, kind: 'answer', title: answer.title || '未命名陈述', answer,
        isSupplement, supplementCount: childCounts.get(answer.id) || 0,
        branchContext: Boolean(answer.branchContext),
      });
      edges.push({ id: `group:${id}`, from: parentId ? answerBranchId(parentId) : nodeId, to: id, type: 'branch' });
    }
  }
  const relationIds = new Set();
  for (const link of links) {
    if (link?.type !== 'related' || !validId(link.id) || relationIds.has(link.id)) continue;
    if (!byAnswer.has(link.from) || !byAnswer.has(link.to)) continue;
    relationIds.add(link.id);
    edges.push({
      id: `related:${link.id}`, from: answerBranchId(link.from), to: answerBranchId(link.to),
      type: 'related', reason: typeof link.reason === 'string' ? link.reason : '',
    });
  }
  return { graph: { nodes, edges }, rootId: ROOT_ID };
}

export function branchScopeLabels(scope = {}, scopes = []) {
  const universal = { campus: '两校区通用入口', audience: '学生通用入口', academic_year: '不限学年' };
  return Object.entries(scope ?? {}).flatMap(([dimension, values]) => (
    Array.isArray(values) ? values : []
  ).filter(value => typeof value === 'string').map(value => (
    scopes.find(item => item.dimension === dimension && (item.id === value || item.code === value))?.labelZh
      || (value === 'universal' ? universal[dimension] || '通用' : value)
  )));
}
