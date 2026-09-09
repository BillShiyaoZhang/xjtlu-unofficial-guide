import assert from 'node:assert/strict';
import test from 'node:test';
import { importContent } from '@information-community/runtime';
import { harness, readJson } from './helpers.mjs';

async function setup(t) {
  const h = await harness(t, { guide: true });
  h.store.transact(state => { state.modules.content = importContent(state.modules.content, h.bundle); });
  const operator = await h.operator(['content_reviewer']);
  const entity = h.bundle.entities.find(row => row.type === 'answer');
  const revision = h.bundle.revisions.find(row => row.entityId === entity.id);
  return { ...h, token: operator.token, entity, input: { entityId: entity.id, revisionId: revision.id, expectedVersion: 0, reason: '核对原始来源和适用范围后同意公开。' } };
}

test('guide publication requires a bounded reason and records encrypted evidence atomically', async t => {
  const h = await setup(t);
  for (const reason of [undefined, '', '不足八字', 'x'.repeat(401), '需要联系 synthetic@example.org 确认。']) {
    const before = h.store.read();
    await readJson(await h.post('/api/content/publish', { ...h.input, reason }, h.token), 400);
    assert.deepEqual(h.store.read(), before);
  }
  const result = await readJson(await h.post('/api/content/publish', h.input, h.token, 'review-replay-key'));
  assert.equal(result.version, 1);
  assert.equal(h.store.read().modules['guide-reviews'].records.length, 1);
  assert.equal(JSON.stringify(h.store.read()).includes(h.input.reason), false);
  const after = h.store.read();
  assert.deepEqual(await readJson(await h.post('/api/content/publish', h.input, h.token, 'review-replay-key')), result);
  assert.deepEqual(h.store.read(), after);
  await readJson(await h.post('/api/content/publish', { ...h.input, reason: '这是不同的审核理由，请重新审核。' }, h.token, 'review-replay-key'), 409);
  assert.deepEqual(h.store.read(), after);
  const rows = await readJson(await h.get(`/api/guide/reviews?entityId=${h.entity.id}`, h.token));
  assert.equal(rows[0].reason, h.input.reason);
  assert.equal(rows[0].actorId, 'integration-operator');
  assert.equal(h.store.read().audit.at(-1).action, 'guide.reviews.read');
  for (const path of ['/api/list', '/api/export', '/api/guide/answers']) {
    assert.equal(JSON.stringify(await readJson(await h.get(path))).includes(h.input.reason), false);
  }
});

test('failed publication or review persistence leaves content, audit and replay unchanged', async t => {
  const h = await setup(t);
  const before = h.store.read();
  await readJson(await h.post('/api/content/publish', { ...h.input, expectedVersion: 50 }, h.token), 409);
  assert.deepEqual(h.store.read(), before);
  const module = h.store.modules.get('guide-reviews');
  h.store.modules.set('guide-reviews', { ...module, validate() { throw new Error('synthetic persistence rejection'); } });
  await readJson(await h.post('/api/content/publish', h.input, h.token), 500);
  h.store.modules.set('guide-reviews', module);
  assert.deepEqual(h.store.read(), before);
  assert.equal(h.store.read().modules['guide-reviews'].records.length, 0);
});

test('hiding and source disposition use the same required review and role boundary', async t => {
  const h = await setup(t);
  await readJson(await h.post('/api/content/publish', h.input, h.token));
  const source = h.bundle.entities.find(row => h.business.content.entityTypes.some(type => type.id === row.type && type.role === 'source'));
  for (const [route, input] of [
    ['hide', { entityId: h.entity.id, expectedVersion: 1, hidden: true }],
    ['source', { entityId: source.id, expectedVersion: 0, disposition: 'withdrawn' }],
  ]) {
    const before = h.store.read();
    await readJson(await h.post('/api/content/' + route, input, h.token), 400);
    assert.deepEqual(h.store.read(), before);
    await readJson(await h.post('/api/content/' + route, { ...input, reason: '核对相关证据后暂停公开并等待复核。' }, h.token));
  }
  assert.equal(h.store.read().modules['guide-reviews'].records.length, 3);
  const safety = await h.operator(['safety_reviewer'], 'safety-only');
  await readJson(await h.post('/api/content/hide', { entityId: h.entity.id, expectedVersion: 2, hidden: false, reason: '风险已经解除，核验后恢复内容公开。' }, safety.token));
  const history = await readJson(await h.get('/api/guide/reviews?entityId=' + h.entity.id, safety.token));
  assert.deepEqual(history.map(row => row.outcome.hidden), [false, true, false]);
  const sourceHistory = await readJson(await h.get('/api/guide/reviews?entityId=' + source.id, safety.token));
  assert.equal(sourceHistory[0].outcome.disposition, 'withdrawn');
  const pilot = await h.operator(['pilot_operator'], 'pilot-only');
  const before = h.store.read();
  await readJson(await h.get('/api/guide/reviews?entityId=' + h.entity.id, pilot.token), 403);
  await readJson(await h.get('/api/guide/editor-config', pilot.token), 403);
  await readJson(await h.post('/api/content/publish', h.input, pilot.token), 403);
  assert.deepEqual(h.store.read(), before);
  await readJson(await h.get('/api/guide/reviews?entityId=' + h.entity.id), 401);
});

test('business review records cannot be replaced or redirected to another revision', async t => {
  const h = await setup(t);
  await readJson(await h.post('/api/content/publish', h.input, h.token));
  const before = h.store.read();
  assert.throws(() => h.store.transact(state => { state.modules['guide-reviews'].records[0].actorId = 'forged'; }), { code: 'GUIDE_REVIEW_STATE' });
  assert.throws(() => h.store.transact(state => { state.modules['guide-reviews'].records = []; }), { code: 'GUIDE_REVIEW_STATE' });
  assert.deepEqual(h.store.read(), before);
});

test('reader projections include dispute warnings alongside overdue warnings and on exact history', async t => {
  for (const disputeStatus of ['reported', 'confirmed', 'none']) {
    const h = await harness(t, { guide: true, mutateBundle(bundle) {
      const revision = bundle.revisions.find(row => row.entityId === 'card-ebridge-entry');
      revision.data.disputeStatus = disputeStatus;
    } });
    h.publish();
    const row = (await readJson(await h.get('/api/guide/answers'))).find(item => item.id === 'card-ebridge-entry');
    assert.equal(row.warnings.some(text => text.includes('争议')), disputeStatus !== 'none');
    assert.ok(row.warnings.some(text => text.includes('复核')));
    const detail = await readJson(await h.get(`/api/guide/answers/${row.slug}?revision=${row.revisionId}`));
    assert.deepEqual(detail.warnings, row.warnings);
  }
});
