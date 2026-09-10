import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { searchAnswers, searchCollections } from '../community/pages-ui/search.js';

const snapshot = JSON.parse(await readFile(new URL('../community/pages-reviewed.json', import.meta.url), 'utf8'));
const answer = id => snapshot.answers.find(row => row.id === id);
const ids = results => results.map(row => row.id);

test('student task vocabulary retrieves the appropriate real handbook article first', () => {
  const cases = [
    ['暑研', 'handbook-surf-research-start'],
    ['暑期科研', 'handbook-surf-research-start'],
    ['申请研究生', 'handbook-postgraduate-application-materials'],
    ['申请硕士', 'handbook-postgraduate-application-materials'],
    ['找导师', 'handbook-find-research-supervisor'],
    ['选课', 'handbook-read-module-catalogue'],
  ];
  for (const [query, expectedId] of cases) {
    assert.ok(answer(expectedId), `real fixture needs ${expectedId}`);
    assert.equal(searchAnswers(snapshot, query)[0]?.title, answer(expectedId).title, query);
  }
});

test('dorm repair intent retains separate Suzhou and Taicang procedures', () => {
  const results = searchAnswers(snapshot, '宿舍报修');
  assert.ok(ids(results.slice(0, 3)).includes('handbook-life-sip-dorm-repair'));
  assert.ok(ids(results.slice(0, 3)).includes('handbook-life-taicang-dorm-repair'));
  assert.deepEqual(results.find(row => row.id === 'handbook-life-sip-dorm-repair').scope.campus, ['suzhou']);
  assert.deepEqual(results.find(row => row.id === 'handbook-life-taicang-dorm-repair').scope.campus, ['taicang']);
});

test('Taicang plus printing finds the universal entry without rewriting applicability', () => {
  const results = searchAnswers(snapshot, '太仓 打印');
  const printing = results.find(row => row.id === 'handbook-arrival-printing');
  assert.ok(printing, 'universal campus printing information should match a request from Taicang');
  assert.deepEqual(printing.scope, answer('handbook-arrival-printing').scope);
  assert.deepEqual(printing.scope.campus, ['universal'], 'a search term must not turn a universal entry into a Taicang-specific service claim');
  assert.ok(results.every(row => row.scope.campus.includes('universal') || row.scope.campus.includes('taicang')));
});

test('campus-qualified repair searches do not conflate campus-specific procedures', () => {
  const taicang = searchAnswers(snapshot, '太仓 宿舍报修');
  assert.ok(ids(taicang).includes('handbook-life-taicang-dorm-repair'));
  assert.ok(!ids(taicang).includes('handbook-life-sip-dorm-repair'));
  const suzhou = searchAnswers(snapshot, '园区 宿舍报修');
  assert.ok(ids(suzhou).includes('handbook-life-sip-dorm-repair'));
  assert.ok(!ids(suzhou).includes('handbook-life-taicang-dorm-repair'));
});

test('English abbreviations and phrases resolve to their real Chinese guide entries', () => {
  for (const [query, expectedId] of [
    ['SURF', 'handbook-surf-research-start'], ['ｓｕｒｆ', 'handbook-surf-research-start'],
    [' EBRIDGE ', 'handbook-arrival-ebridge'], ['e-bridge', 'handbook-arrival-ebridge'],
    ['LM', 'handbook-arrival-learning-mall'], ['Learning Mall', 'handbook-arrival-learning-mall'],
    ['module catalogue', 'handbook-read-module-catalogue'],
  ]) assert.equal(searchAnswers(snapshot, query)[0]?.id, expectedId, query);
});

test('an exact complete article title ranks that article before incidental mentions', () => {
  for (const row of snapshot.answers) assert.equal(searchAnswers(snapshot, row.title)[0]?.id, row.id, row.title);
  const library = searchAnswers(snapshot, '图书馆');
  assert.equal(library[0].id, 'handbook-find-books-articles');
  assert.ok(ids(library).indexOf('handbook-arrival-academic-integrity-ai') > ids(library).indexOf('handbook-find-books-articles'));
});

test('topic constraints and honest empty results survive vocabulary expansion', () => {
  const study = searchAnswers(snapshot, '选课', 'topic-study');
  assert.ok(study.length);
  assert.ok(study.every(row => row.topic.id === 'topic-study'));
  assert.deepEqual(searchAnswers(snapshot, '完全未收录的独特任务词987654'), []);
  assert.deepEqual(searchAnswers(snapshot, '暑研', 'topic-housing'), []);
  assert.equal(searchAnswers(snapshot, '').length, snapshot.answers.length);
});

test('relevance sorting leaves source scope, evidence, review state and original order unchanged', () => {
  const before = structuredClone(snapshot);
  for (const query of ['暑研', '申请研究生', '太仓 打印', '园区 宿舍报修', 'LM', '图书馆']) {
    for (const row of searchAnswers(snapshot, query)) assert.deepEqual(row, before.answers.find(original => original.id === row.id));
  }
  assert.deepEqual(snapshot, before);
  assert.deepEqual(answer('handbook-surf-research-start').scope.audience, ['undergraduate']);
});

const collections = JSON.parse(await readFile(new URL('../community/community-topics.json', import.meta.url), 'utf8'));

test('source collections are discoverable by title, prompt and source text without becoming handbook answers', () => {
  const cases = [
    ['双选会', 'collected-ibss-job-fair-20261021'],
    ['跨学院参加条件', 'collected-ibss-job-fair-20261021'],
    ['数据库导航', 'collected-library-libai-migration'],
    ['ＬｉｂＡＩ', 'collected-library-libai-migration'],
  ];
  const before = structuredClone({ snapshot, collections });
  for (const [query, expectedId] of cases) {
    assert.ok(ids(searchCollections(snapshot, collections, query)).includes(expectedId), query);
  }
  assert.deepEqual(searchAnswers(snapshot, '双选会'), []);
  assert.equal(searchAnswers(snapshot).length, before.snapshot.answers.length);
  assert.deepEqual({ snapshot, collections }, before);
});

test('collection search respects catalog filters, every query term and the empty directory state', () => {
  const career = searchCollections(snapshot, collections, '双选会', 'topic-careers');
  assert.equal(career[0]?.id, 'collected-ibss-job-fair-20261021');
  assert.ok(career.every(row => row.catalogTopicId === 'topic-careers'));
  assert.deepEqual(searchCollections(snapshot, collections, '双选会', 'topic-library'), []);
  assert.deepEqual(searchCollections(snapshot, collections, '双选会 不存在的词987654'), []);
  assert.deepEqual(searchCollections(snapshot, collections, '不存在的词987654'), []);
  assert.deepEqual(searchCollections(snapshot, collections, ' \n '), []);
  assert.deepEqual(searchCollections(snapshot, collections), []);
  assert.ok(searchCollections(snapshot, collections, '图书馆').every(row => row.collection));
});

test('collection relevance prioritizes titles, preserves ties and shares query aliases', () => {
  const config = { topics: [
    { id: 'source-match', collection: true, title: '来源中的线索', sources: [{ summary: '暑期科研 参加准备' }] },
    { id: 'title-match', collection: true, title: '暑期科研', sources: [] },
    { id: 'title-tie', collection: true, title: '暑期科研', sources: [] },
    { id: 'editorial-prompt', title: '暑期科研', sources: [] },
  ] };
  assert.deepEqual(ids(searchCollections(snapshot, config, '暑研')), ['title-match', 'title-tie', 'source-match']);
  assert.deepEqual(ids(searchCollections(snapshot, config, '暑研 准备')), ['source-match']);
});
