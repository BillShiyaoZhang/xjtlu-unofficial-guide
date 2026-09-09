import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { decryptPrivatePayload, hideContent, importContent } from '@information-community/runtime';
import { harness, keyring, readJson } from './helpers.mjs';

async function fixture(t) {
  const h = await harness(t, { guide: true });
  h.publish();
  const operator = await h.operator();
  return { h, operator };
}

async function createCase(h, operator, type = 'privacy_report') {
  if (type === 'privacy_report') {
    const before = new Set(Object.keys(h.store.read().modules.lifecycle.records));
    const receipt = await readJson(await h.post('/api/reports', {
      type: 'privacy', affectedArea: 'home',
    }, undefined, randomBytes(32).toString('base64url')), 201);
    const record = Object.values(h.store.read().modules.lifecycle.records).find(item => !before.has(item.id));
    return { record, receipt };
  }
  const session = await h.enroll(operator.token);
  const consent = await readJson(await h.post('/api/private/command', {
    action: 'consent', type, accepted: true, version: h.business.lifecycle.workflows[type].consentVersion,
  }, session.token));
  const payload = type === 'report'
    ? { type: 'stale', cardId: h.store.read().modules.content.entities.find(item => item.publicRevisionId).id }
    : { body: 'A synthetic case for editorial review.', contextScope: 'Synthetic campus', ...(type === 'material' ? { provenanceRole: 'lead_only' } : {}) };
  const record = await readJson(await h.post('/api/private/command', {
    action: 'create', type, consentEpoch: consent.consentEpoch, payload,
  }, session.token));
  return { record, session };
}

function command(record, changes) {
  return { action: 'transition', id: record.id, expectedVersion: record.version, status: record.status, ...changes };
}

async function transition(h, operator, record, changes, key) {
  return readJson(await h.post('/api/private/command', command(record, changes), operator.token, key));
}

async function rejectUnchanged(h, operator, record, changes, status = 400) {
  const before = h.store.read();
  const result = await readJson(await h.post('/api/private/command', command(record, changes), operator.token), status);
  assert.deepEqual(h.store.read(), before, 'rejected case updates must roll back every module');
  return result;
}

function privatePayload(h, id) {
  return decryptPrivatePayload(id, h.store.read().modules.lifecycle.records[id].payload, keyring);
}

function addDraft(h, entity) {
  const original = h.bundle.revisions.find(item => item.id === entity.publicRevisionId);
  const draft = structuredClone(original);
  draft.parentRevisionId = original.id;
  draft.id = `${original.id}-case-draft`;
  draft.number += 1;
  draft.data.title = 'Synthetic private editorial draft';
  const citations = h.bundle.citations.filter(item => item.revisionId === original.id).map(item => ({
    ...structuredClone(item), id: `${item.id}-case-draft`, revisionId: draft.id,
  }));
  h.store.transact(state => {
    state.modules.content = importContent(state.modules.content, {
      schemaVersion: 1, entities: [], revisions: [draft], citations, links: [],
    });
  });
  return draft;
}

test('case notes enforce bounded plain text and the legacy personal-data rule with rollback', async t => {
  const { h, operator } = await fixture(t);
  const { record } = await createCase(h, operator);
  for (const note of [null, 123, '', '   ', 'abc', 'x'.repeat(1001),
    'Contact student@example.org', 'Call 13800138000', 'Student ID 12345678', 'ID 110101199901011234',
    'student\u0000@example.org']) {
    await rejectUnchanged(h, operator, record, { note });
  }
  const updated = await transition(h, operator, record, { note: '  note\u0000  ' });
  assert.equal(updated.status, 'received');
  assert.equal(updated.version, 1);
  assert.equal(privatePayload(h, record.id).internalNotes[0].text, 'note');
  await transition(h, operator, updated, { note: 'x'.repeat(1000) });
  assert.equal(privatePayload(h, record.id).internalNotes.length, 2);
});

test('case updates reject extra fields, empty repeats, and premature outcomes', async t => {
  const { h, operator } = await fixture(t);
  const { record } = await createCase(h, operator);
  for (const extra of [{ publicResult: { label: 'Fabricated result' } }, { payload: {} }, { subjectId: 'someone-else' }, { externalId: 'external-case' }]) {
    await rejectUnchanged(h, operator, record, { note: 'Valid case note', ...extra });
  }
  await rejectUnchanged(h, operator, record, {}, 409);
  await rejectUnchanged(h, operator, record, { assignee: null }, 409);
  await rejectUnchanged(h, operator, record, { assignee: {} });
  await rejectUnchanged(h, operator, record, { status: 'reviewing', decisionCode: 'no_change' });
  const updated = await transition(h, operator, record, { assignee: 'synthetic-reviewer' });
  assert.equal(updated.assignee, 'synthetic-reviewer');
  await rejectUnchanged(h, operator, updated, { assignee: 'synthetic-reviewer' }, 409);
  const cleared = await transition(h, operator, updated, { assignee: null });
  assert.equal(cleared.assignee, null);
});

test('entering a terminal state requires eight characters and same-state notes retain its result', async t => {
  const { h, operator } = await fixture(t);
  const { record, receipt } = await createCase(h, operator);
  const reviewing = await transition(h, operator, record, { status: 'reviewing' });
  const outcome = { status: 'resolved', decisionCode: 'no_change' };
  await rejectUnchanged(h, operator, reviewing, outcome);
  await rejectUnchanged(h, operator, reviewing, { ...outcome, note: '1234567' });
  const resolved = await transition(h, operator, reviewing, { ...outcome, note: 'Reviewed source and no correction was needed.' });
  await rejectUnchanged(h, operator, resolved, { note: 'Another note', decisionCode: 'hidden' }, 409);
  const noted = await transition(h, operator, resolved, { note: 'done' });
  assert.equal(noted.decisionCode, 'no_change');
  assert.equal(noted.entityId, null);
  assert.deepEqual((await readJson(await h.get('/api/reports/status', receipt.receipt))).result,
    h.business.lifecycle.workflows.privacy_report.publicResults.no_change);
  assert.equal(privatePayload(h, record.id).internalNotes.length, 2);
});

test('hidden outcomes require an actually hidden answer and do not require a public revision', async t => {
  const { h, operator } = await fixture(t);
  const { record, receipt } = await createCase(h, operator);
  const reviewing = await transition(h, operator, record, { status: 'reviewing' });
  const entities = h.store.read().modules.content.entities.filter(item => item.publicRevisionId);
  const entity = entities[0];
  const outcome = { status: 'resolved', decisionCode: 'hidden', note: 'The referenced answer has been hidden after review.' };
  await rejectUnchanged(h, operator, reviewing, outcome);
  await rejectUnchanged(h, operator, reviewing, { ...outcome, entityId: entity.id });
  h.store.transact(state => {
    state.modules.content = hideContent(state.modules.content, { entityId: entity.id, expectedVersion: entity.version, hidden: true });
  });
  await rejectUnchanged(h, operator, reviewing, { ...outcome, entityId: entity.id, revisionId: entities[1].publicRevisionId });
  const resolved = await transition(h, operator, reviewing, { ...outcome, entityId: entity.id });
  assert.equal(resolved.entityId, entity.id);
  assert.equal(resolved.revisionId, null);
  const noted = await transition(h, operator, resolved, { note: 'Additional review context.' });
  assert.equal(noted.decisionCode, 'hidden');
  assert.equal(noted.entityId, entity.id);
  assert.equal(noted.revisionId, null);
  const receiptStatus = await readJson(await h.get('/api/reports/status', receipt.receipt));
  assert.deepEqual(receiptStatus.result, h.business.lifecycle.workflows.privacy_report.publicResults.hidden);
  assert.doesNotMatch(JSON.stringify(receiptStatus), /Additional|entityId|revisionId|payload/);
});

test('corrected reports require an exact visible answer revision and notes cannot replace the link', async t => {
  const { h, operator } = await fixture(t);
  const { record } = await createCase(h, operator, 'report');
  const reviewing = await transition(h, operator, record, { status: 'reviewing' });
  const entities = h.store.read().modules.content.entities.filter(item => item.publicRevisionId);
  const entity = entities[0], draft = addDraft(h, entity);
  const outcome = { status: 'resolved', decisionCode: 'corrected', note: 'The public answer was checked against its sources.' };
  await rejectUnchanged(h, operator, reviewing, { ...outcome, entityId: entity.id });
  await rejectUnchanged(h, operator, reviewing, { ...outcome, entityId: entity.id, revisionId: draft.id });
  await rejectUnchanged(h, operator, reviewing, { ...outcome, entityId: entity.id, revisionId: entities[1].publicRevisionId });
  const resolved = await transition(h, operator, reviewing, { ...outcome, entityId: entity.id, revisionId: entity.publicRevisionId });
  await rejectUnchanged(h, operator, resolved, { note: 'Another case note', entityId: entities[1].id, revisionId: entities[1].publicRevisionId }, 409);
  const noted = await transition(h, operator, resolved, { note: 'A follow-up case note.' });
  assert.equal(noted.decisionCode, 'corrected');
  assert.equal(noted.entityId, entity.id);
  assert.equal(noted.revisionId, entity.publicRevisionId);
});

test('linked-existing intakes require public evidence while draft-created intakes may remain private', async t => {
  const { h, operator } = await fixture(t);
  const entities = h.store.read().modules.content.entities.filter(item => item.publicRevisionId);
  const entity = entities[0], draft = addDraft(h, entity);
  for (const type of ['question', 'material']) {
    const { record, session } = await createCase(h, operator, type);
    const screening = await transition(h, operator, record, { status: 'screening' });
    const outcome = { status: 'actioned', decisionCode: 'linked_existing', note: 'Reviewed case linked to its verified answer.', entityId: entity.id };
    await rejectUnchanged(h, operator, screening, { ...outcome, revisionId: draft.id });
    await rejectUnchanged(h, operator, screening, { ...outcome, decisionCode: 'rejected_insufficient', revisionId: entity.publicRevisionId });
    await rejectUnchanged(h, operator, screening, { ...outcome, decisionCode: 'draft_created', revisionId: entities[1].publicRevisionId });
    const decisionCode = type === 'question' ? 'linked_existing' : 'draft_created';
    const revisionId = type === 'question' ? entity.publicRevisionId : draft.id;
    const actioned = await transition(h, operator, screening, { ...outcome, decisionCode, revisionId });
    const noted = await transition(h, operator, actioned, { note: 'Private follow-up context.' });
    assert.equal(noted.revisionId, revisionId);
    assert.equal(noted.decisionCode, decisionCode);
    const own = await readJson(await h.get('/api/private/self', session.token));
    assert.deepEqual(own[0].result, h.business.lifecycle.workflows[type].publicResults[decisionCode]);
    assert.doesNotMatch(JSON.stringify(own), /Private follow-up|entityId|revisionId|payload/);
  }
  await readJson(await h.get(`/api/revisions/${draft.id}`), 404);
});

test('same-state case notes retain SDK authority, optimistic concurrency, and idempotency', async t => {
  const { h, operator } = await fixture(t);
  const { record, session } = await createCase(h, operator, 'question');
  const update = { note: 'A synthetic case note.' };
  const before = h.store.read();
  await readJson(await h.post('/api/private/command', command(record, update), session.token), 401);
  assert.deepEqual(h.store.read(), before);
  const key = 'same-state-case-note-replay';
  const noted = await transition(h, operator, record, update, key);
  const replayed = await transition(h, operator, record, update, key);
  assert.deepEqual(replayed, noted);
  assert.equal(privatePayload(h, record.id).internalNotes.length, 1);
  await rejectUnchanged(h, operator, record, { note: 'A stale second case note.' }, 409);
  await readJson(await h.post('/api/private/command', { action: 'withdraw' }, session.token));
  const purged = h.store.read().modules.lifecycle.records[record.id];
  await rejectUnchanged(h, operator, purged, { note: 'No notes after withdrawal.' }, 410);
});

test('elapsed retention prevents private case additions even before maintenance runs', async t => {
  const { h, operator } = await fixture(t);
  const { record } = await createCase(h, operator);
  h.setTime(record.expiresAt);
  const freshOperator = await h.operator(undefined, 'retention-reviewer');
  await rejectUnchanged(h, freshOperator, record, { note: 'No notes after retention.' }, 410);
});
