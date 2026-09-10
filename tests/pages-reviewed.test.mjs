import assert from 'node:assert/strict';
import test from 'node:test';
import { lstat, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { encryptPrivatePayload, importContent } from '@information-community/runtime';
import { createReviewedPagesData, pagesContentHash, validateReviewedPagesData } from '../scripts/pages-snapshot.mjs';
import { buildPages } from '../scripts/build-pages.mjs';
import { exportPagesSnapshot } from '../scripts/export-pages.mjs';
import { harness, keyring, loadDemoPagesConfig, readJson } from './helpers.mjs';

const community = new URL('../community/', import.meta.url);
const privateReason = '已逐项核对文章来源与适用范围，此为仅供后台保留的审核意见。';
const readCommunity = async name => JSON.parse(await readFile(new URL(name, community), 'utf8'));

async function setup(t, options = {}) {
  const h = await harness(t, { guide: true, ...options });
  h.store.transact(state => { state.modules.content = importContent(state.modules.content, h.bundle); });
  const { token } = await h.operator(['content_reviewer']);
  const config = await loadDemoPagesConfig();
  delete config.collectedRevisionIds;
  const articles = async () => (await readJson(await h.get('/api/guide/review-articles', token))).articles;
  const review = async (article, decision = 'approved') => readJson(await h.post('/api/guide/reviews/batch', {
    mode: 'review-and-publish', items: [{
      entityId: article.entityId, revisionId: article.revisionId,
      expectedVersion: article.version, expectedReviewId: article.latestReview?.id ?? null,
      decision, reason: privateReason,
    }],
  }, token));
  const snapshot = (overrides = {}) => createReviewedPagesData({
    state: h.store.read(), catalog: h.catalog, config, keyring,
    now: new Date(h.time()).toISOString(), ...overrides,
  });
  return { ...h, token, config, articles, review, snapshot };
}

test('reviewed Pages includes only current approved public articles and allowlisted published demos', async t => {
  const h = await setup(t, { mutateBundle(bundle) {
    bundle.revisions.find(row => row.data.origin === 'ai_draft').data.internalNotes = 'PRIVATE_ARTICLE_METADATA_SENTINEL';
  } });
  h.catalog.topics[0].privateNotes = 'PRIVATE_CATALOG_METADATA_SENTINEL';
  assert.equal(h.snapshot().answers.length, 0, 'imported drafts and unpublished legacy demo cards must not be auto-published');
  h.publish();
  const drafts = (await h.articles()).filter(row => row.origin === 'ai_draft');
  const approved = await h.review(drafts[0]);
  await h.review(drafts[1], 'needs-verification');
  const data = h.snapshot();
  assert.equal(data.mode, 'public-reviewed');
  assert.equal(data.answers.length, 5);
  assert.match(data.contentHash, /^[a-f0-9]{64}$/u);
  const answer = data.answers.find(row => row.id === drafts[0].entityId);
  assert.ok(answer);
  assert.equal(answer.demo, false);
  assert.equal(answer.origin, 'human');
  assert.equal(answer.originalOrigin, 'ai_draft');
  assert.equal(answer.reviewStatus, 'approved');
  assert.equal(answer.revisionId, approved.records[0].publishedRevisionId);
  assert.deepEqual(answer.history, [{ id: answer.revisionId, number: answer.revisionNumber, title: answer.title }]);
  assert.equal(data.answers.some(row => row.id === drafts[1].entityId), false);
  assert.equal(data.answers.flatMap(row => row.citations).find(row => row.sourceRevisionId === 'artifact-revision-method').url, data.site.publicUrl + '#/about');
  assert.deepEqual(validateReviewedPagesData(data, { config: h.config, now: data.generatedAt }), data);
  const serialized = JSON.stringify(data);
  for (const secret of [privateReason, 'PRIVATE_ARTICLE_METADATA_SENTINEL', 'PRIVATE_CATALOG_METADATA_SENTINEL',
    'integration-operator', 'passwordHash', 'reviewOwnerId', 'originalEvidenceNote', 'payload', 'ciphertext', 'keyring', 'localhost']) {
    assert.equal(serialized.includes(secret), false, `private material must never reach the public snapshot: ${secret}`);
  }
  assert.equal(serialized.includes(drafts[0].revisionId), false, 'unpublished AI parent IDs are not public history');
});

test('republishing changes the current-only snapshot and stable content hashes ignore export time and private audit changes', async t => {
  const h = await setup(t);
  const original = (await h.articles()).find(row => row.origin === 'ai_draft');
  await h.review(original);
  const first = h.snapshot();
  await h.articles();
  const same = h.snapshot({ now: new Date(h.time() + 1000).toISOString() });
  assert.notEqual(same.generatedAt, first.generatedAt);
  assert.equal(same.contentHash, first.contentHash);
  const current = (await h.articles()).find(row => row.entityId === original.entityId);
  await h.review(current);
  const second = h.snapshot();
  assert.equal(second.answers.length, 1);
  assert.notEqual(second.contentHash, first.contentHash);
  assert.notEqual(second.answers[0].revisionId, first.answers[0].revisionId);
  assert.equal(second.answers[0].history.length, 1);
  assert.equal(second.answers[0].history[0].id, second.answers[0].revisionId);
});

test('reviewing every article keeps the four examples marked as demo after their confirmation revisions change', async t => {
  const h = await setup(t);
  const articles = await h.articles();
  const result = await readJson(await h.post('/api/guide/reviews/batch', {
    mode: 'review-and-publish', items: articles.map(article => ({
      entityId: article.entityId, revisionId: article.revisionId,
      expectedVersion: article.version, expectedReviewId: article.latestReview?.id ?? null,
      decision: 'approved', reason: privateReason,
    })),
  }, h.token));
  assert.equal(result.publishedCount, articles.length);
  const data = h.snapshot();
  assert.equal(data.answers.length, articles.length);
  assert.equal(data.answers.filter(row => row.demo).length, articles.filter(row => row.demo).length);
  assert.ok(data.answers.every(row => row.reviewStatus === 'approved'));
  for (const article of articles.filter(row => row.demo)) {
    const answer = data.answers.find(row => row.id === article.entityId);
    assert.equal(answer.demo, true, 'human approval must not relabel a demonstration as real handbook guidance');
    assert.equal(h.config.publishedRevisionIds.includes(answer.revisionId), false);
  }
});

test('hidden articles and withdrawn cited sources are removed on resync with no demo fallback', async t => {
  for (const removal of ['article-hidden', 'source-withdrawn']) {
    await t.test(removal, async t => {
      const h = await setup(t);
      const original = (await h.articles()).find(row => row.origin === 'ai_draft');
      await h.review(original);
      assert.equal(h.snapshot().answers.length, 1);
      const current = (await h.articles()).find(row => row.entityId === original.entityId);
      if (removal === 'article-hidden') {
        await readJson(await h.post('/api/content/hide', {
          entityId: current.entityId, expectedVersion: current.version, hidden: true, reason: privateReason,
        }, h.token));
      } else {
        const sourceId = current.sentences.flatMap(row => row.citations)[0].sourceId;
        const source = h.store.read().modules.content.entities.find(row => row.id === sourceId);
        await readJson(await h.post('/api/content/source', {
          entityId: source.id, expectedVersion: source.version, disposition: 'withdrawn', reason: privateReason,
        }, h.token));
      }
      const removed = h.snapshot();
      assert.deepEqual(removed.answers, []);
      assert.equal(removed.mode, 'public-reviewed');
      assert.deepEqual(validateReviewedPagesData(removed, { config: h.config, now: removed.generatedAt }).answers, []);
    });
  }
});

test('a non-demo public pointer without a matching human review cannot be exported', async t => {
  const h = await setup(t, { mutateBundle(bundle) {
    bundle.revisions.find(row => row.data.demo === true && row.data.origin === 'human').data.demo = false;
  } });
  const article = (await h.articles()).find(row => row.demo === false && row.origin === 'human');
  await readJson(await h.post('/api/content/publish', {
    entityId: article.entityId, revisionId: article.revisionId, expectedVersion: article.version, reason: privateReason,
  }, h.token));
  assert.throws(() => h.snapshot(), /review|approval|审核|确认/iu);
});

test('review evidence must bind the same actor, verification time and published revision', async t => {
  const h = await setup(t);
  const original = (await h.articles()).find(row => row.origin === 'ai_draft');
  const result = await h.review(original);
  for (const mutate of [
    (state, revision) => { revision.data.reviewOwnerId = 'synthetic-other-reviewer'; },
    (state, revision) => { revision.data.verifiedAt = '2000-01-01T00:00:00.000Z'; },
    (state, revision) => { revision.data.origin = 'ai_draft'; },
    (state, revision) => {
      const record = state.modules['guide-reviews'].records.find(row => row.action === 'content.review');
      record.payload = encryptPrivatePayload(record.id, { reason: privateReason, outcome: {
        decision: 'approved', batchId: result.batchId, publishedRevisionId: original.revisionId,
      } }, keyring);
    },
  ]) {
    const state = h.store.read();
    const revision = state.modules.content.revisions.find(row => row.id === result.records[0].publishedRevisionId);
    mutate(state, revision);
    if (revision.data.origin === 'ai_draft') assert.equal(h.snapshot({ state }).answers.length, 0, 'the SDK hides an AI revision even if a public pointer remains');
    else assert.throws(() => h.snapshot({ state }), /review|approval|审核|确认/iu);
  }
});

test('time-limited and unsafe public source URLs cannot enter a permanent Pages snapshot', async t => {
  const h = await setup(t);
  const original = (await h.articles()).find(row => row.origin === 'ai_draft');
  await h.review(original);
  const sourceRevisionId = original.sentences.flatMap(row => row.citations)[0].sourceRevisionId;
  let state = h.store.read();
  state.modules.content.revisions.find(row => row.id === sourceRevisionId).data.rights = { expiresAt: '2099-01-01T00:00:00Z' };
  assert.throws(() => h.snapshot({ state }), /time-limited|rights|限时|期限|到期/iu);
  for (const url of ['http://example.org/source', 'https://localhost/source', 'https://127.0.0.1/source', 'https://user:password@example.org/source']) {
    state = h.store.read();
    state.modules.content.revisions.find(row => row.id === sourceRevisionId).data.url = url;
    assert.throws(() => h.snapshot({ state }), /HTTPS|local|credential|URL|地址/iu);
  }
});

test('validator rejects runtime backups and a modified snapshot hash', async t => {
  const h = await setup(t);
  const original = (await h.articles()).find(row => row.origin === 'ai_draft');
  await h.review(original);
  assert.throws(() => validateReviewedPagesData(h.store.read(), { config: h.config }), /snapshot|DTO|reviewed|快照|字段/iu);
  const modified = h.snapshot();
  modified.answers[0].title = 'Synthetic unreviewed modification';
  assert.throws(() => validateReviewedPagesData(modified, { config: h.config, now: modified.generatedAt }), /hash|散列|摘要|校验/iu);
});

test('recomputed hashes do not admit private fields, unreviewed content or broken public evidence', async t => {
  const h = await setup(t);
  await h.review((await h.articles()).find(row => row.origin === 'ai_draft'));
  const original = h.snapshot();
  for (const mutate of [
    value => { value.modules = { auth: { passwordHash: 'PRIVATE_SENTINEL' } }; },
    value => { value.site.credentials = 'PRIVATE_SENTINEL'; },
    value => { value.catalog.topics[0].internalNotes = 'PRIVATE_SENTINEL'; },
    value => { value.answers[0].reviewOwnerId = 'PRIVATE_SENTINEL'; },
    value => { value.answers[0].originalEvidenceNote = 'PRIVATE_SENTINEL'; },
    value => { value.answers[0].sentences[0].internalNotes = 'PRIVATE_SENTINEL'; },
    value => { value.answers[0].citations[0].payload = 'PRIVATE_SENTINEL'; },
    value => { value.answers[0].history[0].private = 'PRIVATE_SENTINEL'; },
    value => { value.answers[0].origin = 'ai_draft'; },
    value => { value.answers[0].reviewStatus = 'pending'; },
    value => { value.answers[0].demo = true; value.answers[0].reviewStatus = 'demo'; },
    value => { value.answers[0].verifiedAt = ''; },
    value => { value.answers[0].revisionNumber = 1.5; },
    value => { value.answers[0].citations = []; },
    value => { value.answers[0].citations[0].sentenceId = 'missing-sentence'; },
    value => { value.answers[0].citations[0].url = 'http://127.0.0.1/private'; },
    value => { value.answers[0].citations[0].url = 'http://localhost:4317/about#method'; },
    value => { value.answers[0].history.push({ id: 'unpublished-parent', number: 1, title: 'Private parent' }); },
  ]) {
    const changed = structuredClone(original);
    mutate(changed);
    changed.contentHash = pagesContentHash(changed);
    assert.throws(() => validateReviewedPagesData(changed, { config: h.config, now: changed.generatedAt }));
  }
});

async function buildFixture(t, snapshot) {
  const root = await mkdtemp(resolve(tmpdir(), 'guide-pages-reviewed-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = resolve(root, 'community');
  await mkdir(resolve(directory, 'pages-ui'), { recursive: true });
  for (const name of ['pages.config.json', 'content-profile.json', 'content.json', 'catalog.json']) {
    await writeFile(resolve(directory, name), await readFile(new URL(name, community)));
  }
  for (const [name, contents] of Object.entries({
    'index.html': '<script type="module" src="./app.js"></script>', 'app.js': 'fetch("./public.json")', 'contributions.js': 'export const contributionTypes = {};',
    'style.css': 'body { color: black; }', 'brand.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
  })) await writeFile(resolve(directory, 'pages-ui', name), contents);
  await writeFile(resolve(directory, 'pages-reviewed.json'), JSON.stringify(snapshot));
  await mkdir(resolve(directory, '.runtime'));
  await writeFile(resolve(directory, '.runtime', 'community.sqlite'), 'PRIVATE_RUNTIME_DATABASE_SENTINEL');
  await writeFile(resolve(directory, 'reviewer-login.private.json'), 'PRIVATE_REVIEWER_LOGIN_SENTINEL');
  return { root, directory };
}

test('Pages build prefers the reviewed snapshot and emits no private runtime or account files', async t => {
  const h = await setup(t);
  await h.review((await h.articles()).find(row => row.origin === 'ai_draft'));
  const snapshot = h.snapshot();
  const { root, directory } = await buildFixture(t, snapshot);
  await writeFile(resolve(directory, 'content.json'), '{ invalid unpublished seed content must not affect a reviewed build');
  const result = await buildPages({ root, now: snapshot.generatedAt });
  assert.equal(result.answerCount, 1, 'the four legacy demo fixtures must not be merged into a reviewed snapshot');
  const emitted = JSON.parse(await readFile(resolve(result.output, 'public.json'), 'utf8'));
  assert.equal(emitted.mode, 'public-reviewed');
  assert.deepEqual(emitted.answers, snapshot.answers);
  assert.equal(emitted.contentHash, snapshot.contentHash);
  assert.deepEqual((await readdir(result.output)).sort(), ['.nojekyll', 'app.js', 'brand.svg', 'contributions.js', 'index.html', 'public.json', 'style.css']);
  const serialized = JSON.stringify(emitted);
  assert.equal(serialized.includes('PRIVATE_RUNTIME_DATABASE_SENTINEL'), false);
  assert.equal(serialized.includes('PRIVATE_REVIEWER_LOGIN_SENTINEL'), false);
  await writeFile(resolve(directory, 'pages-reviewed.json'), '{corrupted reviewed snapshot');
  await assert.rejects(buildPages({ root, now: snapshot.generatedAt }), /JSON|snapshot|快照|Unexpected/iu);
  assert.deepEqual(JSON.parse(await readFile(resolve(result.output, 'public.json'), 'utf8')), emitted, 'a corrupt input cannot overwrite the last built snapshot with demo fallback');
});

test('an explicitly empty reviewed snapshot removes old output instead of reverting to demo content', async t => {
  const h = await setup(t);
  const original = (await h.articles()).find(row => row.origin === 'ai_draft');
  await h.review(original);
  const before = h.snapshot();
  const { root, directory } = await buildFixture(t, before);
  const result = await buildPages({ root, now: before.generatedAt });
  const current = (await h.articles()).find(row => row.entityId === original.entityId);
  await readJson(await h.post('/api/content/hide', {
    entityId: current.entityId, expectedVersion: current.version, hidden: true, reason: privateReason,
  }, h.token));
  const empty = h.snapshot();
  await writeFile(resolve(directory, 'pages-reviewed.json'), JSON.stringify(empty));
  const after = await buildPages({ root, now: empty.generatedAt });
  assert.equal(after.answerCount, 0);
  const output = JSON.parse(await readFile(resolve(result.output, 'public.json'), 'utf8'));
  assert.equal(output.mode, 'public-reviewed');
  assert.deepEqual(output.answers, []);
});

async function exportFixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), 'guide-pages-export-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = resolve(root, 'community');
  await mkdir(directory);
  for (const name of ['runtime.config.json', 'business.json', 'content-profile.json', 'lifecycle.json',
    'catalog.json', 'pages.config.json', 'review-records.mjs', 'content.json']) {
    await writeFile(resolve(directory, name), await readFile(new URL(name, community)));
  }
  const runtimeConfig = await readCommunity('runtime.config.json');
  await writeFile(resolve(directory, 'runtime.demo.json'), JSON.stringify({ ...runtimeConfig, dataDirectory: '.demo-runtime' }));
  const pagesConfig = await loadDemoPagesConfig();
  delete pagesConfig.collectedRevisionIds;
  await writeFile(resolve(directory, 'pages.config.json'), JSON.stringify(pagesConfig));
  const serializableKeyring = {
    activeVersion: keyring.activeVersion,
    keys: Object.fromEntries(Object.entries(keyring.keys).map(([version, key]) => [version, key.toString('hex')])),
  };
  await writeFile(resolve(directory, '.dev-secrets.json'), JSON.stringify({ keyring: serializableKeyring, privateNote: 'PRIVATE_EXPORT_CREDENTIAL_SENTINEL' }));
  return { root, directory, serializableKeyring };
}

test('export refuses a missing selected database without seeding or falling back to another runtime', async t => {
  const h = await setup(t);
  const { root, directory, serializableKeyring } = await exportFixture(t);
  const now = new Date(h.time()).toISOString();
  await assert.rejects(exportPagesSnapshot({ root, demo: true, now }), { code: 'ENOENT' });
  await assert.rejects(lstat(resolve(directory, '.demo-runtime')), { code: 'ENOENT' });
  await assert.rejects(lstat(resolve(directory, 'pages-reviewed.json')), { code: 'ENOENT' });
  await mkdir(resolve(directory, '.demo-runtime'));
  await backup(h.store.db, resolve(directory, '.demo-runtime', 'community.sqlite'));
  const databasePath = resolve(directory, '.demo-runtime', 'community.sqlite');
  const databaseBytes = await readFile(databasePath);
  await assert.rejects(exportPagesSnapshot({ root, demo: false, now, env: { RUNTIME_KEYRING: JSON.stringify(serializableKeyring) } }), { code: 'ENOENT' });
  await assert.rejects(lstat(resolve(directory, '.runtime')), { code: 'ENOENT' });
  await assert.rejects(lstat(resolve(directory, 'pages-reviewed.json')), { code: 'ENOENT' });
  assert.deepEqual(await readFile(databasePath), databaseBytes);
});

test('export reads a real private runtime database, preserves no-op bytes and refuses to overwrite a corrupt snapshot', async t => {
  const h = await setup(t);
  const drafts = (await h.articles()).filter(row => row.origin === 'ai_draft');
  await h.review(drafts[0]);
  await h.review(drafts[1], 'needs-verification');
  const { root, directory } = await exportFixture(t);
  await mkdir(resolve(directory, '.demo-runtime'));
  await backup(h.store.db, resolve(directory, '.demo-runtime', 'community.sqlite'));
  const databasePath = resolve(directory, '.demo-runtime', 'community.sqlite');
  const databaseBytes = await readFile(databasePath);
  const now = new Date(h.time()).toISOString();
  const first = await exportPagesSnapshot({ root, demo: true, now });
  assert.equal(first.changed, true);
  assert.equal(first.answerCount, 1);
  assert.equal(first.reviewedCount, 1);
  const bytes = await readFile(first.snapshotPath);
  const data = JSON.parse(bytes.toString('utf8'));
  assert.deepEqual(data.answers, h.snapshot().answers);
  for (const secret of [privateReason, 'passwordHash', 'ciphertext', 'PRIVATE_EXPORT_CREDENTIAL_SENTINEL',
    'keyring', 'reviewOwnerId', 'integration-operator', drafts[1].title]) assert.equal(bytes.toString('utf8').includes(secret), false);
  const same = await exportPagesSnapshot({ root, demo: true, now: new Date(h.time() + 60_000).toISOString() });
  assert.equal(same.changed, false);
  assert.equal(same.contentHash, first.contentHash);
  assert.deepEqual(await readFile(first.snapshotPath), bytes, 'no public changes must retain exact snapshot bytes including the original generatedAt');
  const corrupt = '{ synthetic corrupt reviewed snapshot';
  await writeFile(first.snapshotPath, corrupt);
  await assert.rejects(exportPagesSnapshot({ root, demo: true, now }), /JSON|snapshot|Unexpected/iu);
  assert.equal(await readFile(first.snapshotPath, 'utf8'), corrupt);
  assert.equal((await readdir(directory)).some(name => /^\.pages-reviewed-.*\.tmp$/u.test(name)), false, 'failed export leaves no temporary publish artifacts');
  assert.deepEqual(await readFile(databasePath), databaseBytes, 'export must never write or migrate the source runtime database');
});

test('removing demonstration authorizations replaces old exports and never restores examples from retained runtime data', async t => {
  for (const publication of ['legacy-demo', 'human-reviewed-demo']) {
    await t.test(publication, async t => {
      const h = await setup(t);
      if (publication === 'legacy-demo') h.publish();
      else for (const article of (await h.articles()).filter(article => article.demo)) await h.review(article);
      const productionConfig = await readCommunity('pages.config.json');
      assert.deepEqual(productionConfig.publishedRevisionIds, []);
      assert.deepEqual(productionConfig.sourceRevisionIds, []);
      const { root, directory } = await exportFixture(t);
      await mkdir(resolve(directory, '.demo-runtime'));
      const databasePath = resolve(directory, '.demo-runtime', 'community.sqlite');
      await backup(h.store.db, databasePath);
      const databaseBytes = await readFile(databasePath);
      const configPath = resolve(directory, 'pages.config.json');
      const oldConfig = { ...productionConfig, publishedRevisionIds: h.config.publishedRevisionIds, sourceRevisionIds: h.config.sourceRevisionIds };
      await writeFile(configPath, JSON.stringify(oldConfig));
      const now = new Date(h.time()).toISOString();
      const first = await exportPagesSnapshot({ root, demo: true, now });
      const previous = JSON.parse(await readFile(first.snapshotPath, 'utf8'));
      assert.equal(previous.answers.length, 80);
      assert.equal(previous.answers.filter(answer => answer.demo).length, 4);
      const realAnswers = previous.answers.filter(answer => !answer.demo);
      await writeFile(configPath, JSON.stringify(productionConfig));
      assert.throws(() => validateReviewedPagesData(previous, { config: productionConfig }));
      const removed = await exportPagesSnapshot({ root, demo: true, now });
      assert.equal(removed.changed, true);
      assert.equal(removed.answerCount, 76);
      const current = JSON.parse(await readFile(removed.snapshotPath, 'utf8'));
      assert.deepEqual(current.answers, realAnswers, 'removing examples preserves every real article and citation');
      assert.equal(current.answers.some(answer => answer.demo), false);
      assert.deepEqual(validateReviewedPagesData(current, { config: productionConfig }), current);
      const currentBytes = await readFile(removed.snapshotPath);
      assert.equal((await exportPagesSnapshot({ root, demo: true, now })).changed, false);
      assert.deepEqual(await readFile(removed.snapshotPath), currentBytes);
      assert.deepEqual(await readFile(databasePath), databaseBytes, 'legacy runtime records remain private and unmodified');
    });
  }
});

test('export replaces an old contribution destination while keeping current configuration and prior snapshot validation strict', async t => {
  const h = await setup(t);
  await h.review((await h.articles()).find(row => row.origin === 'ai_draft'));
  const { root, directory } = await exportFixture(t);
  await mkdir(resolve(directory, '.demo-runtime'));
  await backup(h.store.db, resolve(directory, '.demo-runtime', 'community.sqlite'));
  const now = new Date(h.time()).toISOString();
  const oldConfig = { ...h.config, contributionsRepository: 'previous-owner/previous-feedback' };
  const newConfig = { ...h.config, contributionsRepository: 'current-owner/current-feedback' };
  const configPath = resolve(directory, 'pages.config.json');
  await writeFile(configPath, JSON.stringify(oldConfig));
  const first = await exportPagesSnapshot({ root, demo: true, now });
  const previous = JSON.parse(await readFile(first.snapshotPath, 'utf8'));
  assert.equal(previous.site.contributionsRepository, oldConfig.contributionsRepository);
  await writeFile(configPath, JSON.stringify(newConfig));
  assert.throws(() => validateReviewedPagesData(previous, { config: newConfig }));
  const replacement = await exportPagesSnapshot({ root, demo: true, now });
  assert.equal(replacement.changed, true);
  assert.notEqual(replacement.contentHash, first.contentHash);
  const current = JSON.parse(await readFile(replacement.snapshotPath, 'utf8'));
  assert.equal(current.site.contributionsRepository, newConfig.contributionsRepository);
  assert.deepEqual(current.answers, previous.answers);
  assert.deepEqual(validateReviewedPagesData(current, { config: newConfig }), current);
  assert.equal((await exportPagesSnapshot({ root, demo: true, now })).changed, false);
  for (const mutate of [
    value => { value.privateData = 'SYNTHETIC_PRIVATE_PREVIOUS_SNAPSHOT'; value.contentHash = pagesContentHash(value); },
    value => { value.answers[0].title = 'Synthetic hash mismatch'; },
    value => { value.site.publicUrl = 'https://different.example/guide/'; value.contentHash = pagesContentHash(value); },
  ]) {
    const invalidPrevious = structuredClone(previous);
    mutate(invalidPrevious);
    const bytes = JSON.stringify(invalidPrevious);
    await writeFile(first.snapshotPath, bytes);
    await assert.rejects(exportPagesSnapshot({ root, demo: true, now }));
    assert.equal(await readFile(first.snapshotPath, 'utf8'), bytes, 'a destination change must not excuse private fields, bad hashes or a different site identity');
  }
});

test('export rejects blank, incomplete or incompatible databases without modifying them or the existing public snapshot', async t => {
  const h = await setup(t);
  await h.review((await h.articles()).find(row => row.origin === 'ai_draft'));
  const sourceState = h.store.read();
  const snapshotBytes = Buffer.from(JSON.stringify(h.snapshot(), null, 2) + '\n');
  for (const issue of ['zero-byte-file', 'empty-state-table', 'missing-modules', 'outdated-module-schema', 'wrong-community', 'changed-profile', 'migration-incomplete']) {
    await t.test(issue, async t => {
      const { root, directory } = await exportFixture(t);
      await mkdir(resolve(directory, '.demo-runtime'));
      const databasePath = resolve(directory, '.demo-runtime', 'community.sqlite');
      if (issue === 'zero-byte-file') await writeFile(databasePath, Buffer.alloc(0));
      else {
        const database = new DatabaseSync(databasePath);
        try {
          database.exec('CREATE TABLE runtime_state (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)');
          if (issue !== 'empty-state-table') {
            const state = structuredClone(sourceState);
            if (issue === 'missing-modules') { delete state.modules['guide-reviews']; delete state.moduleVersions['guide-reviews']; }
            if (issue === 'outdated-module-schema') state.moduleVersions.auth = 1;
            if (issue === 'wrong-community') state.communityId = 'synthetic-different-community';
            if (issue === 'changed-profile') state.modules.content.profile.warnings.reviewOverdue = 'Synthetic changed content policy';
            database.prepare('INSERT INTO runtime_state (id, value) VALUES (1, ?)').run(JSON.stringify(state));
          }
        } finally { database.close(); }
      }
      const databaseBytes = await readFile(databasePath);
      const snapshotPath = resolve(directory, 'pages-reviewed.json');
      await writeFile(snapshotPath, snapshotBytes);
      if (issue === 'migration-incomplete') await writeFile(resolve(directory, '.migration-incomplete'), 'Synthetic pending migration marker');
      await assert.rejects(exportPagesSnapshot({ root, demo: true, now: new Date(h.time()).toISOString() }));
      assert.deepEqual(await readFile(databasePath), databaseBytes, 'a rejected export must not initialize, migrate or repair the selected database');
      assert.deepEqual(await readFile(snapshotPath), snapshotBytes, 'an invalid database must not remove or replace the previously reviewed public snapshot');
      assert.equal((await readdir(directory)).some(name => /^\.pages-reviewed-.*\.tmp$/u.test(name)), false);
    });
  }
});
