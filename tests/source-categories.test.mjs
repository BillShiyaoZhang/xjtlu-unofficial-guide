import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { contentModule, importContent } from '@information-community/runtime';
import { classifySource, SOURCE_CATEGORIES, sourceCategories } from '../community/source-categories.mjs';
import { publicSourceMetadata } from '../community/source-registry.mjs';
import { createReviewedPagesData, pagesContentHash, validateReviewedPagesData } from '../scripts/pages-snapshot.mjs';
import { compileHandbook } from '../scripts/build-handbook.mjs';
import { harness, keyring, readJson } from './helpers.mjs';

test('source categories distinguish XJTLU, verified university accounts, contributors and other websites', () => {
  for (const url of ['https://xjtlu.edu.cn/', 'https://www.xjtlu.edu.cn/zh', 'https://lib.xjtlu.edu.cn/']) {
    assert.equal(classifySource({ url }), 'university_official');
  }
  for (const url of ['https://www.liverpool.ac.uk/', 'https://www.suzhou.gov.cn/', 'https://wiki.xjt.lu/',
    'https://xjtlu.edu.cn.example.org/', 'https://notxjtlu.edu.cn/', 'https://mp.weixin.qq.com/s/commercial-account']) {
    assert.equal(classifySource({ url }), 'web');
  }
  const officialAccount = 'https://mp.weixin.qq.com/s/synthetic-school-department-account';
  assert.equal(classifySource({ url: officialAccount }), 'web', 'WeChat hosting alone does not identify a university account');
  assert.equal(classifySource({ url: officialAccount }, new Map([[officialAccount, 'university_official']])), 'university_official');
  assert.equal(classifySource({ url: 'https://github.com/example/guide/issues/1', sourceCategory: 'user_provided' }), 'user_provided');
  assert.equal(classifySource({ url: 'https://example.org/', origin: 'human', reviewStatus: 'approved' }), 'web', 'human authorship and editorial approval do not identify provenance');
  for (const sourceCategory of ['official', '', null, {}, ['web'], 1]) {
    assert.throws(() => classifySource({ url: officialAccount, sourceCategory }), /source category/u);
  }
  assert.throws(() => classifySource({ url: officialAccount, sourceCategory: 'web' }, new Map([[officialAccount, 'university_official']])), /Conflicting/u);
  assert.deepEqual(sourceCategories([{ sourceCategory: 'web' }, { sourceCategory: 'user_provided' }, { sourceCategory: 'web' }, { sourceCategory: 'university_official' }]), SOURCE_CATEGORIES);
});

test('curated metadata retains user provenance before the project URL is made public', () => {
  assert.deepEqual(publicSourceMetadata({ url: 'http://localhost:4317/about#method', publisher: '指南维护者' }), {
    sourceCategory: 'user_provided', publisher: '指南维护者',
  });
  assert.equal(publicSourceMetadata({ url: 'https://wiki.xjt.lu/' }).sourceCategory, 'web');
});

test('provenance additions do not rewrite immutable runtime sources or existing article revisions', async () => {
  const result = await compileHandbook();
  const original = JSON.parse(await readFile(new URL('../community/content.json', import.meta.url), 'utf8'));
  const profile = JSON.parse(await readFile(new URL('../community/content-profile.json', import.meta.url), 'utf8'));
  for (const key of ['entities', 'revisions', 'citations', 'links']) {
    const compiled = new Map(result.combined[key].map(row => [row.id, row]));
    for (const row of original[key]) assert.deepEqual(compiled.get(row.id), row, `${key} ${row.id} must remain immutable`);
  }
  const state = importContent(contentModule.initialState({ profile }), result.combined);
  assert.deepEqual(importContent(state, result.combined), state);
  assert.ok(result.markdown.includes('来源类别：学校官方'));
  assert.ok(result.markdown.includes('来源类别：网络资料'));
});

test('public Pages and local reader expose all three categories without changing review state', async t => {
  const h = await harness(t, { guide: true, mutateBundle(bundle) {
    bundle.revisions.find(row => row.entityId === 'artifact-current-students').data.url = 'https://www.suzhou.gov.cn/synthetic-test';
  } });
  h.publish();
  const config = JSON.parse(await readFile(new URL('../community/pages.config.json', import.meta.url), 'utf8'));
  delete config.collectedRevisionIds;
  const snapshot = createReviewedPagesData({ state: h.store.read(), catalog: h.catalog, config, keyring, now: new Date(h.time()).toISOString() });
  assert.deepEqual(snapshot.catalog.scopes.map(scope => scope.code), h.catalog.scopes.filter(scope => scope.status !== 'hidden').map(scope => scope.code));
  const local = await readJson(await h.get('/api/guide/answers'));
  assert.deepEqual(sourceCategories(snapshot.answers.flatMap(answer => answer.citations)), SOURCE_CATEGORIES);
  for (const answer of snapshot.answers) {
    assert.deepEqual(answer.sourceCategories, sourceCategories(answer.citations));
    assert.deepEqual(local.find(row => row.id === answer.id).sourceCategories, answer.sourceCategories);
    assert.equal(answer.origin, 'human');
    assert.equal(answer.reviewStatus, 'demo');
  }
  for (const mutate of [
    value => { value.answers[0].citations[0].sourceCategory = 'government_official'; },
    value => { value.answers[0].citations[0].publisher = { private: 'invalid-type' }; },
    value => { value.answers[0].sourceCategories = ['university_official', 'university_official']; },
    value => { value.answers[0].sourceCategories = ['user_provided']; },
    value => { delete value.answers[0].citations[0].sourceCategory; },
  ]) {
    const altered = structuredClone(snapshot);
    mutate(altered);
    altered.contentHash = pagesContentHash(altered);
    assert.throws(() => validateReviewedPagesData(altered, { config }));
  }
  const previous = structuredClone(snapshot);
  for (const scope of previous.catalog.scopes) delete scope.code;
  for (const answer of previous.answers) {
    delete answer.sourceCategories;
    for (const citation of answer.citations) { delete citation.sourceCategory; delete citation.publisher; }
  }
  previous.contentHash = pagesContentHash(previous);
  assert.deepEqual(validateReviewedPagesData(previous, { config }), previous, 'previous DTOs remain valid for safe replacement');
});
