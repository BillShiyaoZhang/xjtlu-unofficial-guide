import test from 'node:test';
import assert from 'node:assert/strict';
import { candidateFromMessage, collectZhitiao, parseOptions, shareUrl } from '../scripts/collect-zhitiao.mjs';
import { parseBatchOptions } from '../scripts/populate-cold-start.mjs';

const stamp = '2026-09-10T15:00:00Z';
const row = (patch = {}) => ({ _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', school: 'XJTLU', deleted: false,
  content: 'MTH305 课程小组如何安排？', createdAt: stamp, updatedAt: stamp,
  user: { nickname: 'must not persist', _id: 'secret', major: 'private' }, ipLocation: 'private',
  imgUrls: ['private'], comments: [{ content: 'private' }], likeNum: 10, ...patch });
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });

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
  assert.equal(parseOptions(['--pages', '3']).pages, 3);
  for (const args of [['--pages', '4'], ['--post', '../user'], ['--cookie', 'value']]) assert.throws(() => parseOptions(args));
  assert.throws(() => shareUrl('../user'));
  assert.deepEqual(parseBatchOptions(['--check', '--batch', '2026-09-10-zhitiao.json']), { checkOnly: true, batchName: '2026-09-10-zhitiao.json' });
  for (const name of ['../source.json', '/tmp/data.json', 'https://example.com/data.json']) assert.throws(() => parseBatchOptions(['--batch', name]));
});
