import assert from 'node:assert/strict';
import test from 'node:test';
import { hideContent, importContent, setSourceDisposition } from '@information-community/runtime';
import { createPagesData } from '../scripts/build-pages.mjs';
import { createReviewedPagesData, pagesContentHash, validateReviewedPagesData } from '../scripts/pages-snapshot.mjs';
import { harness, keyring, loadDemoContent, loadDemoPagesConfig, readJson } from './helpers.mjs';

const parentId = 'card-ebridge-entry';
const childId = 'card-learning-mall-help';
const grandchildId = 'card-current-student-entry';
const siblingId = 'card-read-status';
const privateText = 'PRIVATE_SUPPLEMENT_METADATA_SENTINEL';
const ids = values => values.map(value => value.id).sort();
const revisionOf = (bundle, entityId) => bundle.revisions.find(row => row.entityId === entityId);

async function setup(t, { collected = false, publish = true, mutate } = {}) {
  const fixture = await loadDemoContent();
  for (const entity of fixture.entities.filter(row => row.type === 'answer')) {
    entity.extensions.topicId = 'topic-systems';
    const revision = revisionOf(fixture, entity.id);
    Object.assign(revision.data, {
      title: `SYNTHETIC_SUPPLEMENT_${entity.id === grandchildId ? 'NEEDLE' : entity.id}`,
      searchText: `SYNTHETIC_SUPPLEMENT_${entity.id === grandchildId ? 'NEEDLE' : entity.id}`,
      reviewOwnerLabel: `合成独立维护者 ${entity.id}`,
      internalNotes: privateText,
    });
    if (collected) Object.assign(revision.data, {
      demo: false, origin: 'ai_draft', verifiedAt: '', researchedAt: '2026-08-29T00:00:00Z',
    });
  }
  revisionOf(fixture, siblingId).data.scope = structuredClone(revisionOf(fixture, parentId).data.scope);
  revisionOf(fixture, siblingId).data.scopeMode = 'constrained';
  revisionOf(fixture, childId).data.supplementTo = parentId;
  revisionOf(fixture, grandchildId).data.supplementTo = childId;
  revisionOf(fixture, grandchildId).data.scope.campus = ['taicang'];
  fixture.links = [{ id: 'synthetic-supplement-related', from: childId, to: grandchildId, reason: '两条公开补充的阅读线索', privateNotes: privateText }];
  mutate?.(fixture);
  const h = await harness(t, { guide: true, mutateBundle(bundle) {
    for (const name of ['entities', 'revisions', 'citations', 'links']) bundle[name] = structuredClone(fixture[name]);
  } });
  const config = await loadDemoPagesConfig();
  config.collectedRevisionIds = collected
    ? fixture.revisions.filter(row => fixture.entities.some(entity => entity.id === row.entityId && entity.type === 'answer')).map(row => row.id)
    : [];
  const snapshot = (overrides = {}) => createReviewedPagesData({
    state: h.store.read(), catalog: h.catalog, config: { ...config, ...overrides }, keyring, now: new Date(h.time()).toISOString(),
  });
  const demo = (overrides = {}) => createPagesData({
    config: { ...config, ...overrides }, profile: h.business.content, content: h.bundle, catalog: h.catalog, now: new Date(h.time()).toISOString(),
  });
  if (collected || !publish) h.store.transact(state => { state.modules.content = importContent(state.modules.content, h.bundle); });
  else h.publish();
  return { ...h, config, snapshot, demo };
}

function assertPrivateFieldsAbsent(data) {
  assert.equal(JSON.stringify(data).includes(privateText), false);
  for (const link of data.links ?? []) assert.deepEqual(Object.keys(link).sort(), ['from', 'id', 'reason', 'to', 'type']);
}

function assertNestedAnswers(data) {
  assert.deepEqual(ids(data.answers), [parentId, childId, grandchildId, siblingId].sort());
  const byId = new Map(data.answers.map(answer => [answer.id, answer]));
  assert.equal(byId.get(parentId).supplementTo, undefined);
  assert.equal(byId.get(siblingId).supplementTo, undefined);
  assert.equal(byId.get(childId).supplementTo, parentId);
  assert.equal(byId.get(grandchildId).supplementTo, childId);
  assert.equal(new Set(data.answers.map(answer => answer.revisionId)).size, 4);
  assert.equal(new Set(data.answers.map(answer => answer.citations[0].sourceEntityId)).size, 4, 'each statement and supplement retains its own source');
  assert.deepEqual(byId.get(parentId).scope.campus, ['suzhou']);
  assert.deepEqual(byId.get(grandchildId).scope.campus, ['taicang']);
  assertPrivateFieldsAbsent(data);
}

test('nested supplements keep their own revisions, sources and scope in public API and both Pages projections', async t => {
  const h = await setup(t);
  const before = h.store.read();
  const api = await readJson(await h.get('/api/guide/branches'));
  assert.deepEqual(api.contextAnswers, []);
  assert.deepEqual(api.answers, await readJson(await h.get('/api/guide/answers')));
  for (const data of [api, h.snapshot(), h.demo()]) {
    assertNestedAnswers(data);
    assert.equal(new Set(data.answers.map(answer => answer.reviewOwnerLabel)).size, 4, 'supplements do not inherit the parent verification label');
  }
  for (const id of [childId, grandchildId]) {
    const entity = h.bundle.entities.find(row => row.id === id);
    const answer = await readJson(await h.get(`/api/guide/answers/${entity.extensions.slug}`));
    assert.equal(answer.supplementTo, id === childId ? parentId : childId);
  }
  assert.deepEqual(validateReviewedPagesData(h.snapshot(), { config: h.config }), h.snapshot());
  assert.deepEqual(h.store.read(), before, 'public projections must not rewrite content or reviews');
});

test('search and scope matches return public ancestors as context without adding them to answer results', async t => {
  const h = await setup(t);
  const scope = encodeURIComponent(JSON.stringify({ campus: ['taicang'] }));
  for (const query of ['q=SYNTHETIC_SUPPLEMENT_NEEDLE', `scope=${scope}`, `q=SYNTHETIC_SUPPLEMENT_NEEDLE&scope=${scope}`]) {
    const data = await readJson(await h.get(`/api/guide/branches?${query}`));
    assert.deepEqual(ids(data.answers), [grandchildId], query);
    assert.deepEqual(ids(data.contextAnswers), [parentId, childId].sort(), query);
    assert.equal(data.contextAnswers.find(answer => answer.id === childId).supplementTo, parentId);
    assert.deepEqual(data.answers, await readJson(await h.get(`/api/guide/answers?${query}`)), 'ordinary search results contain no ancestor context');
    const visible = new Set([...data.answers, ...data.contextAnswers].map(answer => answer.id));
    for (const link of data.links) assert.ok(visible.has(link.from) && visible.has(link.to));
    assertPrivateFieldsAbsent(data);
  }
  const noMatch = await readJson(await h.get('/api/guide/branches?q=SYNTHETIC_SUPPLEMENT_NOT_FOUND'));
  assert.deepEqual(noMatch, { answers: [], contextAnswers: [], links: [] });
  const parentsMatch = await readJson(await h.get('/api/guide/branches?q=SYNTHETIC_SUPPLEMENT'));
  assert.deepEqual(parentsMatch.contextAnswers, [], 'ancestors already matched are not duplicated');
});

test('hidden articles and withdrawn sources remove their complete supplement subtree from public projections and search context', async t => {
  for (const removal of ['parent-hidden', 'parent-source-withdrawn', 'child-hidden', 'child-source-withdrawn']) {
    await t.test(removal, async t => {
      const h = await setup(t);
      const parentRemoval = removal.startsWith('parent');
      h.store.transact(state => {
        const targetId = removal.endsWith('source-withdrawn')
          ? (parentRemoval ? 'artifact-ebridge' : 'artifact-learning-mall')
          : (parentRemoval ? parentId : childId);
        const entity = state.modules.content.entities.find(row => row.id === targetId);
        state.modules.content = removal.endsWith('source-withdrawn')
          ? setSourceDisposition(state.modules.content, { entityId: entity.id, expectedVersion: entity.version, disposition: 'withdrawn' })
          : hideContent(state.modules.content, { entityId: entity.id, expectedVersion: entity.version, hidden: true });
      });
      const expected = parentRemoval ? [siblingId] : [parentId, siblingId].sort();
      for (const data of [await readJson(await h.get('/api/guide/branches')), h.snapshot()]) {
        assert.deepEqual(ids(data.answers), expected);
        assert.deepEqual(data.links, []);
        assertPrivateFieldsAbsent(data);
      }
      assert.deepEqual(ids(await readJson(await h.get('/api/guide/answers'))), expected);
      assert.deepEqual(await readJson(await h.get('/api/guide/branches?q=SYNTHETIC_SUPPLEMENT_NEEDLE')), { answers: [], contextAnswers: [], links: [] });
      const entity = h.bundle.entities.find(row => row.id === grandchildId);
      await readJson(await h.get(`/api/guide/answers/${entity.extensions.slug}`), 404);
    });
  }
});

test('unpublished or invalid parents never promote a supplement or its descendants into root statements', async t => {
  const cases = [
    ['unpublished', fixture => Object.assign(revisionOf(fixture, parentId).data, { demo: false, origin: 'ai_draft', verifiedAt: '' }), [siblingId]],
    ['missing', fixture => { revisionOf(fixture, childId).data.supplementTo = 'synthetic-unpublished-parent'; }, [parentId, siblingId]],
    ['cross-topic', fixture => { fixture.entities.find(row => row.id === parentId).extensions.topicId = 'topic-services'; }, [parentId, siblingId]],
    ['self-cycle', fixture => { revisionOf(fixture, childId).data.supplementTo = childId; }, [parentId, siblingId]],
    ['ancestor-cycle', fixture => { revisionOf(fixture, parentId).data.supplementTo = grandchildId; }, [siblingId]],
  ];
  for (const [name, mutate, expected] of cases) {
    await t.test(name, async t => {
      const h = await setup(t, { mutate });
      for (const data of [await readJson(await h.get('/api/guide/branches')), h.snapshot()]) {
        assert.deepEqual(ids(data.answers), [...expected].sort());
        assert.deepEqual(data.links, []);
        assertPrivateFieldsAbsent(data);
      }
      assert.deepEqual(await readJson(await h.get('/api/guide/branches?q=SYNTHETIC_SUPPLEMENT_NEEDLE')), { answers: [], contextAnswers: [], links: [] });
    });
  }
});

test('removing an allowed demo parent also removes selected supplement descendants from Pages', async t => {
  const h = await setup(t);
  const publishedRevisionIds = h.config.publishedRevisionIds.filter(id => id !== revisionOf(h.bundle, parentId).id);
  for (const data of [h.snapshot({ publishedRevisionIds }), h.demo({ publishedRevisionIds })]) {
    assert.deepEqual(ids(data.answers), [siblingId]);
    assert.deepEqual(data.links, []);
    assertPrivateFieldsAbsent(data);
  }
});

test('snapshot validation rejects dirty supplement metadata, dangling or cross-topic references and cycles even with a fresh hash', async t => {
  const h = await setup(t);
  const original = h.snapshot();
  const child = data => data.answers.find(answer => answer.id === childId);
  const parent = data => data.answers.find(answer => answer.id === parentId);
  for (const mutate of [
    data => { child(data).supplementTo = { id: parentId, privateNotes: privateText }; },
    data => { child(data).supplementTo = ''; },
    data => { child(data).supplementTo = null; },
    data => { child(data).supplementTo = ' private parent '; },
    data => { child(data).supplementTo = 'synthetic-missing-parent'; },
    data => { child(data).supplementTo = childId; },
    data => { parent(data).supplementTo = grandchildId; },
    data => { parent(data).topic = { id: 'topic-services', slug: 'services', title: '合成其他话题' }; },
    data => { child(data).supplementNotes = privateText; },
  ]) {
    const invalid = structuredClone(original);
    mutate(invalid);
    invalid.contentHash = pagesContentHash(invalid);
    assert.throws(() => validateReviewedPagesData(invalid, { config: h.config }), { code: 'PAGES_SNAPSHOT_INVALID' });
  }
  const old = structuredClone(original);
  for (const answer of old.answers) delete answer.supplementTo;
  old.contentHash = pagesContentHash(old);
  assert.deepEqual(validateReviewedPagesData(old, { config: h.config }), old, 'snapshots from before supplement support still load');
});

test('explicit collected supplements preserve unverified status and require every ancestor in the public release', async t => {
  const h = await setup(t, { collected: true });
  const before = h.store.read();
  const data = h.snapshot();
  assertNestedAnswers(data);
  for (const answer of data.answers) {
    assert.equal(answer.reviewStatus, 'collected');
    assert.equal(answer.origin, 'ai_draft');
    assert.equal(answer.verifiedAt, '');
    assert.equal(answer.reviewOwnerLabel, '尚未人工核验');
  }
  assert.deepEqual(await readJson(await h.get('/api/guide/branches')), { answers: [], contextAnswers: [], links: [] }, 'Pages collection is not runtime publication');
  const omit = entityId => h.config.collectedRevisionIds.filter(id => id !== revisionOf(h.bundle, entityId).id);
  assert.deepEqual(ids(h.snapshot({ collectedRevisionIds: omit(parentId) }).answers), [siblingId]);
  assert.deepEqual(ids(h.snapshot({ collectedRevisionIds: omit(childId) }).answers), [parentId, siblingId].sort());
  assert.deepEqual(h.store.read(), before, 'selecting collection ancestors does not fabricate publication or approval');
  h.store.transact(state => {
    const entity = state.modules.content.entities.find(row => row.id === 'artifact-ebridge');
    state.modules.content = setSourceDisposition(state.modules.content, { entityId: entity.id, expectedVersion: entity.version, disposition: 'withdrawn' });
  });
  assert.deepEqual(ids(h.snapshot().answers), [siblingId], 'an explicitly selected collected child cannot survive its unavailable parent');
});

const reviewReason = '已独立核对合成补充的来源和适用范围，记录本次人工审核结论。';
const reviewItem = article => ({
  entityId: article.entityId, revisionId: article.revisionId, expectedVersion: article.version,
  expectedReviewId: article.latestReview?.id ?? null, decision: 'approved', reason: reviewReason,
});

test('one approval batch accepts child-before-parent order and preserves supplement relationships in immutable confirmed revisions', async t => {
  const h = await setup(t, { collected: true });
  const { token } = await h.operator(['content_reviewer']);
  const articles = (await readJson(await h.get('/api/guide/review-articles', token))).articles;
  for (const [id, ancestorId] of [[childId, parentId], [grandchildId, childId]]) {
    assert.deepEqual(articles.find(article => article.entityId === id).supplement, {
      entityId: ancestorId, title: revisionOf(h.bundle, ancestorId).data.title, publicRevisionId: null, hidden: false,
    }, 'reviewers can inspect the exact supplement parent before deciding to approve');
  }
  assert.equal(articles.find(article => article.entityId === parentId).supplement, undefined);
  const ordered = [grandchildId, childId, parentId];
  const originalContent = h.store.read().modules.content;
  const batch = { mode: 'review-and-publish', items: ordered.map(id => reviewItem(articles.find(article => article.entityId === id))) };
  const result = await readJson(await h.post('/api/guide/reviews/batch', batch, token, 'synthetic-supplement-reverse-batch'));
  assert.equal(result.publishedCount, 3);
  assert.deepEqual(result.records.map(record => record.entityId), ordered);
  const after = h.store.read();
  for (const record of result.records) {
    const original = originalContent.revisions.find(revision => revision.id === record.revisionId);
    const confirmed = after.modules.content.revisions.find(revision => revision.id === record.publishedRevisionId);
    assert.equal(confirmed.entityId, original.entityId);
    assert.equal(confirmed.parentRevisionId, original.id);
    assert.equal(confirmed.data.supplementTo, original.data.supplementTo);
    assert.deepEqual(confirmed.data.sentences, original.data.sentences);
    assert.deepEqual(after.modules.content.revisions.find(revision => revision.id === original.id), original);
  }
  for (const data of [await readJson(await h.get('/api/guide/branches')), h.snapshot({ collectedRevisionIds: [] })]) {
    assert.deepEqual(ids(data.answers), [...ordered].sort());
    assert.equal(data.answers.find(answer => answer.id === childId).supplementTo, parentId);
    assert.equal(data.answers.find(answer => answer.id === grandchildId).supplementTo, childId);
    assert.equal(JSON.stringify(data).includes(reviewReason), false);
    assertPrivateFieldsAbsent(data);
  }
  const snapshot = h.snapshot({ collectedRevisionIds: [] });
  assert.ok(snapshot.answers.every(answer => answer.reviewStatus === 'approved' && answer.originalOrigin === 'ai_draft'));
  assert.deepEqual(await readJson(await h.post('/api/guide/reviews/batch', batch, token, 'synthetic-supplement-reverse-batch')), result);
  assert.deepEqual(h.store.read(), after, 'replaying a nested approval batch does not duplicate confirmations');
});

test('approval batches reject missing or cross-topic parents and cycles atomically', async t => {
  const cases = [
    ['missing-parent', fixture => { revisionOf(fixture, childId).data.supplementTo = 'synthetic-missing-parent'; }, [grandchildId, childId, parentId]],
    ['cross-topic', fixture => { fixture.entities.find(row => row.id === parentId).extensions.topicId = 'topic-services'; }, [grandchildId, childId, parentId]],
    ['self-cycle', fixture => { revisionOf(fixture, childId).data.supplementTo = childId; }, [grandchildId, childId, parentId]],
    ['ancestor-cycle', fixture => { revisionOf(fixture, parentId).data.supplementTo = grandchildId; }, [grandchildId, childId, parentId]],
  ];
  for (const [name, mutate, approvedIds] of cases) {
    await t.test(name, async t => {
      const h = await setup(t, { collected: true, mutate });
      const { token } = await h.operator(['content_reviewer']);
      const articles = (await readJson(await h.get('/api/guide/review-articles', token))).articles;
      const before = h.store.read();
      const result = await readJson(await h.post('/api/guide/reviews/batch', {
        mode: 'review-and-publish', items: approvedIds.map(id => reviewItem(articles.find(article => article.entityId === id))),
      }, token), 422);
      assert.equal(result.code, 'GUIDE_SUPPLEMENT');
      assert.deepEqual(h.store.read(), before, 'invalid supplement batches leave content, publication pointers, reviews, audit and replay unchanged');
      assert.deepEqual(await readJson(await h.get('/api/guide/branches')), { answers: [], contextAnswers: [], links: [] });
    });
  }
});

test('single-article publication cannot reference a missing parent or create a self cycle', async t => {
  for (const supplementTo of [childId, 'synthetic-missing-parent']) {
    await t.test(supplementTo, async t => {
      const h = await setup(t, { publish: false, mutate: fixture => { revisionOf(fixture, childId).data.supplementTo = supplementTo; } });
      const { token } = await h.operator(['content_reviewer']);
      const before = h.store.read();
      const entity = before.modules.content.entities.find(row => row.id === childId);
      const result = await readJson(await h.post('/api/content/publish', {
        entityId: childId, revisionId: revisionOf(h.bundle, childId).id, expectedVersion: entity.version, reason: reviewReason,
      }, token), 422);
      assert.equal(result.code, 'GUIDE_SUPPLEMENT');
      assert.deepEqual(h.store.read(), before, 'rejected direct publication must not save a review or publication pointer');
    });
  }
});

test('a supplement can be reviewed independently while its explicitly collected parent remains an unverified AI draft', async t => {
  const h = await setup(t, { collected: true });
  const { token } = await h.operator(['content_reviewer']);
  const articles = (await readJson(await h.get('/api/guide/review-articles', token))).articles;
  const child = articles.find(article => article.entityId === childId);
  const before = h.store.read();
  const originalParent = before.modules.content.revisions.find(revision => revision.entityId === parentId);
  const originalChild = before.modules.content.revisions.find(revision => revision.id === child.revisionId);
  const result = await readJson(await h.post('/api/guide/reviews/batch', {
    mode: 'review-and-publish', items: [reviewItem(child)],
  }, token));
  assert.equal(result.publishedCount, 1);
  const after = h.store.read();
  const parentEntity = after.modules.content.entities.find(entity => entity.id === parentId);
  const parentRevision = after.modules.content.revisions.find(revision => revision.id === originalParent.id);
  assert.deepEqual(parentRevision, originalParent, 'approving a supplement leaves the parent draft untouched');
  assert.equal(parentRevision.data.origin, 'ai_draft');
  assert.equal(parentRevision.data.verifiedAt, '');
  assert.equal(parentEntity.publicRevisionId, null);
  assert.deepEqual(parentEntity.publishedRevisionIds, []);
  assert.deepEqual(after.modules['guide-reviews'].records.map(record => record.entityId), [childId]);
  const confirmed = after.modules.content.revisions.find(revision => revision.id === result.records[0].publishedRevisionId);
  assert.equal(confirmed.parentRevisionId, originalChild.id);
  assert.equal(confirmed.data.supplementTo, parentId);
  assert.equal(confirmed.data.origin, 'human');
  assert.equal(confirmed.data.originalOrigin, 'ai_draft');
  assert.equal(Date.parse(confirmed.data.verifiedAt), h.time());
  assert.deepEqual(await readJson(await h.get('/api/guide/branches')), { answers: [], contextAnswers: [], links: [] });
  assert.deepEqual(await readJson(await h.get('/api/guide/answers')), [], 'the local reader still requires a publicly visible parent');
  const selected = { collectedRevisionIds: [originalParent.id] };
  const data = h.snapshot(selected);
  assert.deepEqual(ids(data.answers), [parentId, childId].sort());
  const shownParent = data.answers.find(answer => answer.id === parentId);
  const shownChild = data.answers.find(answer => answer.id === childId);
  assert.equal(shownParent.reviewStatus, 'collected');
  assert.equal(shownParent.origin, 'ai_draft');
  assert.equal(shownParent.verifiedAt, '');
  assert.equal(shownParent.reviewOwnerLabel, '尚未人工核验');
  assert.equal(shownChild.reviewStatus, 'approved');
  assert.equal(shownChild.supplementTo, parentId);
  assert.equal(shownChild.revisionId, confirmed.id);
  assert.equal(shownChild.origin, 'human');
  assert.equal(shownChild.originalOrigin, 'ai_draft');
  assert.notEqual(shownChild.citations[0].sourceEntityId, shownParent.citations[0].sourceEntityId);
  assert.deepEqual(validateReviewedPagesData(data, { config: { ...h.config, ...selected } }), data);
  assertPrivateFieldsAbsent(data);
  assert.deepEqual(h.snapshot({ collectedRevisionIds: [] }).answers, [], 'removing collection consent also removes the reviewed child from this release');
  assert.deepEqual(h.store.read(), after, 'mixed collected and reviewed exports do not mutate either review status');
  h.store.transact(state => {
    const source = state.modules.content.entities.find(entity => entity.id === 'artifact-ebridge');
    state.modules.content = setSourceDisposition(state.modules.content, { entityId: source.id, expectedVersion: source.version, disposition: 'withdrawn' });
  });
  assert.deepEqual(h.snapshot(selected).answers, [], 'withdrawing the parent source removes the whole mixed-status branch');
});
