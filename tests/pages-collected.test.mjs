import assert from 'node:assert/strict';
import test from 'node:test';
import { backup } from 'node:sqlite';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { importContent } from '@information-community/runtime';
import { createReviewedPagesData, pagesContentHash, validateReviewedPagesData } from '../scripts/pages-snapshot.mjs';
import { exportPagesSnapshot } from '../scripts/export-pages.mjs';
import { buildPages } from '../scripts/build-pages.mjs';
import { harness, keyring, readJson } from './helpers.mjs';

const community = new URL('../community/', import.meta.url);
const reason = '已核对本篇资料来源和适用范围，保存本次真实人工审核结论。';
const readCommunity = async name => JSON.parse(await readFile(new URL(name, community), 'utf8'));

async function setup(t, options = {}) {
  const h = await harness(t, { guide: true, ...options });
  h.store.transact(state => { state.modules.content = importContent(state.modules.content, h.bundle); });
  const { token } = await h.operator(['content_reviewer']);
  const config = { ...await readCommunity('pages.config.json'), collectedRevisionIds: [] };
  const articles = (await readJson(await h.get('/api/guide/review-articles', token))).articles;
  const drafts = articles.filter(row => row.origin === 'ai_draft');
  const snapshot = (ids = [], overrides = {}) => createReviewedPagesData({
    state: h.store.read(), catalog: h.catalog, config: { ...config, collectedRevisionIds: ids }, keyring,
    now: new Date(h.time()).toISOString(), ...overrides,
  });
  const approve = async article => readJson(await h.post('/api/guide/reviews/batch', {
    mode: 'review-and-publish', items: [{
      entityId: article.entityId, revisionId: article.revisionId, expectedVersion: article.version,
      expectedReviewId: article.latestReview?.id ?? null, decision: 'approved', reason,
    }],
  }, token));
  return { ...h, token, config, articles, drafts, snapshot, approve };
}

function appendDraft(h, article) {
  const content = h.store.read().modules.content;
  const original = content.revisions.find(row => row.id === article.revisionId);
  const revision = {
    ...structuredClone(original), id: `${original.id}-collected-next`, parentRevisionId: original.id,
    number: original.number + 1, data: { ...structuredClone(original.data), title: 'Synthetic future unapproved draft' },
  };
  const citations = content.citations.filter(row => row.revisionId === original.id).map(row => ({
    ...structuredClone(row), id: `${row.id}-collected-next`, revisionId: revision.id,
  }));
  h.store.transact(state => { state.modules.content = importContent(state.modules.content, {
    schemaVersion: 1, entities: [], revisions: [revision], citations, links: [],
  }); });
  return revision;
}

test('the explicitly selected research batch is public as unverified AI material without mutating the runtime or inventing reviews', async t => {
  const h = await setup(t, { mutateBundle(bundle) {
    bundle.revisions.find(row => row.data.origin === 'ai_draft').data.internalNotes = 'PRIVATE_COLLECTED_METADATA_SENTINEL';
  } });
  const coverage = await readCommunity('handbook/coverage.json');
  const release = await readCommunity('pages.config.json');
  assert.ok(coverage.cardCount > 0);
  assert.equal(h.drafts.length, coverage.cardCount);
  assert.deepEqual(new Set(release.collectedRevisionIds), new Set(coverage.cards.map(card => card.revisionId)));
  const before = h.store.read();
  assert.deepEqual(h.snapshot().answers, [], 'future or existing drafts are not public without explicit revision IDs');
  const ids = h.drafts.map(row => row.revisionId);
  const data = h.snapshot(ids);
  assert.equal(data.mode, 'public-guide');
  assert.equal(data.answers.length, ids.length);
  assert.deepEqual(new Set(data.answers.map(row => row.revisionId)), new Set(ids));
  for (const answer of data.answers) {
    const original = before.modules.content.revisions.find(row => row.id === answer.revisionId);
    assert.equal(answer.origin, 'ai_draft');
    assert.equal(answer.originalOrigin, 'ai_draft');
    assert.equal(answer.reviewStatus, 'collected');
    assert.equal(answer.demo, false);
    assert.equal(answer.verifiedAt, '');
    assert.equal(answer.researchedAt, original.data.researchedAt);
    assert.deepEqual(answer.sentences, original.data.sentences);
    assert.deepEqual(answer.history, [{ id: answer.revisionId, number: answer.revisionNumber, title: answer.title }]);
    for (const citation of answer.citations) {
      const originalCitation = before.modules.content.citations.find(row => row.id === citation.id);
      assert.equal(citation.sourceRevisionId, originalCitation.sourceRevisionId);
      assert.equal(citation.sourceEntityId, originalCitation.sourceEntityId);
      assert.deepEqual(citation.position, originalCitation.position);
    }
  }
  assert.deepEqual(validateReviewedPagesData(data, { config: { ...h.config, collectedRevisionIds: ids } }), data);
  assert.deepEqual(h.store.read(), before, 'this channel changes no source revision, publication pointer, policy, audit or private review');
  const text = JSON.stringify(data);
  for (const privateValue of ['PRIVATE_COLLECTED_METADATA_SENTINEL', 'passwordHash', 'ciphertext', 'reviewOwnerId', 'integration-operator', reason]) {
    assert.equal(text.includes(privateValue), false);
  }
});

test('only exact selected revisions enter the collected channel and a future draft does not fall back to its old revision', async t => {
  const h = await setup(t);
  const original = h.drafts[0];
  assert.deepEqual(h.snapshot([original.revisionId]).answers.map(row => row.id), [original.entityId]);
  const next = appendDraft(h, original);
  assert.deepEqual(h.snapshot([original.revisionId]).answers, [], 'stale authorization cannot publish an edited article or keep the old draft public');
  assert.deepEqual(h.snapshot([next.id]).answers.map(row => row.revisionId), [next.id]);
});

test('runtime hidden content and unavailable sources are omitted from collected material', async t => {
  for (const removal of ['article-hidden', 'source-hidden', 'source-withdrawn']) {
    await t.test(removal, async t => {
      const h = await setup(t);
      const original = h.drafts[0];
      const sourceId = original.sentences.flatMap(row => row.citations)[0].sourceId;
      const entity = h.store.read().modules.content.entities.find(row => row.id === (removal === 'article-hidden' ? original.entityId : sourceId));
      await readJson(await h.post(`/api/content/${removal === 'source-withdrawn' ? 'source' : 'hide'}`, {
        entityId: entity.id, expectedVersion: entity.version, reason,
        ...(removal === 'source-withdrawn' ? { disposition: 'withdrawn' } : { hidden: true }),
      }, h.token));
      const before = h.store.read();
      assert.deepEqual(h.snapshot([original.revisionId]).answers, []);
      assert.deepEqual(h.store.read(), before);
    });
  }
});

test('high-impact and time-limited-source rules remain in force for collected material', async t => {
  const high = await setup(t, { mutateBundle(bundle) {
    bundle.revisions.find(row => row.data.origin === 'ai_draft').data.impact = 'high';
  } });
  const blocked = high.drafts.find(row => row.impact === 'high');
  const beforeHigh = high.store.read();
  assert.throws(() => high.snapshot([blocked.revisionId]));
  assert.deepEqual(high.store.read(), beforeHigh);
  const h = await setup(t);
  const original = h.drafts[0];
  const state = h.store.read();
  const sourceId = original.sentences.flatMap(row => row.citations)[0].sourceRevisionId;
  state.modules.content.revisions.find(row => row.id === sourceId).data.rights = { expiresAt: '2099-01-01T00:00:00Z' };
  assert.throws(() => h.snapshot([original.revisionId], { state }), /time-limited|rights|期限/iu);
});

test('a real human-approved public revision takes precedence over its collected AI parent', async t => {
  const h = await setup(t);
  const original = h.drafts[0];
  const result = await h.approve(original);
  const before = h.store.read();
  const data = h.snapshot([original.revisionId]);
  assert.equal(data.answers.length, 1);
  assert.equal(data.answers[0].revisionId, result.records[0].publishedRevisionId);
  assert.equal(data.answers[0].origin, 'human');
  assert.equal(data.answers[0].reviewStatus, 'approved');
  assert.equal(data.answers[0].originalOrigin, 'ai_draft');
  assert.deepEqual(h.store.read(), before);
});

test('a later editorial request for changes removes the selected draft from collected material', async t => {
  const h = await setup(t);
  const original = h.drafts[0];
  assert.equal(h.snapshot([original.revisionId]).answers.length, 1);
  await readJson(await h.post('/api/guide/reviews/batch', {
    mode: 'review-and-publish', items: [{
      entityId: original.entityId, revisionId: original.revisionId, expectedVersion: original.version,
      expectedReviewId: null, decision: 'changes-requested', reason,
    }],
  }, h.token));
  const before = h.store.read();
  assert.deepEqual(h.snapshot([original.revisionId]).answers, []);
  assert.deepEqual(h.store.read(), before);
});

test('collected snapshot validation requires explicit IDs and rejects private fields, fabricated verification and hash changes', async t => {
  const h = await setup(t);
  const ids = [h.drafts[0].revisionId];
  const original = h.snapshot(ids);
  assert.throws(() => validateReviewedPagesData(original, { config: h.config }));
  const config = { ...h.config, collectedRevisionIds: ids };
  for (const mutate of [
    value => { value.answers[0].privateNotes = 'PRIVATE_COLLECTED_FIELD'; },
    value => { value.answers[0].origin = 'human'; },
    value => { value.answers[0].verifiedAt = value.generatedAt; },
    value => { value.answers[0].reviewStatus = 'approved'; },
    value => { value.answers[0].citations = []; },
  ]) {
    const value = structuredClone(original);
    mutate(value);
    value.contentHash = pagesContentHash(value);
    assert.throws(() => validateReviewedPagesData(value, { config }));
  }
  const modified = structuredClone(original);
  modified.answers[0].title = 'Synthetic hash mismatch';
  assert.throws(() => validateReviewedPagesData(modified, { config }), /hash/iu);
});

test('removing a collected authorization replaces an existing exported snapshot instead of preserving the old article', async t => {
  const h = await setup(t);
  const root = await mkdtemp(resolve(tmpdir(), 'guide-pages-collected-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = resolve(root, 'community');
  await mkdir(resolve(directory, '.demo-runtime'), { recursive: true });
  for (const name of ['runtime.config.json', 'business.json', 'content-profile.json', 'lifecycle.json', 'catalog.json', 'review-records.mjs']) {
    await writeFile(resolve(directory, name), await readFile(new URL(name, community)));
  }
  await writeFile(resolve(directory, 'runtime.demo.json'), JSON.stringify({ ...await readCommunity('runtime.config.json'), dataDirectory: '.demo-runtime' }));
  await writeFile(resolve(directory, '.dev-secrets.json'), JSON.stringify({ keyring: {
    activeVersion: keyring.activeVersion, keys: Object.fromEntries(Object.entries(keyring.keys).map(([name, value]) => [name, value.toString('hex')])),
  } }));
  await backup(h.store.db, resolve(directory, '.demo-runtime', 'community.sqlite'));
  const selected = { ...h.config, collectedRevisionIds: [h.drafts[0].revisionId] };
  const configPath = resolve(directory, 'pages.config.json');
  await writeFile(configPath, JSON.stringify(selected));
  const now = new Date(h.time()).toISOString();
  await assert.rejects(buildPages({ root, now }), /explicit collection requires an exported public snapshot/iu);
  const first = await exportPagesSnapshot({ root, now });
  assert.equal(first.answerCount, 1);
  assert.equal(first.collectedCount, 1);
  assert.equal(first.reviewedCount, 0);
  const previous = JSON.parse(await readFile(first.snapshotPath, 'utf8'));
  await writeFile(configPath, JSON.stringify(h.config));
  assert.throws(() => validateReviewedPagesData(previous, { config: h.config }));
  const removed = await exportPagesSnapshot({ root, now });
  assert.equal(removed.changed, true);
  assert.equal(removed.answerCount, 0);
  assert.equal(removed.collectedCount, 0);
  const next = JSON.parse(await readFile(first.snapshotPath, 'utf8'));
  assert.deepEqual(next.answers, []);
  assert.deepEqual(validateReviewedPagesData(next, { config: h.config }), next);
});
