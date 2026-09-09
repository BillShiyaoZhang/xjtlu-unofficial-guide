import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { encryptPrivatePayload, decryptPrivatePayload, revokeIdentitySubject } from '@information-community/runtime';
import { researchTimestamp, researchWindow } from '../server/business-validation.mjs';
import { main, readResearchReport } from '../scripts/research-report.mjs';
import { harness, initialTime, keyring, loadCommunity, readJson, syntheticResearch } from './helpers.mjs';

const operatorId = 'synthetic-research-operator';
async function fixture(t) {
  const h = await harness(t, { guide: true });
  h.publish();
  const operator = await h.operator();
  async function enroll() {
    const session = await h.enroll(operator.token);
    const consent = await readJson(await h.post('/api/private/command', {
      action: 'consent', type: 'research_event', accepted: true,
      version: h.business.lifecycle.workflows.research_event.consentVersion,
    }, session.token));
    return { ...session, epoch: consent.consentEpoch };
  }
  const participant = await enroll();
  const revisionId = h.store.read().modules.content.entities.find(entity => entity.publicRevisionId).publicRevisionId;
  const request = (payload, person = participant, key) => h.post('/api/private/command', {
    action: 'create', type: 'research_event', consentEpoch: person.epoch, payload,
  }, person.token, key);
  const event = async (payload, person, key) => readJson(await request(payload, person, key));
  const report = (options = {}) => readResearchReport(h.store, { business: h.business, keyring, operatorId, now: h.time(), ...options });
  return { h, participant, revisionId, enroll, request, event, report };
}

function syntheticEvent(h, template, payload, changes = {}) {
  const id = randomUUID();
  h.store.transact(state => {
    state.modules.lifecycle.records[id] = {
      ...structuredClone(template), id, ...changes,
      payload: encryptPrivatePayload(id, { data: payload, internalNotes: [] }, keyring),
    };
  });
  return id;
}

test('production research defaults disabled while participation and private questions remain available', async t => {
  const { h, participant, request } = await fixture(t);
  h.business.research = (await loadCommunity()).business.research;
  assert.deepEqual(h.business.research, { enabled: false, batchId: 'stage1-runtime-v1', startAt: null, endAt: null });
  const notice = await readJson(await h.get('/api/guide/notice'));
  assert.deepEqual(notice.research, { enabled: false, active: false });
  const before = h.store.read();
  const failure = await readJson(await request({ kind: 'query', queryLengthBand: 'short' }), 403);
  assert.equal(failure.code, 'RESEARCH_DISABLED');
  assert.deepEqual(h.store.read(), before);
  await readJson(await h.post('/api/private/command', {
    action: 'create', type: 'question', consentEpoch: participant.epoch,
    payload: { body: 'A private question without research event tracking.', contextScope: 'Synthetic campus' },
  }, participant.token));
});

test('research windows require real zoned ISO timestamps and increasing explicit bounds', () => {
  assert.equal(researchTimestamp('2098-01-01T08:00:00+08:00'), initialTime);
  assert.equal(researchTimestamp('2098-01-01T00:00Z'), initialTime);
  for (const value of ['2098-01-01', '2098-01-01T00:00:00', '2098-02-30T00:00:00Z', '2098-01-01T24:00:00Z', '2098-01-01T00:00:00+99:00', null]) {
    assert.throws(() => researchTimestamp(value), error => error.code === 'RESEARCH_WINDOW');
  }
  for (const patch of [{ startAt: null }, { endAt: syntheticResearch.startAt }, { batchId: '' }, { surprise: true }]) {
    assert.throws(() => researchWindow({ ...syntheticResearch, ...patch }), error => error.code === 'RESEARCH_WINDOW');
  }
});

test('new events are accepted at window start and rejected at its exclusive end, including old query feedback', async t => {
  const { h, event, request, revisionId, report } = await fixture(t);
  h.business.research = { ...syntheticResearch, startAt: new Date(initialTime + 1000).toISOString(), endAt: new Date(initialTime + 3000).toISOString() };
  let before = h.store.read();
  assert.equal((await readJson(await request({ kind: 'query', queryLengthBand: 'short' }), 403)).code, 'RESEARCH_WINDOW_CLOSED');
  assert.deepEqual(h.store.read(), before);
  h.setTime(initialTime + 1000);
  const query = await event({ kind: 'query', queryLengthBand: 'short' });
  await event({ kind: 'open', queryEventId: query.id, revisionId });
  h.setTime(initialTime + 2999);
  await event({ kind: 'share', queryEventId: query.id, revisionId });
  h.setTime(initialTime + 3000);
  for (const payload of [
    { kind: 'query', queryLengthBand: 'long' },
    { kind: 'open', queryEventId: query.id, revisionId },
    { kind: 'feedback', queryEventId: query.id, revisionId, outcome: 'resolved' },
  ]) {
    before = h.store.read();
    assert.equal((await readJson(await request(payload), 403)).code, 'RESEARCH_WINDOW_CLOSED');
    assert.deepEqual(h.store.read(), before);
  }
  assert.equal((await readJson(await h.get('/api/guide/notice'))).research.active, false);
  assert.deepEqual(report().counts, { queries: 1, openedQueries: 1, sharedQueries: 1, feedbackQueries: 0, resolvedQueries: 0, unclearQueries: 0, unansweredQueries: 1 });
});

test('batch identity is server-bound and is part of idempotency and query ownership', async t => {
  const { h, request, event, revisionId } = await fixture(t);
  await readJson(await request({ kind: 'query', queryLengthBand: 'short', batchId: 'forged-batch' }), 400);
  const key = 'research-batch-idempotency-key';
  const query = await event({ kind: 'query', queryLengthBand: 'short' }, undefined, key);
  const record = h.store.read().modules.lifecycle.records[query.id];
  assert.equal(decryptPrivatePayload(query.id, record.payload, keyring).data.batchId, syntheticResearch.batchId);
  h.business.research.batchId = 'synthetic-second-batch';
  const before = h.store.read();
  await readJson(await request({ kind: 'query', queryLengthBand: 'short' }, undefined, key), 409);
  await readJson(await request({ kind: 'open', queryEventId: query.id, revisionId }), 403);
  assert.deepEqual(h.store.read(), before);
});

test('reports aggregate unique query journeys and length bands without exporting records or identities', async t => {
  const { h, event, enroll, participant, revisionId, report } = await fixture(t);
  const other = await enroll();
  const short = await event({ kind: 'query', queryLengthBand: 'short' });
  const medium = await event({ kind: 'query', queryLengthBand: 'medium' });
  const long = await event({ kind: 'query', queryLengthBand: 'long' }, other);
  for (let index = 0; index < 2; index++) {
    await event({ kind: 'open', queryEventId: short.id, revisionId });
    await event({ kind: 'share', queryEventId: short.id, revisionId });
    await event({ kind: 'feedback', queryEventId: short.id, revisionId, outcome: 'resolved' });
  }
  await event({ kind: 'feedback', queryEventId: short.id, revisionId, outcome: 'unclear' });
  await event({ kind: 'open', queryEventId: long.id, revisionId }, other);
  await event({ kind: 'feedback', queryEventId: long.id, revisionId, outcome: 'unclear' }, other);
  const output = report();
  assert.deepEqual(output.counts, { queries: 3, openedQueries: 2, sharedQueries: 1, feedbackQueries: 2, resolvedQueries: 1, unclearQueries: 2, unansweredQueries: 1 });
  assert.deepEqual(output.queryLengthBands, { short: 1, medium: 1, long: 1 });
  assert.deepEqual(Object.keys(output).sort(), ['batchId', 'counts', 'queryLengthBands', 'schemaVersion', 'window']);
  for (const secret of [short.id, medium.id, long.id, participant.principal.id, other.principal.id, participant.token, operatorId, revisionId]) assert.equal(JSON.stringify(output).includes(secret), false);
  assert.equal(h.store.read().audit.at(-1).action, 'guide.research.report');
  assert.equal(h.store.read().audit.at(-1).actorId, operatorId);
});

test('legacy, malformed, foreign, future, and unobserved event associations cannot enter the report', async t => {
  const { h, event, enroll, revisionId, report } = await fixture(t);
  const other = await enroll();
  const query = await event({ kind: 'query', queryLengthBand: 'medium' });
  const template = h.store.read().modules.lifecycle.records[query.id], batchId = h.business.research.batchId;
  syntheticEvent(h, template, { eventType: 'legacy_query', query: { text: 'PRIVATE_LEGACY_QUERY' } });
  syntheticEvent(h, template, { kind: 'query', queryLengthBand: 'short' });
  syntheticEvent(h, template, { kind: 'query', queryLengthBand: 'short', batchId: 'another-batch' });
  syntheticEvent(h, template, { kind: 'query', queryLengthBand: 'short', batchId, text: 'PRIVATE_EXTRA_FIELD' });
  syntheticEvent(h, template, { kind: 'open', queryEventId: query.id, revisionId, batchId }, { subjectId: other.principal.id, consentEpoch: other.epoch });
  syntheticEvent(h, template, { kind: 'open', queryEventId: 'absent-query', revisionId, batchId });
  syntheticEvent(h, template, { kind: 'open', queryEventId: query.id, revisionId: 'absent-revision', batchId });
  syntheticEvent(h, template, { kind: 'share', queryEventId: query.id, revisionId, batchId });
  syntheticEvent(h, template, { kind: 'query', queryLengthBand: 'long', batchId }, { createdAt: initialTime + 5000 });
  const output = report();
  assert.deepEqual(output.counts, { queries: 1, openedQueries: 0, sharedQueries: 0, feedbackQueries: 0, resolvedQueries: 0, unclearQueries: 0, unansweredQueries: 1 });
  assert.deepEqual(output.queryLengthBands, { short: 0, medium: 1, long: 0 });
  assert.doesNotMatch(JSON.stringify(output), /PRIVATE_|participant:|ciphertext/);
});

test('report intervals are bounded and exclude events and query contexts at the upper endpoint', async t => {
  const { h, event, revisionId, report } = await fixture(t);
  const early = await event({ kind: 'query', queryLengthBand: 'short' });
  h.setTime(initialTime + 1000);
  const included = await event({ kind: 'query', queryLengthBand: 'medium' });
  h.setTime(initialTime + 1500);
  await event({ kind: 'open', queryEventId: early.id, revisionId });
  await event({ kind: 'open', queryEventId: included.id, revisionId });
  h.setTime(initialTime + 2000);
  await event({ kind: 'query', queryLengthBand: 'long' });
  const from = '2098-01-01T08:00:01+08:00', to = '2098-01-01T08:00:02+08:00';
  const output = report({ from, to });
  assert.equal(output.counts.queries, 1);
  assert.equal(output.counts.openedQueries, 1);
  assert.deepEqual(output.queryLengthBands, { short: 0, medium: 1, long: 0 });
  assert.equal(output.window.endExclusive, true);
  for (const options of [{ from }, { to }, { from: '2097-12-31T00:00:00Z', to }, { from, to: '2100-01-01T00:00:00Z' }, { from: to, to: from }]) assert.throws(() => report(options), error => error.code === 'RESEARCH_WINDOW');
});

test('withdrawal, revoked eligibility, stale consent, and expiry are excluded from fresh aggregates', async t => {
  const { h, event, participant, enroll, report } = await fixture(t);
  const other = await enroll(), stale = await enroll();
  const first = await event({ kind: 'query', queryLengthBand: 'short' });
  await event({ kind: 'query', queryLengthBand: 'medium' }, other);
  await event({ kind: 'query', queryLengthBand: 'long' }, stale);
  assert.equal(report().counts.queries, 3);
  assert.equal(report({ now: first.expiresAt }).counts.queries, 0);
  await readJson(await h.post('/api/private/command', { action: 'withdraw' }, participant.token));
  assert.equal(report().counts.queries, 2);
  h.store.transact(state => revokeIdentitySubject(state, other.principal.id, { now: h.time() }));
  assert.equal(report().counts.queries, 1);
  h.store.transact(state => {
    state.modules.lifecycle.subjects[stale.principal.id].consents.stage1_research.version = 'synthetic-outdated-consent';
  });
  assert.equal(report().counts.queries, 0);
});

test('offline report requires a named operator and failed decryption does not leave a successful read audit', async t => {
  const { h, event, report } = await fixture(t);
  await event({ kind: 'query', queryLengthBand: 'short' });
  const before = h.store.read();
  assert.throws(() => report({ operatorId: '' }), error => error.code === 'OFFLINE_OPERATOR_REQUIRED');
  assert.throws(() => report({ keyring: { activeVersion: 'test-v1', keys: { 'test-v1': 'ff'.repeat(32) } } }), error => error.code === 'DECRYPTION_FAILED');
  assert.deepEqual(h.store.read(), before);
  await assert.rejects(main([], {}), error => error.code === 'OFFLINE_OPERATOR_REQUIRED');
  await assert.rejects(main(['--from', '2098-01-01T00:00:00Z'], { RUNTIME_OPERATOR_ID: operatorId }), error => error.code === 'RESEARCH_WINDOW');
  await assert.rejects(main([], { RUNTIME_OPERATOR_ID: operatorId, RUNTIME_KEYRING: '{PRIVATE_INVALID_INPUT' }), error => error.code === 'KEYRING_REQUIRED' && !error.message.includes('PRIVATE_INVALID_INPUT'));
});
