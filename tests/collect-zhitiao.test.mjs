import test from 'node:test';
import assert from 'node:assert/strict';
import { candidateFromMessage, discoveryFromSearchResult, collectZhitiao, parseOptions, shareUrl } from '../scripts/collect-zhitiao.mjs';
import { parseBatchOptions } from '../scripts/populate-cold-start.mjs';

const stamp = '2026-09-10T15:00:00Z';
const row = (patch = {}) => ({ _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', school: 'XJTLU', deleted: false,
  content: 'MTH305 课程小组如何安排？', createdAt: stamp, updatedAt: stamp,
  user: { nickname: 'must not persist', _id: 'secret', major: 'private' }, ipLocation: 'private',
  imgUrls: ['private'], comments: [{ content: 'private' }], likeNum: 10, ...patch });
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const searchRow = (patch = {}) => {
  const { deleted, updatedAt, ...result } = row(patch);
  return result;
};

test('candidate projection drops identities, media and engagement; excludes deleted, sensitive and other-school rows', () => {
  const candidate = candidateFromMessage(row(), stamp);
  assert.deepEqual(Object.keys(candidate).sort(), ['id', 'url', 'school', 'content', 'createdAt', 'updatedAt', 'accessedAt', 'contentSha256'].sort());
  assert.match(candidate.contentSha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(candidate).includes('private'), false);
  for (const patch of [{ deleted: true }, { deleted: undefined }, { school: 'OTHER' }, { content: '' },
    { content: 'x'.repeat(6001) }, { createdAt: 'invalid' }, { content: '微信 abcde123' },
    { content: '联系电话 13800138000' }, { content: '确诊情况' }, { carton: { title: 'Pride彩虹' } },
    { _id: '63341a38526af227cc7d69c7' }]) assert.equal(candidateFromMessage(row(patch), stamp), null);
});

test('collector uses observed cursor, deduplicates, rate spaces GETs and saves no comments from detail', async () => {
  const requests = [], pauses = [];
  const responses = [json({ messages: [row()] }), json({ messages: [row()] }), json({ messages: [row({ _id: 'bbbbbbbbbbbbbbbbbbbbbbbb' })] })];
  const report = await collectZhitiao({ pages: 3, now: () => stamp, pause: async ms => pauses.push(ms),
    fetchImpl: async (url, options) => { requests.push({ url, options }); return responses.shift(); } });
  assert.equal(report.candidates.length, 2);
  assert.equal(Object.hasOwn(report, 'discoveries'), false);
  assert.equal(report.duplicates, 1);
  assert.deepEqual(pauses, [1200, 1200]);
  assert.equal(requests[1].url, 'https://api.zhitiaox.com/message/latest?updatedAt=2026-09-10T15%3A00%3A00Z');
  for (const { options } of requests) {
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    assert.deepEqual(options.headers, { accept: 'application/json', school: 'XJTLU' });
  }
  const detail = await collectZhitiao({ ids: [row()._id], now: () => stamp,
    fetchImpl: async () => json({ message: row(), comments: [{ content: 'do not retain' }] }) });
  assert.equal(detail.candidates.length, 1);
  assert.equal(JSON.stringify(detail).includes('do not retain'), false);
});

test('search projection accepts missing deletion state only as a lead requiring detail reread', () => {
  const input = searchRow();
  const discovery = discoveryFromSearchResult(input, stamp);
  assert.equal(candidateFromMessage(input, stamp), null);
  assert.equal(discovery.requiresDetailReread, true);
  assert.deepEqual(Object.keys(discovery).sort(), ['id', 'url', 'school', 'content', 'createdAt', 'accessedAt', 'contentSha256', 'requiresDetailReread'].sort());
  assert.match(discovery.contentSha256, /^[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(input, 'deleted'), false);
  assert.equal(JSON.stringify(discovery).includes('private'), false);
  assert.equal(discoveryFromSearchResult(row(), stamp).requiresDetailReread, true);
  for (const patch of [{ deleted: true }, { school: 'OTHER' }, { content: '' }, { content: 'x'.repeat(6001) },
    { createdAt: 'invalid' }, { content: '微信 abcde123' }, { content: '联系电话 13800138000' },
    { content: '确诊情况' }, { carton: { title: 'Pride彩虹' } }, { _id: '63341a38526af227cc7d69c7' }]) {
    assert.equal(discoveryFromSearchResult({ ...input, ...patch }, stamp), null);
  }
});

test('search encodes queries, follows observed last IDs and deduplicates filtered leads across pages and queries', async () => {
  const requests = [], pauses = [];
  const a = searchRow(), b = searchRow({ _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', content: '微信 abcde123' });
  const c = searchRow({ _id: 'cccccccccccccccccccccccc' }), d = searchRow({ _id: 'dddddddddddddddddddddddd' });
  const responses = [json({ result: [a, b] }), json({ result: [a, c] }), json({ result: [c, d] }), json({ result: [] })];
  const report = await collectZhitiao({ pages: 2, queries: ['中介 / DIY?', '课程评价'], now: () => stamp,
    pause: async ms => pauses.push(ms), fetchImpl: async (url, options) => { requests.push({ url, options }); return responses.shift(); } });
  assert.deepEqual(requests.map(request => request.url), [
    'https://api.zhitiaox.com/search/message/?q=%E4%B8%AD%E4%BB%8B%20%2F%20DIY%3F',
    'https://api.zhitiaox.com/search/message/?q=%E4%B8%AD%E4%BB%8B%20%2F%20DIY%3F&startId=bbbbbbbbbbbbbbbbbbbbbbbb',
    'https://api.zhitiaox.com/search/message/?q=%E8%AF%BE%E7%A8%8B%E8%AF%84%E4%BB%B7',
    'https://api.zhitiaox.com/search/message/?q=%E8%AF%BE%E7%A8%8B%E8%AF%84%E4%BB%B7&startId=dddddddddddddddddddddddd',
  ]);
  assert.deepEqual(report.discoveries.map(discovery => discovery.id), [a._id, c._id, d._id]);
  assert.ok(report.discoveries.every(discovery => discovery.requiresDetailReread === true));
  assert.deepEqual(report.candidates, []);
  assert.equal(report.duplicates, 2);
  assert.equal(report.omitted, 1);
  assert.equal(report.stopped, false);
  assert.deepEqual(pauses, [1200, 1200, 1200]);
  for (const { options } of requests) {
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.deepEqual(options.headers, { accept: 'application/json', school: 'XJTLU' });
  }
});

test('search stops pagination on empty, invalid or repeated cursors without promoting results to candidates', async () => {
  for (const [rows, expectedCalls, expectedLeads] of [[[], 1, 0], [[searchRow(), null], 1, 1], [[searchRow()], 2, 1]]) {
    let calls = 0;
    const report = await collectZhitiao({ pages: 3, queries: ['  中介  ', '中介'], now: () => stamp, pause: async () => {},
      fetchImpl: async () => { calls++; return json({ result: rows }); } });
    assert.equal(calls, expectedCalls);
    assert.equal(report.discoveries.length, expectedLeads);
    assert.deepEqual(report.queries, ['中介']);
    assert.deepEqual(report.candidates, []);
  }
  const hidden = await collectZhitiao({ queries: ['中介'], now: () => stamp,
    fetchImpl: async () => json({ result: [{ ...searchRow(), deleted: true }] }) });
  assert.deepEqual(hidden.discoveries, []);
  assert.equal(hidden.omitted, 1);
});

test('search authorization, throttling and invalid responses stop all remaining queries without retries', async () => {
  for (const response of [new Response('', { status: 401 }), new Response('', { status: 403 }), new Response('', { status: 429 }),
    json({ messages: [row()] }), json({ result: {} }), new Response('not JSON'), new Response('x'.repeat(2 * 1024 * 1024 + 1))]) {
    let calls = 0;
    const report = await collectZhitiao({ pages: 3, queries: ['中介', '课程评价'], now: () => stamp,
      fetchImpl: async () => { calls++; return response; } });
    assert.equal(report.stopped, true);
    assert.equal(calls, 1);
    assert.deepEqual(report.discoveries, []);
    assert.deepEqual(report.candidates, []);
  }
});

test('authorization, throttling, malformed and oversized responses halt without retries or changing identity', async () => {
  for (const response of [new Response('', { status: 401 }), new Response('', { status: 403 }), new Response('', { status: 429 }),
    json({ wrong: [] }), new Response('not JSON'), new Response('x'.repeat(2 * 1024 * 1024 + 1))]) {
    let calls = 0;
    const report = await collectZhitiao({ pages: 3, now: () => stamp, fetchImpl: async () => { calls++; return response; } });
    assert.equal(report.stopped, true); assert.equal(calls, 1); assert.equal(report.candidates.length, 0);
  }
  const mismatch = await collectZhitiao({ ids: [row()._id], fetchImpl: async () => json({ message: row({ _id: 'bbbbbbbbbbbbbbbbbbbbbbbb' }) }) });
  assert.equal(mismatch.stopped, true);
});

test('CLI bounds collection and only accepts curated batch basenames', () => {
  assert.deepEqual(parseOptions([]), { pages: 1, ids: [] });
  assert.equal(parseOptions(['--pages', '3']).pages, 3);
  for (const args of [['--pages', '4'], ['--post', '../user'], ['--cookie', 'value']]) assert.throws(() => parseOptions(args));
  assert.throws(() => shareUrl('../user'));
  assert.deepEqual(parseBatchOptions(['--check', '--batch', '2026-09-10-zhitiao.json']), { checkOnly: true, batchName: '2026-09-10-zhitiao.json' });
  for (const name of ['../source.json', '/tmp/data.json', 'https://example.com/data.json']) assert.throws(() => parseBatchOptions(['--batch', name]));
});

test('query parameters have bounded text and count, normalize duplicates and exclude detail mode', async () => {
  assert.deepEqual(parseOptions(['--query', ' 中介 ', '--query', '课程评价', '--query', '中介', '--pages', '3']),
    { pages: 3, ids: [], queries: ['中介', '课程评价'] });
  assert.equal(parseOptions(['--query', '研'.repeat(40)]).queries[0].length, 40);
  const eight = Array.from({ length: 8 }, (_, index) => ['--query', `申请${index}`]).flat();
  assert.equal(parseOptions(eight).queries.length, 8);
  for (const args of [['--query'], ['--query', ''], ['--query', '   '], ['--query', '研'.repeat(41)],
    ['--query', '中介\n申请'], ['--query', '中介\u0000'], [...eight, '--query', '第九个'],
    ['--query', '中介', '--post', row()._id], ['--post', row()._id, '--query', '中介']]) assert.throws(() => parseOptions(args));
  for (const options of [{ queries: [''] }, { queries: ['研'.repeat(41)] }, { queries: Array(9).fill('中介') },
    { queries: ['中介'], ids: [row()._id] }, { queries: '中介' }, { queries: ['中介'], pages: 4 }]) {
    await assert.rejects(collectZhitiao({ ...options, fetchImpl: async () => { assert.fail('invalid options must not access the network'); } }), /Invalid collection limits/);
  }
});
