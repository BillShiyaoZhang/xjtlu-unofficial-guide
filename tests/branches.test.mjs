import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBranchTree, branchPath, visibleBranchRows } from '@information-community/core';
import { hideContent, importContent, setSourceDisposition } from '@information-community/runtime';
import { createPagesData } from '../scripts/build-pages.mjs';
import { createReviewedPagesData, pagesContentHash, validateReviewedPagesData } from '../scripts/pages-snapshot.mjs';
import { answerBranchId, buildGuideBranchGraph, topicBranchId } from '../community/ui/branch-model.js';
import { harness, keyring, loadDemoContent, loadDemoPagesConfig, readJson } from './helpers.mjs';

const firstId = 'card-ebridge-entry';
const secondId = 'card-learning-mall-help';
const otherId = 'card-current-student-entry';
const draftId = 'synthetic-branch-draft';
const hiddenText = 'PRIVATE_BRANCH_METADATA_SENTINEL';
const byId = values => values.map(value => value.id).sort();
const related = (id, from, to) => ({ id, from, to, reason: `Synthetic relation ${id}`, privateNotes: hiddenText });

async function setup(t) {
  const fixture = await loadDemoContent();
  const first = fixture.revisions.find(row => row.entityId === firstId);
  first.data.title = 'SYNTHETIC_BRANCH_ALPHA: one statement';
  first.data.internalNotes = hiddenText;
  const second = fixture.revisions.find(row => row.entityId === secondId);
  second.data.title = 'SYNTHETIC_BRANCH_BETA: another statement';
  second.data.scope.campus = ['taicang'];
  const draftEntity = structuredClone(fixture.entities.find(row => row.id === secondId));
  draftEntity.id = draftId;
  draftEntity.externalId = draftId;
  draftEntity.extensions.slug = draftId;
  const draftRevision = structuredClone(second);
  draftRevision.id = `${draftId}-r1`;
  draftRevision.entityId = draftId;
  Object.assign(draftRevision.data, { demo: false, origin: 'ai_draft', title: 'SYNTHETIC_UNPUBLISHED_BRANCH', verifiedAt: '' });
  const draftCitation = structuredClone(fixture.citations.find(row => row.revisionId === second.id));
  draftCitation.id = `${draftId}-citation`;
  draftCitation.externalId = `${draftId}-citation`;
  draftCitation.revisionId = draftRevision.id;
  fixture.entities.push(draftEntity);
  fixture.revisions.push(draftRevision);
  fixture.citations.push(draftCitation);
  fixture.links = [related('synthetic-peer-link', firstId, secondId), related('synthetic-cross-topic-link', firstId, otherId), related('synthetic-draft-link', firstId, draftId)];
  const h = await harness(t, { guide: true, mutateBundle(bundle) {
    // Restrict this fixture to synthetic demo records, with no handbook content.
    for (const name of ['entities', 'revisions', 'citations', 'links']) bundle[name] = structuredClone(fixture[name]);
  } });
  const config = await loadDemoPagesConfig();
  delete config.collectedRevisionIds;
  const snapshot = () => createReviewedPagesData({ state: h.store.read(), catalog: h.catalog, config, keyring, now: new Date(h.time()).toISOString() });
  return { ...h, config, snapshot };
}

function assertPublicLinks(data) {
  const visible = new Set(data.answers.map(answer => answer.id));
  for (const link of data.links ?? []) {
    assert.deepEqual(Object.keys(link).sort(), ['from', 'id', 'reason', 'to', 'type']);
    assert.equal(link.type, 'related');
    assert.ok(visible.has(link.from) && visible.has(link.to), `${link.id} must have two visible endpoints`);
  }
  assert.equal(JSON.stringify(data).includes(hiddenText), false);
  assert.equal(JSON.stringify(data).includes(draftId), false);
}

test('branch model keeps same-topic statements as siblings and related links outside the parent path', () => {
  const topics = [{ id: 'systems', titleZh: '合成系统话题' }, { id: 'services', titleZh: '合成服务话题' }];
  const answers = [
    { id: 'systems', title: '相同标题的第一条陈述', topic: { id: 'systems' }, revisionId: 'statement-one-r1', sentences: [{ text: '合成陈述 A' }] },
    { id: 'second', title: '相同标题的第一条陈述', topic: { id: 'systems' }, revisionId: 'statement-two-r1', sentences: [{ text: '合成陈述 B' }] },
    { id: 'third', title: '合成跨话题陈述', topic: { id: 'services' }, revisionId: 'statement-three-r1' },
  ];
  const links = [
    { id: 'peer', from: 'systems', to: 'second', type: 'related', reason: '同一话题的两个公开陈述' },
    { id: 'across', from: 'second', to: 'third', type: 'related', reason: '跨话题的阅读线索' },
  ];
  const input = { answers, topics, links }, before = structuredClone(input);
  const { graph, rootId } = buildGuideBranchGraph(input);
  const tree = buildBranchTree(graph, rootId, { direction: 'outgoing', relationTypes: ['branch'] });
  assert.equal(new Set(graph.nodes.map(node => node.id)).size, graph.nodes.length, 'topic and answer IDs must occupy separate namespaces');
  for (const answer of answers) {
    const entry = tree.entries.find(row => row.node.id === answerBranchId(answer.id));
    assert.equal(entry.node.answer, answer, 'navigation retains the exact public answer DTO');
    assert.equal(entry.parentId, topicBranchId(answer.topic.id));
    assert.equal(entry.edge.type, 'branch');
    assert.deepEqual(branchPath(tree, entry.node.id).map(row => row.node.id), [rootId, topicBranchId(answer.topic.id), answerBranchId(answer.id)]);
  }
  assert.equal(tree.crossEdges.length, 2);
  assert.ok(tree.crossEdges.every(edge => edge.type === 'related'));
  assert.deepEqual(tree.crossEdges.map(edge => [edge.from, edge.to, edge.reason]), links.map(link => [answerBranchId(link.from), answerBranchId(link.to), link.reason]));
  const focus = answerBranchId('second');
  assert.deepEqual(visibleBranchRows(tree, { expandedIds: [], selectedId: focus, limit: 1 }).entries.map(entry => entry.node.id), [rootId, topicBranchId('systems'), focus]);
  assert.deepEqual(tree.unreachableIds, []);
  assert.deepEqual(input, before);
});

test('topic projection excludes outside relation endpoints while older answers without topic metadata remain navigable', () => {
  const answers = [
    { id: 'a', title: '合成陈述 A', topic: { id: 'one', title: '合成话题一' } },
    { id: 'b', title: '合成陈述 B', topic: { id: 'two', title: '合成话题二' } },
    { id: 'legacy', title: '合成旧版陈述', topic: null },
  ];
  const links = [
    { id: 'outside', from: 'a', to: 'b', type: 'related', reason: '跨话题线索' },
    { id: 'missing', from: 'a', to: 'unpublished', type: 'related', reason: '不可见端点' },
  ];
  const focused = buildGuideBranchGraph({ answers, links, topicId: 'one' });
  assert.deepEqual(focused.graph.nodes.filter(node => node.kind === 'answer').map(node => node.answer.id), ['a']);
  assert.equal(focused.graph.edges.some(edge => edge.type === 'related'), false);
  const all = buildGuideBranchGraph({ answers, links });
  const tree = buildBranchTree(all.graph, all.rootId, { direction: 'outgoing', relationTypes: ['branch'] });
  assert.equal(branchPath(tree, answerBranchId('legacy')).at(-1).node.answer.id, 'legacy');
  assert.equal(tree.crossEdges.length, 1);
  assert.deepEqual(tree.unreachableIds, []);
  const empty = buildGuideBranchGraph();
  assert.equal(buildBranchTree(empty.graph, empty.rootId).entries.length, 1);
});

test('public branch API and Pages keep independent same-topic statements and only public relation endpoints', async t => {
  const h = await setup(t);
  h.store.transact(state => { state.modules.content = importContent(state.modules.content, h.bundle); });
  assert.deepEqual(await readJson(await h.get('/api/guide/branches')), { answers: [], contextAnswers: [], links: [] });
  assert.deepEqual(h.snapshot().answers, []);
  assert.deepEqual(h.snapshot().links, []);
  h.publish();
  const api = await readJson(await h.get('/api/guide/branches'));
  assert.deepEqual(api.answers, await readJson(await h.get('/api/guide/answers')));
  const pages = h.snapshot();
  for (const data of [api, pages]) {
    assert.equal(data.answers.length, 4);
    assert.deepEqual(byId(data.answers.filter(answer => answer.topic?.id === 'topic-systems')), [firstId, secondId].sort());
    assert.equal(data.answers.find(answer => answer.id === firstId).title, 'SYNTHETIC_BRANCH_ALPHA: one statement');
    assert.equal(data.answers.find(answer => answer.id === secondId).title, 'SYNTHETIC_BRANCH_BETA: another statement');
    assert.deepEqual(byId(data.links), ['synthetic-cross-topic-link', 'synthetic-peer-link']);
    assertPublicLinks(data);
    const { graph, rootId } = buildGuideBranchGraph({ answers: data.answers, topics: h.catalog.topics, links: data.links });
    const tree = buildBranchTree(graph, rootId, { direction: 'outgoing', relationTypes: ['branch'] });
    assert.equal(tree.crossEdges.length, 2);
    assert.equal(tree.entries.find(entry => entry.node.id === answerBranchId(firstId)).parentId, topicBranchId('topic-systems'));
    assert.equal(tree.entries.find(entry => entry.node.id === answerBranchId(secondId)).parentId, topicBranchId('topic-systems'));
    assert.deepEqual(tree.unreachableIds, []);
  }
  assert.deepEqual(pages.links, api.links);
  assert.deepEqual(validateReviewedPagesData(pages, { config: h.config }), pages);
});

test('branch query and scope filters remove relations whose other endpoint is outside the result', async t => {
  const h = await setup(t);
  h.publish();
  const cases = [
    ['q=SYNTHETIC_BRANCH_ALPHA', [firstId], []],
    ['q=SYNTHETIC_BRANCH', [firstId, secondId], ['synthetic-peer-link']],
    [`scope=${encodeURIComponent(JSON.stringify({ campus: ['suzhou'] }))}`, [firstId, otherId, 'card-read-status'], ['synthetic-cross-topic-link']],
    [`q=SYNTHETIC_BRANCH&scope=${encodeURIComponent(JSON.stringify({ campus: ['taicang'] }))}`, [secondId], []],
    ['q=SYNTHETIC_NO_RESULT', [], []],
  ];
  for (const [query, answers, links] of cases) {
    const data = await readJson(await h.get(`/api/guide/branches?${query}`));
    assert.deepEqual(byId(data.answers), answers.sort(), query);
    assert.deepEqual(byId(data.links), links.sort(), query);
    assertPublicLinks(data);
  }
});

test('hiding an article or withdrawing its source removes its branch and links in server and Pages projections', async t => {
  for (const removal of ['hidden', 'source-withdrawn']) {
    await t.test(removal, async t => {
      const h = await setup(t);
      h.publish();
      assert.equal(h.snapshot().links.length, 2);
      h.store.transact(state => {
        if (removal === 'hidden') {
          const entity = state.modules.content.entities.find(row => row.id === secondId);
          state.modules.content = hideContent(state.modules.content, { entityId: entity.id, expectedVersion: entity.version, hidden: true });
        } else {
          const source = state.modules.content.entities.find(row => row.id === 'artifact-learning-mall');
          state.modules.content = setSourceDisposition(state.modules.content, { entityId: source.id, expectedVersion: source.version, disposition: 'withdrawn' });
        }
      });
      for (const data of [await readJson(await h.get('/api/guide/branches')), h.snapshot()]) {
        assert.equal(data.answers.some(answer => answer.id === secondId), false);
        assert.equal(data.answers.some(answer => answer.id === firstId), true);
        assert.deepEqual(byId(data.links), ['synthetic-cross-topic-link']);
        assertPublicLinks(data);
      }
    });
  }
});

test('reviewed snapshot validates links even with a recomputed hash, and accepts old snapshots without links', async t => {
  const h = await setup(t);
  h.publish();
  const original = h.snapshot();
  const old = structuredClone(original);
  delete old.links;
  old.contentHash = pagesContentHash(old);
  assert.deepEqual(validateReviewedPagesData(old, { config: h.config }), old);
  for (const mutate of [
    data => { data.links[0].privateNotes = hiddenText; },
    data => { data.links[0].to = draftId; },
    data => { data.links[0].from = 'synthetic-missing-answer'; },
    data => { data.links[0].to = data.links[0].from; },
    data => { data.links[0].type = 'branch'; },
    data => { data.links.push(structuredClone(data.links[0])); },
    data => { data.links[0].reason = ''; },
    data => { data.links = null; },
  ]) {
    const invalid = structuredClone(original);
    mutate(invalid);
    invalid.contentHash = pagesContentHash(invalid);
    assert.throws(() => validateReviewedPagesData(invalid, { config: h.config }), { code: 'PAGES_SNAPSHOT_INVALID' });
  }
});

test('demo Pages preserves relation metadata only between explicitly selected public answers', async t => {
  const h = await setup(t);
  const build = config => createPagesData({ config, profile: h.business.content, content: h.bundle, catalog: h.catalog, now: new Date(h.time()).toISOString() });
  const full = build(h.config);
  assert.deepEqual(byId(full.links), ['synthetic-cross-topic-link', 'synthetic-peer-link']);
  assertPublicLinks(full);
  const narrowed = build({ ...h.config, publishedRevisionIds: h.config.publishedRevisionIds.filter(id => id !== 'revision-card-learning-mall-help-v1') });
  assert.equal(narrowed.answers.some(answer => answer.id === secondId), false);
  assert.deepEqual(byId(narrowed.links), ['synthetic-cross-topic-link']);
  assertPublicLinks(narrowed);
});
