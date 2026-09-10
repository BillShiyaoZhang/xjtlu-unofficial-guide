import assert from 'node:assert/strict';
import test from 'node:test';
import { branchPath, buildBranchTree, visibleBranchRows } from '@information-community/core';
import { answerBranchId, buildGuideBranchGraph, topicBranchId, withBranchAncestors } from '../community/ui/branch-model.js';

const answer = (id, supplementTo, topicId = 'topic-one') => ({
  id, title: `合成陈述 ${id}`, topic: { id: topicId, title: '合成话题' },
  ...(supplementTo === undefined ? {} : { supplementTo }),
  citations: [{ id: `citation-${id}` }], reviewStatus: 'collected',
});
const toTree = input => {
  const { graph, rootId } = buildGuideBranchGraph(input);
  return { graph, rootId, tree: buildBranchTree(graph, rootId, { direction: 'outgoing', relationTypes: ['branch'] }) };
};

test('supplements retain their own DTOs and form nested branches below a statement', () => {
  const answers = [answer('leaf', 'child'), answer('peer'), answer('child', 'parent'), answer('parent')];
  const before = structuredClone(answers);
  const { graph, rootId, tree } = toTree({ answers });
  assert.deepEqual(branchPath(tree, answerBranchId('leaf')).map(entry => entry.node.id), [
    rootId, topicBranchId('topic-one'), answerBranchId('parent'), answerBranchId('child'), answerBranchId('leaf'),
  ]);
  assert.equal(tree.entries.find(entry => entry.node.id === answerBranchId('peer')).parentId, topicBranchId('topic-one'));
  for (const original of answers) assert.equal(graph.nodes.find(node => node.id === answerBranchId(original.id)).answer, original);
  const parent = graph.nodes.find(node => node.id === answerBranchId('parent'));
  assert.equal(parent.supplementCount, 1);
  assert.equal(parent.isSupplement, false);
  assert.equal(graph.nodes.find(node => node.id === answerBranchId('child')).isSupplement, true);
  assert.equal(graph.nodes[0].statementCount, 2);
  assert.equal(graph.nodes[0].supplementCount, 2);
  assert.equal(graph.nodes[0].count, 4);
  assert.deepEqual(tree.crossEdges, [], 'a supplement parent is not a horizontal relation');
  assert.deepEqual(tree.unreachableIds, []);
  assert.deepEqual(answers, before);
});

test('filtered leaves include their visible ancestors as context, excluded from match counts', () => {
  const answers = [answer('root'), answer('middle', 'root'), answer('leaf', 'middle'), answer('peer')];
  const before = structuredClone(answers);
  const filtered = withBranchAncestors(answers, [answers[2]]);
  assert.equal(filtered.find(row => row.id === 'leaf'), answers[2]);
  assert.equal(filtered.find(row => row.id === 'middle').branchContext, true);
  assert.equal(filtered.find(row => row.id === 'root').branchContext, true);
  assert.equal(filtered.some(row => row.id === 'peer'), false);
  const { graph, tree } = toTree({ answers: filtered });
  assert.equal(graph.nodes[0].count, 1);
  assert.equal(graph.nodes[0].contextCount, 2);
  assert.equal(graph.nodes[0].supplementCount, 1);
  assert.equal(graph.nodes.find(node => node.kind === 'topic').count, 1);
  assert.equal(branchPath(tree, answerBranchId('leaf')).length, 5);
  assert.deepEqual(answers, before);
  const multiple = withBranchAncestors(answers, [answers[0], answers[2]]);
  assert.equal(multiple.find(row => row.id === 'root'), answers[0]);
  assert.equal(multiple.filter(row => row.branchContext).length, 1);
});

test('missing, cross-topic and cyclic supplement families cannot become independent statements', () => {
  const answers = [
    answer('safe'), answer('missing', 'not-public'), answer('missing-child', 'missing'),
    answer('cross', 'safe', 'topic-two'), answer('cross-child', 'cross', 'topic-two'),
    answer('self', 'self'), answer('cycle-a', 'cycle-b'), answer('cycle-b', 'cycle-c'), answer('cycle-c', 'cycle-a'),
    answer('cycle-descendant', 'cycle-c'), answer('safe-child', 'safe'), answer('malformed', 42),
  ];
  const { graph, tree } = toTree({ answers, links: [{ id: 'invalid-related', from: 'safe', to: 'missing', type: 'related' }] });
  assert.deepEqual(graph.nodes.filter(node => node.kind === 'answer').map(node => node.answer.id), ['safe', 'safe-child']);
  assert.deepEqual(tree.unreachableIds, []);
  assert.deepEqual(tree.crossEdges, []);
  assert.equal(graph.nodes[0].topicCount, 1);
  const alone = toTree({ answers: [answer('child', 'parent')] });
  assert.equal(alone.graph.nodes.length, 1, 'a filter must supply ancestor context rather than reparent a match');
});

test('ancestor expansion stays inside the supplied public topic and terminates on cycles', () => {
  const answers = [answer('one', 'two'), answer('two', 'one'), answer('foreign', 'one', 'topic-two')];
  assert.equal(withBranchAncestors(answers, [answers[0]]).length, 2);
  assert.deepEqual(withBranchAncestors(answers, [answers[2]]), [answers[2]]);
  assert.deepEqual(withBranchAncestors(answers, []), []);
  const marked = withBranchAncestors(answers, [{ ...answers[0], branchContext: true }]);
  assert.equal(marked.find(row => row.id === 'one').branchContext, false);
});

test('selected deep paths stay whole across collapsed branches and pagination', () => {
  const answers = Array.from({ length: 85 }, (_, index) => answer(`peer-${index}`));
  answers.push(answer('parent'), answer('child', 'parent'), answer('leaf', 'child'));
  const { rootId, tree } = toTree({ answers });
  const selectedId = answerBranchId('leaf');
  const visible = visibleBranchRows(tree, { expandedIds: [rootId], selectedId, limit: 4 });
  assert.deepEqual(visible.entries.map(entry => entry.node.id), [
    rootId, topicBranchId('topic-one'), answerBranchId('parent'), answerBranchId('child'), selectedId,
  ]);
  assert.equal(visible.hasMore, true);
  const expanded = new Set(tree.entries.map(entry => entry.parentId).filter(Boolean));
  const page = visibleBranchRows(tree, { expandedIds: expanded, selectedId, limit: 40 });
  const displayed = new Set(page.entries.map(entry => entry.node.id));
  for (const entry of page.entries) if (entry.parentId) assert.ok(displayed.has(entry.parentId));
});

test('deep supplement chains preserve semantic depth without recursive model traversal', () => {
  const answers = Array.from({ length: 1200 }, (_, index) => answer(`depth-${index}`, index ? `depth-${index - 1}` : undefined));
  const { tree } = toTree({ answers: answers.toReversed() });
  assert.equal(branchPath(tree, answerBranchId('depth-1199')).length, 1202);
  assert.deepEqual(tree.unreachableIds, []);
});
