import assert from 'node:assert/strict';
import test from 'node:test';
import { decryptPrivatePayload, encryptPrivatePayload, importContent } from '@information-community/runtime';
import { harness, keyring, readJson } from './helpers.mjs';

const decisions = ['approved', 'changes-requested', 'needs-verification', 'excluded'];
const reviewReason = '已逐句核对来源和适用范围，记录本次人工审核结论。'.normalize('NFKC');

async function setup(t, options = {}) {
  const h = await harness(t, { guide: true, ...options });
  h.store.transact(state => { state.modules.content = importContent(state.modules.content, h.bundle); });
  const { token } = await h.operator(['content_reviewer']);
  const articles = (await readJson(await h.get('/api/guide/review-articles', token))).articles;
  return { ...h, token, articles, drafts: articles.filter(row => row.origin === 'ai_draft') };
}

const batch = items => ({ mode: 'review-and-publish', items });

function item(article, overrides = {}) {
  return {
    entityId: article.entityId, revisionId: article.revisionId,
    expectedVersion: article.version, expectedReviewId: article.latestReview?.id ?? null,
    decision: 'approved', reason: reviewReason, ...overrides,
  };
}

async function rejectUnchanged(h, input, status = 400, token = h.token, key) {
  const before = h.store.read();
  const result = await readJson(await h.post('/api/guide/reviews/batch', input, token, key), status);
  assert.deepEqual(h.store.read(), before, 'rejected batches must leave content, reviews, audit and replay unchanged');
  return result;
}

function addRevision(h, revisionId, title = 'Synthetic updated content awaiting a new review', changes = {}) {
  const content = h.store.read().modules.content;
  const original = content.revisions.find(row => row.id === revisionId);
  const draft = structuredClone(original);
  draft.id = `${original.id}-review-next`;
  draft.parentRevisionId = original.id;
  draft.number += 1;
  draft.data.title = title;
  Object.assign(draft.data, changes);
  const citations = content.citations.filter(row => row.revisionId === original.id).map(row => ({
    ...structuredClone(row), id: `${row.id}-review-next`, revisionId: draft.id,
  }));
  h.store.transact(state => {
    state.modules.content = importContent(state.modules.content, {
      schemaVersion: 1, entities: [], revisions: [draft], citations, links: [],
    });
  });
  return draft;
}

test('review queue returns all latest article drafts with full sentences and exact cited source revisions', async t => {
  const h = await setup(t);
  const contentTypes = h.business.content.entityTypes.filter(row => row.role === 'content').map(row => row.id);
  const expectedEntities = h.bundle.entities.filter(row => contentTypes.includes(row.type));
  assert.equal(h.articles.length, expectedEntities.length);
  assert.ok(h.drafts.length > 0);
  assert.ok(h.articles.every(row => row.latestReview === null && row.reviewStatus === 'pending'));
  assert.deepEqual(new Set(h.articles.map(row => row.entityId)), new Set(expectedEntities.map(row => row.id)));
  const originalCitation = h.bundle.citations.find(row => row.revisionId === h.drafts[0].revisionId);
  const originalSource = h.bundle.revisions.find(row => row.id === originalCitation.sourceRevisionId);
  addRevision(h, originalSource.id, 'Synthetic newer source title that must not replace the cited version');
  const rows = (await readJson(await h.get('/api/guide/review-articles', h.token))).articles;
  for (const row of rows) {
    const revision = h.bundle.revisions.find(revision => revision.id === row.revisionId);
    assert.equal(row.title, revision.data.title);
    assert.equal(row.summary, revision.data.summary ?? '');
    assert.equal(typeof row.scope, 'string');
    assert.deepEqual(row.sentences.map(({ id, kind, text }) => ({ id, kind, text })), revision.data.sentences);
    for (const sentence of row.sentences) {
      const citations = h.bundle.citations.filter(citation => citation.revisionId === row.revisionId && citation.sentenceId === sentence.id).sort((a, b) => a.order - b.order);
      assert.equal(sentence.citations.length, citations.length);
      for (const [index, citation] of citations.entries()) {
        const source = h.bundle.revisions.find(revision => revision.id === citation.sourceRevisionId);
        const shown = sentence.citations[index];
        assert.equal(shown.sourceId, citation.sourceEntityId);
        assert.equal(shown.sourceRevisionId, source.id);
        assert.equal(shown.title, source.data.title);
        assert.equal(shown.url, source.data.url);
        assert.equal(shown.accessedAt, source.data.accessedAt ?? '');
      }
    }
  }
  assert.equal(JSON.stringify(rows).includes('Synthetic newer source title'), false);
});

test('article review requires authentication and reviewer permission while editors may only read', async t => {
  const h = await setup(t);
  await readJson(await h.get('/api/guide/review-articles'), 401);
  await rejectUnchanged(h, { mode: 'review-and-publish', items: [item(h.drafts[0])] }, 401, null);
  for (const [role, canRead] of [['content_editor', true], ['safety_reviewer', false], ['pilot_operator', false]]) {
    const account = await h.operator([role], `batch-${role}`);
    await readJson(await h.get('/api/guide/review-articles', account.token), canRead ? 200 : 403);
    await rejectUnchanged(h, { mode: 'review-and-publish', items: [item(h.drafts[0])] }, 403, account.token);
  }
  const missingKey = await rejectUnchanged(h, { mode: 'review-and-publish', items: [item(h.drafts[0])] }, 400, h.token, null);
  assert.equal(missingKey.code, 'IDEMPOTENCY_KEY_REQUIRED');
});

test('approval publishes a human-confirmed immutable revision while other decisions only save encrypted reviews', async t => {
  const h = await setup(t);
  const input = { mode: 'review-and-publish', items: h.drafts.slice(0, 4).map((article, index) => item(article, {
    decision: decisions[index], reason: `${reviewReason}第${index + 1}篇。`,
  })) };
  const beforeContent = h.store.read().modules.content;
  const result = await readJson(await h.post('/api/guide/reviews/batch', input, h.token, 'mixed-decisions-batch'));
  assert.equal(result.count, 4);
  assert.equal(result.publishedCount, 1);
  assert.equal(result.records.length, 4);
  assert.equal(typeof result.batchId, 'string');
  const after = h.store.read();
  const published = after.modules.content.revisions.find(row => row.id === result.records[0].publishedRevisionId);
  const original = beforeContent.revisions.find(row => row.id === input.items[0].revisionId);
  assert.ok(published && published.id !== original.id);
  assert.equal(published.parentRevisionId, original.id);
  assert.equal(published.number, original.number + 1);
  assert.equal(published.data.origin, 'human');
  assert.equal(published.data.originalOrigin, 'ai_draft');
  assert.equal(published.data.reviewedFromRevisionId, original.id);
  assert.equal(published.data.reviewOwnerId, 'integration-operator');
  assert.equal(published.data.reviewOwnerLabel, 'Integration Operator');
  assert.equal(Date.parse(published.data.verifiedAt), h.time());
  assert.equal(published.data.asOf, original.data.asOf, 'reviewing a source does not silently change its original as-of date');
  assert.ok(Date.parse(published.data.reviewDueAt) > h.time());
  assert.ok(Date.parse(published.data.reviewDueAt) <= h.time() + 90 * 86_400_000);
  assert.deepEqual(published.data.sentences, original.data.sentences);
  assert.deepEqual(published.data.scope, original.data.scope);
  for (const row of beforeContent.revisions) {
    assert.deepEqual(after.modules.content.revisions.find(current => current.id === row.id), row, 'all existing revisions retain their exact provenance and content');
  }
  const originalCitations = beforeContent.citations.filter(row => row.revisionId === original.id);
  const publishedCitations = after.modules.content.citations.filter(row => row.revisionId === published.id);
  assert.equal(publishedCitations.length, originalCitations.length);
  for (const [index, citation] of publishedCitations.entries()) {
    assert.notEqual(citation.id, originalCitations[index].id);
    assert.deepEqual({ ...citation, id: originalCitations[index].id, revisionId: original.id }, originalCitations[index]);
  }
  assert.equal(after.modules.content.revisions.length, beforeContent.revisions.length + 1);
  assert.equal(after.modules['guide-reviews'].records.length, 4);
  for (const [index, submitted] of input.items.entries()) {
    const saved = after.modules['guide-reviews'].records[index];
    assert.equal(saved.action, 'content.review');
    assert.equal(saved.entityId, submitted.entityId);
    assert.equal(saved.revisionId, submitted.revisionId);
    assert.equal(saved.actorId, 'integration-operator');
    assert.equal(saved.createdAt, h.time());
    const payload = decryptPrivatePayload(saved.id, saved.payload, keyring);
    assert.equal(payload.reason, submitted.reason);
    assert.equal(payload.outcome.decision, submitted.decision);
    assert.equal(payload.outcome.batchId, result.batchId);
    assert.equal(payload.outcome.publishedRevisionId, index === 0 ? published.id : null);
    const entity = after.modules.content.entities.find(row => row.id === submitted.entityId);
    assert.deepEqual(result.records[index], {
      entityId: saved.entityId, revisionId: saved.revisionId, reviewId: saved.id, decision: submitted.decision,
      publicRevisionId: entity.publicRevisionId, version: entity.version, publishedRevisionId: index === 0 ? published.id : null,
    });
    assert.equal(entity.publicRevisionId, index === 0 ? published.id : null);
    assert.equal(entity.version, submitted.expectedVersion + (index === 0 ? 1 : 0));
    assert.equal(JSON.stringify(after).includes(submitted.reason), false);
  }
  assert.deepEqual(await readJson(await h.post('/api/guide/reviews/batch', input, h.token, 'mixed-decisions-batch')), result);
  assert.deepEqual(h.store.read(), after, 'replaying the same batch must not duplicate any state');
  const conflict = await rejectUnchanged(h, { mode: 'review-and-publish', items: [item(h.drafts[0], { decision: 'excluded' })] }, 409, h.token, 'mixed-decisions-batch');
  assert.equal(conflict.code, 'IDEMPOTENCY_CONFLICT');
  const refreshed = (await readJson(await h.get('/api/guide/review-articles', h.token))).articles;
  for (const submitted of input.items) {
    const shown = refreshed.find(row => row.entityId === submitted.entityId);
    assert.equal(shown.reviewStatus, submitted.decision);
    assert.equal(shown.latestReview.reason, submitted.reason);
    assert.equal(shown.latestReview.actorId, 'integration-operator');
    assert.equal(shown.revisionId, submitted.decision === 'approved' ? published.id : submitted.revisionId);
    const history = await readJson(await h.get(`/api/guide/reviews?entityId=${submitted.entityId}`, h.token));
    assert.equal(history[0].outcome.decision, submitted.decision);
    assert.equal(history[0].outcome.batchId, result.batchId);
    assert.equal(history[0].revisionId, submitted.revisionId, 'audit records remain bound to the revision the reviewer actually saw');
  }
  for (const path of ['/api/list', '/api/export', '/api/guide/answers']) {
    const value = JSON.stringify(await readJson(await h.get(path)));
    assert.equal(value.includes(reviewReason), false);
    assert.equal(value.includes(h.drafts[0].title), true);
    assert.equal(value.includes(h.drafts[1].title), false);
  }
  const approved = input.items[0];
  const beforePublish = h.store.read();
  const rejection = await readJson(await h.post('/api/content/publish', {
    entityId: approved.entityId, revisionId: approved.revisionId, expectedVersion: result.records[0].version,
    reason: reviewReason,
  }, h.token), 422);
  assert.equal(rejection.code, 'POLICY_REJECTED');
  assert.deepEqual(h.store.read(), beforePublish);
});

test('invalid batch shape, duplicates, choices and later-row reasons roll back every record', async t => {
  const h = await setup(t);
  const valid = item(h.drafts[0]);
  for (const mode of [undefined, null, '', 'review-only']) {
    const rejection = await rejectUnchanged(h, { mode, items: [valid] });
    assert.equal(rejection.code, 'GUIDE_REVIEW_MODE');
  }
  for (const input of [
    null, {}, { mode: 'review-and-publish', items: null }, { mode: 'review-and-publish', items: [] }, { mode: 'review-and-publish', items: {} }, { mode: 'review-and-publish', items: [null] },
    { mode: 'review-and-publish', items: [valid], publish: true }, { mode: 'review-and-publish', items: [valid, valid] },
    { mode: 'review-and-publish', items: Array.from({ length: 101 }, () => valid) },
    ...[
      { entityId: '' }, { entityId: 'bad/id' }, { revisionId: null }, { revisionId: [] },
      { expectedVersion: -1 }, { expectedVersion: 0.5 }, { expectedVersion: '0' },
      { expectedReviewId: '' }, { expectedReviewId: 0 }, { expectedReviewId: undefined },
      { decision: 'pending' }, { decision: 'publish' }, { decision: null }, { extra: true },
    ].map(overrides => ({ mode: 'review-and-publish', items: [item(h.drafts[0], overrides)] })),
    ...[undefined, null, 123, '', '太短', 'x'.repeat(401), '需要联系 synthetic@example.org 确认。'].map(reason => ({
      items: [valid, item(h.drafts[1], { reason })],
    })),
  ]) await rejectUnchanged(h, input);
  const source = h.bundle.entities.find(row => row.type === 'artifact');
  const sourceRevision = h.bundle.revisions.find(row => row.entityId === source.id);
  await rejectUnchanged(h, { mode: 'review-and-publish', items: [item(h.drafts[0], { entityId: source.id, revisionId: sourceRevision.id })] });
});

test('stale review, entity version and article revision reject the whole batch, and new revisions start pending', async t => {
  const h = await setup(t);
  const first = h.drafts[0], second = h.drafts[1];
  await readJson(await h.post('/api/guide/reviews/batch', { mode: 'review-and-publish', items: [item(first)] }, h.token));
  let refreshed = (await readJson(await h.get('/api/guide/review-articles', h.token))).articles.find(row => row.entityId === first.entityId);
  for (const changed of [
    item(first), item(refreshed, { expectedReviewId: 'missing-review' }),
    item(refreshed, { expectedVersion: refreshed.version + 1 }),
  ]) {
    const rejection = await rejectUnchanged(h, { mode: 'review-and-publish', items: [item(second), changed] }, 409);
    assert.equal(rejection.code, 'CONFLICT');
  }
  await rejectUnchanged(h, { mode: 'review-and-publish', items: [item(second), item(refreshed, { revisionId: second.revisionId })] });
  const previousId = refreshed.latestReview.id;
  const confirmedRevisionId = refreshed.revisionId;
  const publicRevisionId = refreshed.publicRevisionId;
  await readJson(await h.post('/api/guide/reviews/batch', { mode: 'review-and-publish', items: [item(refreshed, { decision: 'changes-requested' })] }, h.token));
  refreshed = (await readJson(await h.get('/api/guide/review-articles', h.token))).articles.find(row => row.entityId === first.entityId);
  assert.equal(refreshed.reviewStatus, 'changes-requested');
  assert.equal(refreshed.publicRevisionId, publicRevisionId, 'a request for changes does not unpublish existing content');
  assert.notEqual(refreshed.latestReview.id, previousId);
  const next = addRevision(h, refreshed.revisionId);
  const rejection = await rejectUnchanged(h, { mode: 'review-and-publish', items: [item(second), item(refreshed)] }, 409);
  assert.equal(rejection.code, 'CONFLICT');
  const latest = (await readJson(await h.get('/api/guide/review-articles', h.token))).articles.find(row => row.entityId === first.entityId);
  assert.equal(latest.revisionId, next.id);
  assert.equal(latest.reviewStatus, 'pending');
  assert.equal(latest.latestReview, null);
  await readJson(await h.post('/api/guide/reviews/batch', { mode: 'review-and-publish', items: [item(latest)] }, h.token));
  const history = await readJson(await h.get(`/api/guide/reviews?entityId=${first.entityId}`, h.token));
  assert.deepEqual(history.map(row => row.revisionId), [first.revisionId, confirmedRevisionId, next.id]);
});

test('review records bind the viewed draft instead of an older public revision, and a hidden-state change invalidates selection', async t => {
  const h = await setup(t);
  const original = h.articles.find(row => row.origin !== 'ai_draft');
  await readJson(await h.post('/api/content/publish', {
    entityId: original.entityId, revisionId: original.revisionId, expectedVersion: original.version, reason: reviewReason,
  }, h.token));
  const draft = addRevision(h, original.revisionId);
  const row = (await readJson(await h.get('/api/guide/review-articles', h.token))).articles.find(row => row.entityId === original.entityId);
  assert.equal(row.publicRevisionId, original.revisionId);
  assert.equal(row.revisionId, draft.id);
  const result = await readJson(await h.post('/api/guide/reviews/batch', { mode: 'review-and-publish', items: [item(row)] }, h.token));
  assert.equal(result.records[0].revisionId, draft.id);
  assert.equal(h.store.read().modules.content.entities.find(entity => entity.id === row.entityId).publicRevisionId, result.records[0].publishedRevisionId);
  assert.notEqual(result.records[0].publishedRevisionId, original.revisionId);
  assert.notEqual(result.records[0].publishedRevisionId, draft.id);
  const reviewed = (await readJson(await h.get('/api/guide/review-articles', h.token))).articles.find(article => article.entityId === row.entityId);
  await readJson(await h.post('/api/content/hide', { entityId: row.entityId, expectedVersion: reviewed.version, hidden: true, reason: reviewReason }, h.token));
  const rejection = await rejectUnchanged(h, { mode: 'review-and-publish', items: [item(h.drafts[0]), item(reviewed)] }, 409);
  assert.equal(rejection.code, 'CONFLICT');
});

test('failed batch persistence rolls back content, all encrypted reviews, audit and idempotency', async t => {
  const h = await setup(t);
  const input = { mode: 'review-and-publish', items: h.drafts.slice(0, 3).map(article => item(article)) };
  const module = h.store.modules.get('guide-reviews');
  h.store.modules.set('guide-reviews', { ...module, validate() { throw new Error('synthetic batch persistence rejection'); } });
  await rejectUnchanged(h, input, 500, h.token, 'batch-persistence-retry');
  h.store.modules.set('guide-reviews', module);
  const result = await readJson(await h.post('/api/guide/reviews/batch', input, h.token, 'batch-persistence-retry'));
  assert.equal(result.count, 3);
  assert.equal(result.publishedCount, 3);
  const before = h.store.read();
  assert.throws(() => h.store.transact(state => { state.modules['guide-reviews'].records[0].revisionId = h.drafts[1].revisionId; }), { code: 'GUIDE_REVIEW_STATE' });
  assert.throws(() => h.store.transact(state => { state.modules['guide-reviews'].records.pop(); }), { code: 'GUIDE_REVIEW_STATE' });
  assert.deepEqual(h.store.read(), before);
});

test('reapproving current human-confirmed content appends a new revision and keeps the original AI provenance', async t => {
  const h = await setup(t);
  const original = h.drafts[0];
  const first = await readJson(await h.post('/api/guide/reviews/batch', batch([item(original)]), h.token));
  const current = (await readJson(await h.get('/api/guide/review-articles', h.token))).articles.find(row => row.entityId === original.entityId);
  assert.equal(current.origin, 'human');
  assert.equal(current.latestReview.id, first.records[0].reviewId);
  const before = h.store.read().modules.content;
  const second = await readJson(await h.post('/api/guide/reviews/batch', batch([item(current)]), h.token));
  assert.equal(second.publishedCount, 1);
  assert.notEqual(second.records[0].publishedRevisionId, first.records[0].publishedRevisionId);
  const content = h.store.read().modules.content;
  const confirmed = content.revisions.find(row => row.id === second.records[0].publishedRevisionId);
  assert.equal(confirmed.parentRevisionId, current.revisionId);
  assert.equal(confirmed.number, current.revisionNumber + 1);
  assert.equal(confirmed.data.reviewedFromRevisionId, current.revisionId);
  assert.equal(confirmed.data.originalOrigin, 'ai_draft');
  assert.deepEqual(content.revisions.slice(0, before.revisions.length), before.revisions);
  const refreshed = (await readJson(await h.get('/api/guide/review-articles', h.token))).articles.find(row => row.entityId === original.entityId);
  assert.equal(refreshed.reviewStatus, 'approved');
  assert.equal(refreshed.latestReview.id, second.records[0].reviewId);
});

test('approval preserves updated evidence limitations and repeated confirmations do not grow generated notes', async t => {
  const h = await setup(t);
  const original = h.drafts[0];
  const originalNote = h.bundle.revisions.find(row => row.id === original.revisionId).data.evidenceNote ?? '';
  const first = await readJson(await h.post('/api/guide/reviews/batch', batch([item(original)]), h.token));
  const updatedNote = '新增来源限制：该资料只适用于太仓校区，其他校区仍须单独核实。';
  const updated = addRevision(h, first.records[0].publishedRevisionId, 'Synthetic revised article with a new source limitation', { evidenceNote: updatedNote });
  const pending = (await readJson(await h.get('/api/guide/review-articles', h.token))).articles.find(row => row.entityId === original.entityId);
  assert.equal(pending.evidenceNote, updatedNote);
  assert.equal(pending.reviewStatus, 'pending');
  const second = await readJson(await h.post('/api/guide/reviews/batch', batch([item(pending)]), h.token));
  const confirmed = h.store.read().modules.content.revisions.find(row => row.id === second.records[0].publishedRevisionId);
  assert.equal(confirmed.data.reviewedFromRevisionId, updated.id);
  assert.ok(confirmed.data.evidenceNote.includes(updatedNote), 'publication must preserve the current limitation the reviewer actually saw');
  assert.equal(confirmed.data.originalEvidenceNote, originalNote, 'the root evidence note remains available separately');
  for (let count = 0; count < 2; count++) {
    const current = (await readJson(await h.get('/api/guide/review-articles', h.token))).articles.find(row => row.entityId === original.entityId);
    const result = await readJson(await h.post('/api/guide/reviews/batch', batch([item(current)]), h.token));
    const next = h.store.read().modules.content.revisions.find(row => row.id === result.records[0].publishedRevisionId);
    assert.equal(next.data.evidenceNote, confirmed.data.evidenceNote, 'unchanged reapproval must not recursively add provenance prefixes or notes');
    assert.equal(next.data.originalEvidenceNote, originalNote);
  }
});

test('legacy saved approvals remain unpublished until the reviewer explicitly submits the new publish mode', async t => {
  const h = await setup(t);
  const original = h.drafts[0];
  const legacyReviewId = 'synthetic-legacy-approval';
  h.store.transact(state => {
    state.modules['guide-reviews'].records.push({
      id: legacyReviewId, actorId: 'integration-operator', action: 'content.review',
      entityId: original.entityId, revisionId: original.revisionId, version: original.version, createdAt: h.time(),
      payload: encryptPrivatePayload(legacyReviewId, {
        reason: reviewReason, outcome: { decision: 'approved', batchId: 'synthetic-legacy-batch' },
      }, keyring),
    });
  });
  const beforeContent = h.store.read().modules.content;
  const reviewed = (await readJson(await h.get('/api/guide/review-articles', h.token))).articles.find(row => row.entityId === original.entityId);
  assert.equal(reviewed.reviewStatus, 'approved');
  assert.equal(reviewed.publicRevisionId, null);
  assert.equal(reviewed.latestReview.id, legacyReviewId);
  assert.deepEqual(h.store.read().modules.content, beforeContent);
  const outdatedClient = await rejectUnchanged(h, { items: [item(reviewed)] });
  assert.equal(outdatedClient.code, 'GUIDE_REVIEW_MODE');
  const result = await readJson(await h.post('/api/guide/reviews/batch', batch([item(reviewed)]), h.token));
  assert.equal(result.publishedCount, 1);
  assert.ok(result.records[0].publishedRevisionId);
});

test('high-impact approval is still rejected and rolls back an earlier approved item', async t => {
  const h = await setup(t, { mutateBundle(bundle) {
    bundle.revisions.find(row => row.data.origin === 'ai_draft').data.impact = 'high';
  } });
  const blocked = h.drafts.find(row => row.impact === 'high');
  const allowed = h.drafts.find(row => row.impact === 'low');
  const rejected = await rejectUnchanged(h, batch([item(allowed), item(blocked)]), 422);
  assert.equal(rejected.code, 'POLICY_REJECTED');
  const recorded = await readJson(await h.post('/api/guide/reviews/batch', batch([item(blocked, { decision: 'needs-verification' })]), h.token));
  assert.equal(recorded.publishedCount, 0);
  assert.equal(recorded.records[0].publishedRevisionId, null);
});

test('hidden articles cannot be published by approval, while their review feedback remains available', async t => {
  const h = await setup(t);
  const original = h.drafts[0];
  await readJson(await h.post('/api/content/hide', {
    entityId: original.entityId, expectedVersion: original.version, hidden: true, reason: reviewReason,
  }, h.token));
  const hidden = (await readJson(await h.get('/api/guide/review-articles', h.token))).articles.find(row => row.entityId === original.entityId);
  assert.equal(hidden.hidden, true);
  await rejectUnchanged(h, batch([item(h.drafts[1]), item(hidden)]), 422);
  const result = await readJson(await h.post('/api/guide/reviews/batch', batch([item(hidden, { decision: 'changes-requested' })]), h.token));
  assert.equal(result.publishedCount, 0);
  const entity = h.store.read().modules.content.entities.find(row => row.id === hidden.entityId);
  assert.equal(entity.hidden, true);
  assert.equal(entity.publicRevisionId, null);
});

test('unavailable cited sources reject the entire publish batch, including the earlier valid confirmation', async t => {
  for (const disposition of ['hidden', 'withdrawn', 'rights-expired']) {
    await t.test(disposition, async t => {
      const h = await setup(t);
      const blocked = h.drafts[0];
      const sourceId = blocked.sentences.flatMap(row => row.citations)[0].sourceId;
      const allowed = h.drafts.find(row => row.entityId !== blocked.entityId && row.sentences.every(sentence => sentence.citations.every(citation => citation.sourceId !== sourceId)));
      assert.ok(allowed, 'the first row must not cite the blocked source so that rollback is exercised after a valid publication');
      const source = h.store.read().modules.content.entities.find(row => row.id === sourceId);
      await readJson(await h.post(`/api/content/${disposition === 'hidden' ? 'hide' : 'source'}`, {
        entityId: sourceId, expectedVersion: source.version, reason: reviewReason,
        ...(disposition === 'hidden' ? { hidden: true } : { disposition }),
      }, h.token));
      const result = await rejectUnchanged(h, batch([item(allowed), item(blocked)]), 422);
      assert.equal(result.code, 'SOURCE_UNAVAILABLE');
    });
  }
});

test('a full review batch accepts bounded Chinese reasons larger than the legacy small command body limit', async t => {
  const h = await setup(t);
  const input = { mode: 'review-and-publish', items: h.articles.map(article => item(article, { reason: '核'.repeat(400) })) };
  assert.ok(Buffer.byteLength(JSON.stringify(input)) > 32768);
  const result = await readJson(await h.post('/api/guide/reviews/batch', input, h.token));
  assert.equal(result.count, input.items.length);
  assert.equal(result.publishedCount, input.items.length);
  assert.equal(h.store.read().modules['guide-reviews'].records.length, input.items.length);
});
