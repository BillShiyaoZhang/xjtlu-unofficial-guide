import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { appendColdStartBatch } from '../scripts/populate-cold-start.mjs';
import { eventPresentation } from '../community/pages-ui/topic-model.js';

const read = async name => JSON.parse(await readFile(new URL(`../community/${name}`, import.meta.url), 'utf8'));
const [config, batch, catalog] = await Promise.all(['community-topics.json', 'cold-start/2026-09-10.json', 'catalog.json'].map(read));

test('the first sourced batch covers all native topic types and is already fully populated', () => {
  assert.equal(batch.topics.length, 16);
  assert.deepEqual([...new Set(batch.topics.map(row => row.kind))].sort(), ['event', 'incident', 'question']);
  assert.equal(appendColdStartBatch(config, batch, catalog).added, 0);
  for (const topic of batch.topics) {
    assert.ok(topic.sources.some(source => source.accessStatus === 'read'));
    assert.equal(topic.collection, true);
    assert.equal(topic.editorial, true);
    for (const source of topic.sources) {
      if (source.accessStatus === 'unavailable') assert.equal(Object.hasOwn(source, 'summary'), false);
      assert.equal(Object.hasOwn(source, 'verifiedAt'), false);
    }
    if (topic.event) assert.equal(eventPresentation(topic.event, '2026-09-10T14:13:10Z').canRegister, false);
  }
});

test('population appends once and refuses to silently replace edited or unrelated topics', () => {
  const original = { schemaVersion: 1, topics: config.topics.filter(topic => !topic.collection) };
  const before = structuredClone(original);
  const first = appendColdStartBatch(original, batch, catalog);
  assert.equal(first.added, 16);
  assert.deepEqual(original, before);
  const repeat = appendColdStartBatch(first.config, batch, catalog);
  assert.equal(repeat.added, 0);
  assert.deepEqual(repeat.config, first.config);
  const edited = structuredClone(first.config);
  edited.topics.find(row => row.id === batch.topics[0].id).prompt = '维护者后续补充的内容';
  const editedBefore = structuredClone(edited);
  assert.throws(() => appendColdStartBatch(edited, batch, catalog), /different content/u);
  assert.deepEqual(edited, editedBefore);
});

test('an unread social link alone cannot become a sourced cold-start topic', () => {
  const unread = structuredClone(batch);
  unread.topics = [unread.topics[0]];
  unread.topics[0].sources = [unread.topics[0].sources.find(source => source.accessStatus === 'unavailable')];
  assert.throws(() => appendColdStartBatch({ schemaVersion: 1, topics: [] }, unread, catalog), /actually read source/u);
});

test('the community batch is traced to individually read posts and cannot create verified facts or enrollment', async () => {
  const [social, evidence] = await Promise.all(['cold-start/2026-09-10-zhitiao.json', 'cold-start/2026-09-10-zhitiao-evidence.json'].map(read));
  assert.equal(social.topics.length, 20);
  assert.equal(evidence.selectedCount, 20);
  assert.equal(evidence.credentialsUsed, false);
  assert.equal(appendColdStartBatch(config, social, catalog).added, 0);
  const first = appendColdStartBatch({ schemaVersion: 1, topics: [] }, social, catalog);
  assert.equal(first.added, 20);
  assert.equal(appendColdStartBatch(first.config, social, catalog).added, 0);
  assert.deepEqual([...new Set(social.topics.map(row => row.kind))].sort(), ['event', 'incident', 'question']);
  for (const topic of social.topics) {
    const source = topic.sources[0];
    const record = evidence.records.find(row => row.url === source.url);
    assert.ok(record);
    assert.equal(topic.id, `collected-zhitiao-${record.id}`);
    assert.equal(source.accessStatus, 'read');
    assert.equal(source.category, 'community');
    assert.equal(source.accessedAt, record.accessedAt);
    assert.match(record.contentSha256, /^[a-f0-9]{64}$/);
    assert.equal(source.publishedOn, new Date(Date.parse(record.createdAt) + 8 * 3600000).toISOString().slice(0, 10));
    if (topic.incident) { assert.equal(topic.incident.status, 'unknown'); assert.equal(topic.incident.confirmedAt, undefined); }
    if (topic.event) assert.equal(eventPresentation(topic.event, '2026-09-10T15:00:00Z').canRegister, false);
  }
  const badminton = social.topics.find(row => row.title.includes('羽毛球'));
  assert.equal(eventPresentation(badminton.event, '2026-09-11T16:00:00Z').history, true);
  const serialized = JSON.stringify({ social, evidence });
  for (const field of ['nickname', 'avatarUrl', 'ipLocation', 'anomUserList', 'commentNum', 'likeNum', 'token', 'authorization']) {
    assert.equal(serialized.includes(`"${field}"`), false);
  }
});

test('common discussions trace every summary to a read source, keeping search leads and historical context separate', async () => {
  const [discussions, evidence] = await Promise.all([
    'cold-start/2026-09-12-discussions.json', 'cold-start/2026-09-12-discussions-evidence.json',
  ].map(read));
  assert.equal(discussions.topics.length, 25);
  assert.equal(evidence.selectedCount, discussions.topics.length);
  assert.equal(evidence.zhitiaoSelectedCount, 22);
  assert.equal(evidence.externalSelectedCount, 3);
  assert.equal(evidence.credentialsUsed, false);
  assert.equal(appendColdStartBatch(config, discussions, catalog).added, 0);
  const first = appendColdStartBatch({ schemaVersion: 1, topics: [] }, discussions, catalog);
  assert.equal(first.added, 25);
  assert.equal(appendColdStartBatch(first.config, discussions, catalog).added, 0);
  assert.equal(new Set(evidence.records.map(record => record.topicId)).size, discussions.topics.length);
  for (const topic of discussions.topics) {
    assert.equal(topic.kind, 'question');
    assert.equal(topic.editorial, true);
    assert.equal(topic.collection, true);
    assert.equal(topic.sources.length, 1);
    const source = topic.sources[0];
    const record = evidence.records.find(row => row.topicId === topic.id);
    assert.ok(record, topic.id);
    assert.equal(source.url, record.url);
    assert.equal(source.accessStatus, 'read');
    assert.equal(source.category, 'community');
    assert.equal(source.accessedAt, record.accessedAt);
    assert.equal(Object.hasOwn(source, 'verifiedAt'), false);
    assert.ok(topic.prompt.startsWith(source.summary));
    if (record.platform === '纸条') {
      assert.equal(record.method, 'public-json-get');
      assert.equal(record.httpStatus, 200);
      assert.equal(record.apiUrl, `https://api.zhitiaox.com/message/${record.id}`);
      assert.equal(record.deletionState, 'not-deleted-at-detail-read');
      assert.match(record.contentSha256, /^[a-f0-9]{64}$/);
      assert.equal(source.publishedOn, new Date(Date.parse(record.createdAt) + 8 * 3600000).toISOString().slice(0, 10));
    } else {
      assert.equal(record.method, 'public-web-read');
      assert.ok(record.readScope);
      assert.ok(record.context);
      assert.equal(Object.hasOwn(source, 'publishedOn'), false, 'do not invent publication dates from application years');
    }
  }
  const serialized = JSON.stringify({ discussions, evidence });
  for (const field of ['nickname', 'avatarUrl', 'ipLocation', 'commentNum', 'likeNum', 'comments', 'content', 'token']) {
    assert.equal(serialized.includes(`"${field}"`), false);
  }
  assert.ok(discussions.topics.every(topic => !topic.sources.some(source => /xiaohongshu|xhslink/u.test(source.url))),
    'unread Xiaohongshu links must not appear as collected posts');
});
