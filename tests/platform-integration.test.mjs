import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  authenticateIdentity,
  hideContent,
  importContent,
  issueParticipantInvitation,
  readAnonymousReport,
  setSourceDisposition,
} from '@information-community/runtime';
import { createStore, harness, initialTime, readJson, repoRoot } from './helpers.mjs';

test('the consumer uses versioned installed packages, never adjacent platform source links', async () => {
  const lock = JSON.parse(await readFile(join(repoRoot, 'package-lock.json'), 'utf8'));
  for (const name of ['runtime', 'core']) {
    const version = name === 'runtime' ? '0.3.0' : '0.2.0';
    const directory = dirname(fileURLToPath(import.meta.resolve(`@information-community/${name}`)));
    const metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
    assert.equal(metadata.version, version);
    assert.equal((await lstat(directory)).isSymbolicLink(), false);
    const packagePath = relative(await realpath(join(repoRoot, 'node_modules')), await realpath(directory));
    assert.ok(packagePath !== '..' && !packagePath.startsWith(`..${sep}`), directory);
    const pinned = lock.packages[`node_modules/@information-community/${name}`];
    assert.equal(pinned.version, version);
    assert.equal(pinned.resolved, `file:vendor/information-community-${name}-${version}.tgz`);
    assert.match(pinned.integrity, /^sha512-/);
    assert.equal(pinned.link, undefined);
  }
});

test('campus data imports unpublished, then explicitly publishes with immutable cited revisions', async t => {
  const h = await harness(t);
  h.store.transact(state => { state.modules.content = importContent(state.modules.content, h.bundle); });
  assert.deepEqual(await readJson(await h.get('/api/list')), []);
  const expected = h.publish();
  const nodes = await readJson(await h.get('/api/list'));
  assert.deepEqual(nodes.map(node => node.id).sort(), expected.map(entity => entity.id).sort());
  for (const entity of expected) {
    const retained = h.store.read().modules.content.entities.find(item => item.id === entity.id);
    const revision = await readJson(await h.get(`/api/revisions/${retained.publicRevisionId}`));
    assert.equal(revision.id, entity.id);
    assert.equal(revision.revisionId, retained.publicRevisionId);
    const expectedCitations = h.bundle.citations.filter(item => item.revisionId === retained.publicRevisionId);
    assert.deepEqual(revision.citations.map(item => item.sourceRevisionId).sort(), expectedCitations.map(item => item.sourceRevisionId).sort());
    const history = await readJson(await h.get(`/api/entities/${entity.id}/history`));
    assert.deepEqual(history.map(item => item.revisionId), [retained.publicRevisionId]);
  }
  const before = h.store.read();
  const changed = structuredClone(h.bundle);
  changed.revisions[0].data.title = 'An attempted replacement of retained history';
  assert.throws(() => h.store.transact(state => {
    state.modules.content = importContent(state.modules.content, changed);
  }), { code: 'IMMUTABLE' });
  assert.deepEqual(h.store.read(), before);
});

async function assertUnavailable(h, entityId, revisionId) {
  const graph = await readJson(await h.get('/api/graph'));
  for (const path of ['/api/list', '/api/search']) {
    const nodes = await readJson(await h.get(path));
    assert.equal(nodes.some(node => node.id === entityId), false, path);
  }
  assert.equal(graph.nodes.some(node => node.id === entityId), false);
  await readJson(await h.get(`/api/entities/${entityId}`), 404);
  await readJson(await h.get(`/api/entities/${entityId}/history`), 404);
  await readJson(await h.get(`/api/revisions/${revisionId}`), 404);
  const exported = await readJson(await h.get('/api/export'));
  assert.equal(exported.revisions.some(revision => revision.revisionId === revisionId), false);
  const analysis = await readJson(await h.get('/api/analysis'));
  assert.equal(analysis.nodes, graph.nodes.length);
  assert.equal(analysis.hubs.some(hub => hub.id === entityId), false);
  const visible = graph.nodes[0];
  assert.ok(visible, 'The control answer remains visible');
  const neighborhood = await readJson(await h.get(`/api/neighborhood?id=${encodeURIComponent(visible.id)}&depth=5`));
  assert.equal(neighborhood.nodes.some(node => node.id === entityId), false);
}

test('link-only rights expire at the exact boundary across every consumer public projection', async t => {
  const expiresAt = '2099-01-01T00:00:00Z';
  let sourceRevisionId;
  const h = await harness(t, { mutateBundle(bundle) {
    const source = bundle.revisions.find(revision => revision.data.mode === 'link-only');
    assert.ok(source, 'Campus demo contains link-only evidence');
    source.data.rights = { expiresAt };
    sourceRevisionId = source.id;
  } });
  h.publish();
  const citation = h.bundle.citations.find(item => item.sourceRevisionId === sourceRevisionId);
  const revision = h.bundle.revisions.find(item => item.id === citation.revisionId);
  h.setTime(Date.parse(expiresAt) - 1);
  await readJson(await h.get(`/api/revisions/${revision.id}`));
  h.setTime(Date.parse(expiresAt));
  await assertUnavailable(h, revision.entityId, revision.id);
  assert.equal(h.store.read().modules.content.revisions.find(item => item.id === sourceRevisionId).data.mode, 'link-only');
});

test('withdrawn sources suppress dependent current pages, history, exports and graph views immediately', async t => {
  const h = await harness(t);
  h.publish();
  const citation = h.bundle.citations[0];
  const revision = h.bundle.revisions.find(item => item.id === citation.revisionId);
  h.store.transact(state => {
    const source = state.modules.content.entities.find(entity => entity.id === citation.sourceEntityId);
    state.modules.content = setSourceDisposition(state.modules.content, {
      entityId: source.id, expectedVersion: source.version, disposition: 'withdrawn',
    });
  });
  await assertUnavailable(h, revision.entityId, revision.id);
});

async function createQuestion(h, session, id) {
  const workflow = h.business.lifecycle.workflows.question;
  const consent = await readJson(await h.post('/api/private/command', {
    action: 'consent', type: 'question', version: workflow.consentVersion, accepted: true,
  }, session.token));
  return readJson(await h.post('/api/private/command', {
    action: 'create', type: 'question', id, consentEpoch: consent.consentEpoch,
    payload: { question: 'SYNTHETIC_PRIVATE_QUESTION', contact: 'synthetic@example.invalid' },
  }, session.token));
}

test('invited campus participants have self-service only; logout preserves enrollment and withdrawal erases it', async t => {
  const h = await harness(t);
  const operator = await h.operator();
  const first = await h.enroll(operator.token);
  const second = await h.enroll(operator.token, first.principal.id);
  const other = await h.enroll(operator.token);
  assert.equal(first.principal.mfa, false);
  assert.equal(first.principal.assurance, 'invitation');
  const used = await h.post('/api/participants/redeem', { token: first.invitation.token }, undefined, null);
  await readJson(used, 401);
  const record = await createQuestion(h, first, 'integration-question-mine');
  await createQuestion(h, other, 'integration-question-other');
  const workflow = h.business.lifecycle.workflows.question;
  const screening = await readJson(await h.post('/api/private/command', {
    action: 'transition', id: record.id, expectedVersion: record.version,
    status: workflow.transitions[record.status][0], note: 'SYNTHETIC_INTERNAL_NOTE',
    assignee: 'integration-private-assignee',
  }, operator.token));
  const summaries = await readJson(await h.get('/api/private/self', first.token));
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].id, record.id);
  assert.equal(summaries[0].status, screening.status);
  assert.doesNotMatch(JSON.stringify(summaries), /SYNTHETIC_PRIVATE|SYNTHETIC_INTERNAL|private-assignee|question-other|payload|decisionCode|subjectId/);
  for (const path of ['/api/private/list', `/api/private/${record.id}`]) await readJson(await h.get(path, first.token), 401);
  await readJson(await h.post('/api/private/command', {
    action: 'transition', id: record.id, expectedVersion: screening.version, status: screening.status,
  }, first.token), 401);
  await readJson(await h.post('/api/private/command', {
    action: 'create', type: 'question', subjectId: other.principal.id, consentEpoch: 1, payload: {},
  }, first.token), 403);
  await readJson(await h.post('/api/private/command', { action: 'logout' }, first.token));
  await readJson(await h.get('/api/private/self', first.token), 401);
  assert.equal((await readJson(await h.get('/api/private/self', second.token))).length, 1);
  assert.equal(h.store.read().modules.lifecycle.subjects[first.principal.id].withdrawnAt, null);
  const backup = h.store.backup();
  await readJson(await h.post('/api/private/command', { action: 'withdraw' }, second.token));
  await readJson(await h.get('/api/private/self', second.token), 401);
  const erased = h.store.read().modules.lifecycle.records[record.id];
  assert.equal(erased.payload, null);
  assert.equal(erased.subjectId, null);
  assert.equal(Object.values(h.store.read().idempotency).some(item => item.subjectId === first.principal.id), false);
  assert.throws(() => h.store.transact(state => issueParticipantInvitation(state, {
    subjectId: first.principal.id, eligibility: {},
  }, { config: h.business.participants, now: h.time() })), { code: 'SUBJECT_REVOKED' });
  const restored = createStore(h);
  t.after(() => restored.close());
  restored.restore(backup, {
    now: h.time(), withdrawnSubjectIds: [first.principal.id], revokedSubjectIds: [],
  });
  assert.equal(restored.read().modules.lifecycle.records[record.id].payload, null);
  for (const session of [first, second, other]) assert.throws(() => restored.transact(state =>
    authenticateIdentity(state, session.token, { participantsConfig: h.business.participants, now: h.time() })), { code: 'UNAUTHENTICATED' });
});

test('anonymous privacy reports use bounded fields and opaque status receipts, never general private access', async t => {
  const h = await harness(t);
  const fields = h.business.anonymousReports.fields;
  const input = Object.fromEntries(Object.keys(fields).map(field => [field, `SYNTHETIC_PRIVATE_${field}`]));
  const before = h.store.read();
  await readJson(await h.post('/api/reports', { ...input, roles: 'operations_admin' }, undefined, null), 400);
  assert.deepEqual(h.store.read(), before);
  const key = randomBytes(32).toString('base64url');
  const receipt = await readJson(await h.post('/api/reports', input, undefined, key));
  assert.deepEqual(Object.keys(receipt).sort(), ['expiresAt', 'receipt']);
  assert.deepEqual(await readJson(await h.post('/api/reports', input, undefined, key)), receipt);
  assert.equal(Object.keys(h.store.read().modules.lifecycle.records).length, 1);
  assert.doesNotMatch(JSON.stringify(h.store.read()), /SYNTHETIC_PRIVATE_/);
  assert.equal(JSON.stringify(h.store.read()).includes(receipt.receipt), false);
  const status = await readJson(await h.get('/api/reports/status', receipt.receipt));
  assert.deepEqual(Object.keys(status).sort(), ['createdAt', 'expiresAt', 'result', 'status', 'updatedAt']);
  const operator = await h.operator();
  const record = Object.values(h.store.read().modules.lifecycle.records)[0];
  const workflow = h.business.lifecycle.workflows[h.business.anonymousReports.type];
  const reviewing = await readJson(await h.post('/api/private/command', {
    action: 'transition', id: record.id, expectedVersion: record.version,
    status: workflow.transitions[record.status][0],
    note: 'SYNTHETIC_REVIEWER_NOTE', assignee: 'integration-report-assignee',
  }, operator.token));
  const terminal = workflow.transitions[reviewing.status].find(value => workflow.terminalStates.includes(value));
  const decision = Object.keys(workflow.publicResults)[0];
  assert.ok(terminal && decision, 'Privacy report has a reviewed public outcome');
  await readJson(await h.post('/api/private/command', {
    action: 'transition', id: record.id, expectedVersion: reviewing.version,
    status: terminal, decisionCode: decision,
  }, operator.token));
  const resolved = await readJson(await h.get('/api/reports/status', receipt.receipt));
  assert.deepEqual(resolved.result, workflow.publicResults[decision]);
  assert.doesNotMatch(JSON.stringify(resolved), /SYNTHETIC_|report-assignee|payload|subjectId|decisionCode/);
  for (const path of ['/api/private/list', '/api/private/self']) await readJson(await h.get(path, receipt.receipt), 401);
  await readJson(await h.post('/api/private/command', { action: 'create', type: 'question', payload: {} }, receipt.receipt), 401);
  const restored = createStore(h);
  t.after(() => restored.close());
  restored.restore(h.store.backup(), { now: initialTime, withdrawnSubjectIds: [], revokedSubjectIds: [] });
  assert.throws(() => readAnonymousReport(restored.read(), receipt.receipt, {
    config: h.business.anonymousReports, lifecycleConfig: h.business.lifecycle, now: initialTime,
  }), { code: 'NOT_FOUND' });
  h.setTime(receipt.expiresAt - 1);
  await readJson(await h.get('/api/reports/status', receipt.receipt));
  h.setTime(receipt.expiresAt);
  await readJson(await h.get('/api/reports/status', receipt.receipt), 404);
});

test('guide display routes enrich only platform-visible answers and preserve revision ownership', async t => {
  const h = await harness(t, { guide: true });
  h.publish();
  assert.deepEqual(await readJson(await h.get('/api/guide/catalog')), h.catalog);
  const answers = await readJson(await h.get('/api/guide/answers'));
  const answerTypes = new Set(h.business.content.entityTypes.filter(type => type.role === 'content').map(type => type.id));
  assert.equal(answers.length, h.bundle.entities.filter(entity => answerTypes.has(entity.type) && h.bundle.revisions.some(revision => revision.entityId === entity.id && revision.data.demo === true)).length);
  const answer = answers[0];
  assert.ok(answer.slug && answer.topic?.title);
  assert.equal(answer.slug, h.bundle.entities.find(entity => entity.id === answer.id).extensions.slug);
  const detail = await readJson(await h.get(`/api/guide/answers/${answer.slug}?revision=${answer.revisionId}`));
  assert.equal(detail.id, answer.id);
  assert.equal(detail.revisionId, answer.revisionId);
  assert.deepEqual(detail.history.map(item => item.id), [answer.revisionId]);
  await readJson(await h.get(`/api/guide/answers/${answer.slug}?revision=${answers[1].revisionId}`), 404);
  await readJson(await h.get(`/api/guide/answers?scope=${encodeURIComponent('{"unconfigured":["x"]}')}`), 400);
  const sourceId = detail.citations[0].sourceEntityId;
  h.store.transact(state => {
    const source = state.modules.content.entities.find(item => item.id === sourceId);
    state.modules.content = setSourceDisposition(state.modules.content, {
      entityId: sourceId, expectedVersion: source.version, disposition: 'withdrawn',
    });
  });
  const after = await readJson(await h.get('/api/guide/answers'));
  assert.equal(after.some(item => item.id === answer.id), false);
  await readJson(await h.get(`/api/guide/answers/${answer.slug}`), 404);
  await readJson(await h.get(`/api/guide/answers/${answer.slug}?revision=${answer.revisionId}`), 404);
});

test('pilot operators issue reviewed invitations without private-review or named-account authority', async t => {
  const h = await harness(t, { guide: true });
  h.publish();
  const pilot = await h.operator(['pilot_operator'], 'integration-pilot');
  await readJson(await h.get('/api/private/list', pilot.token), 403);
  await readJson(await h.post('/api/participants/invitations', {
    eligibility: { adult: true, eligible: true },
  }, pilot.token), 403);
  const before = h.store.read();
  await readJson(await h.post('/api/guide/invitations', {
    eligibility: { adult: false, eligible: true },
  }, pilot.token), 403);
  assert.deepEqual(h.store.read(), before);
  const invitation = await readJson(await h.post('/api/guide/invitations', {
    eligibility: { adult: true, eligible: true },
  }, pilot.token), 201);
  const session = await readJson(await h.post('/api/participants/redeem', { token: invitation.token }, undefined, null));
  const cardId = h.store.read().modules.content.entities.find(entity => entity.publicRevisionId).id;
  await readJson(await h.post('/api/private/command', {
    action: 'create', type: 'report', payload: { type: 'stale', cardId },
  }, session.token), 403);
  const workflow = h.business.lifecycle.workflows.question;
  const consent = await readJson(await h.post('/api/private/command', {
    action: 'consent', type: 'question', accepted: true, version: workflow.consentVersion,
  }, session.token));
  const beforePrivate = h.store.read();
  await readJson(await h.post('/api/private/command', {
    action: 'create', type: 'question', consentEpoch: consent.consentEpoch,
    payload: { body: 'Contact synthetic@example.invalid', contextScope: 'Synthetic campus context' },
  }, session.token), 400);
  assert.deepEqual(h.store.read(), beforePrivate);
  const question = await readJson(await h.post('/api/private/command', {
    action: 'create', type: 'question', consentEpoch: consent.consentEpoch,
    payload: { body: 'Where is the verified service entry?', contextScope: 'Synthetic campus context' },
  }, session.token));
  assert.equal(question.type, 'question');
  const own = await readJson(await h.get('/api/private/self', session.token));
  assert.equal(own[0].id, question.id);
  const report = await readJson(await h.post('/api/private/command', {
    action: 'create', type: 'report', consentEpoch: consent.consentEpoch,
    payload: { type: 'stale', cardId },
  }, session.token));
  assert.equal(report.type, 'report');
  await readJson(await h.post('/api/private/command', {
    action: 'create', type: 'report', consentEpoch: consent.consentEpoch,
    payload: { type: 'privacy', cardId },
  }, session.token), 400);
  await readJson(await h.post('/api/guide/invitations', {
    eligibility: { adult: true, eligible: true },
  }, session.token), 401);
});

test('guide anonymous intake accepts privacy reports only, with a bounded configured affected area', async t => {
  const h = await harness(t, { guide: true });
  const before = h.store.read();
  for (const input of [
    { type: 'stale', affectedArea: 'search' },
    { type: 'privacy', affectedArea: 'unconfigured-area' },
    { type: 'privacy' },
    { type: 'privacy', affectedArea: 'search', internalNotes: 'not allowed' },
  ]) {
    await readJson(await h.post('/api/reports', input, undefined, null), 400);
    assert.deepEqual(h.store.read(), before);
  }
  const receipt = await readJson(await h.post('/api/reports', {
    type: 'privacy', affectedArea: 'search',
  }, undefined, randomBytes(32).toString('base64url')), 201);
  const status = await readJson(await h.get('/api/reports/status', receipt.receipt));
  assert.deepEqual(Object.keys(status).sort(), ['createdAt', 'expiresAt', 'result', 'status', 'updatedAt']);
  assert.equal(Object.values(h.store.read().modules.lifecycle.records)[0].type, 'privacy_report');
});

test('a private intake may produce an unpublished draft without making that draft or internal outcome public', async t => {
  const h = await harness(t, { guide: true });
  h.publish();
  const operator = await h.operator();
  const session = await h.enroll(operator.token);
  const workflow = h.business.lifecycle.workflows.question;
  const consent = await readJson(await h.post('/api/private/command', {
    action: 'consent', type: 'question', version: workflow.consentVersion, accepted: true,
  }, session.token));
  const record = await readJson(await h.post('/api/private/command', {
    action: 'create', type: 'question', consentEpoch: consent.consentEpoch,
    payload: { body: 'A synthetic question awaiting editorial work.', contextScope: 'Synthetic campus context' },
  }, session.token));
  const screening = await readJson(await h.post('/api/private/command', {
    action: 'transition', id: record.id, expectedVersion: record.version, status: 'screening',
  }, operator.token));
  const entity = h.store.read().modules.content.entities.find(item => item.publicRevisionId);
  const draft = structuredClone(h.bundle.revisions.find(item => item.id === entity.publicRevisionId));
  draft.parentRevisionId = draft.id;
  draft.id = `${draft.id}-integration-draft`;
  draft.number += 1;
  draft.data.title = 'Synthetic unpublished editorial draft';
  const citations = h.bundle.citations.filter(item => item.revisionId === draft.parentRevisionId).map(item => ({
    ...structuredClone(item), id: `${item.id}-integration-draft`, revisionId: draft.id,
  }));
  h.store.transact(state => {
    state.modules.content = importContent(state.modules.content, {
      schemaVersion: 1, entities: [], revisions: [draft], citations, links: [],
    });
  });
  const transition = {
    action: 'transition', id: record.id, expectedVersion: screening.version, status: 'actioned',
    decisionCode: 'draft_created', entityId: entity.id, revisionId: draft.id,
  };
  const before = h.store.read();
  await readJson(await h.post('/api/private/command', transition, operator.token), 400);
  assert.deepEqual(h.store.read(), before);
  await readJson(await h.post('/api/private/command', {
    ...transition, note: 'SYNTHETIC_INTERNAL_EDITORIAL_REASON',
  }, operator.token));
  const own = await readJson(await h.get('/api/private/self', session.token));
  assert.deepEqual(own[0].result, workflow.publicResults.draft_created);
  assert.doesNotMatch(JSON.stringify(own), /SYNTHETIC_INTERNAL|payload|entityId|revisionId/);
  await readJson(await h.get(`/api/revisions/${draft.id}`), 404);
  const publicResults = await readJson(await h.get('/api/public-results'));
  assert.deepEqual(publicResults, []);
  const exported = await readJson(await h.get('/api/export'));
  assert.equal(exported.revisions.some(item => item.revisionId === draft.id), false);
});

async function consentFor(h, session, type) {
  const workflow = h.business.lifecycle.workflows[type];
  return readJson(await h.post('/api/private/command', {
    action: 'consent', type, version: workflow.consentVersion, accepted: true,
  }, session.token));
}

test('material intake rejects missing provenance, private source addresses and contact details in context', async t => {
  const h = await harness(t, { guide: true });
  const operator = await h.operator();
  const session = await h.enroll(operator.token);
  const consent = await consentFor(h, session, 'material');
  const valid = {
    body: 'A synthetic description of a campus service source.',
    contextScope: 'Synthetic campus context',
    sourceUrl: 'https://www.xjtlu.edu.cn/en/current-students',
    provenanceRole: 'lead_only',
  };
  const { provenanceRole, ...missingProvenance } = valid;
  const beforeUnauthenticated = h.store.read();
  await readJson(await h.post('/api/private/command', {
    action: 'create', type: 'material', payload: { internalNotes: 'not an allowed submission field' },
  }), 401);
  assert.deepEqual(h.store.read(), beforeUnauthenticated);
  const cases = [
    ['missing provenance', missingProvenance],
    ['unconfigured provenance', { ...valid, provenanceRole: 'unconfigured' }],
    ['loopback address', { ...valid, sourceUrl: 'http://127.0.0.1/notes' }],
    ['private address', { ...valid, sourceUrl: 'http://10.0.0.1/notes' }],
    ['local IPv6 address', { ...valid, sourceUrl: 'http://[::1]/notes' }],
    ['private IPv6 address', { ...valid, sourceUrl: 'http://[fd00::1]/notes' }],
    ['internal hostname', { ...valid, sourceUrl: 'https://services.internal/notes' }],
    ['encoded URL contact', { ...valid, sourceUrl: 'https://www.xjtlu.edu.cn/help?contact=synthetic%40example.invalid' }],
    ['context contact', { ...valid, contextScope: 'Contact synthetic@example.invalid' }],
  ];
  for (const [name, payload] of cases) await t.test(name, async () => {
    const before = h.store.read();
    await readJson(await h.post('/api/private/command', {
      action: 'create', type: 'material', consentEpoch: consent.consentEpoch, payload,
    }, session.token), 400);
    assert.deepEqual(h.store.read(), before);
  });
  const material = await readJson(await h.post('/api/private/command', {
    action: 'create', type: 'material', consentEpoch: consent.consentEpoch, payload: valid,
  }, session.token));
  assert.equal(material.type, 'material');
  const urlOnly = await readJson(await h.post('/api/private/command', {
    action: 'create', type: 'material', consentEpoch: consent.consentEpoch,
    payload: { sourceUrl: valid.sourceUrl, contextScope: valid.contextScope, provenanceRole },
  }, session.token));
  assert.equal(urlOnly.type, 'material');
});

test('anonymous privacy reports require an existing public answer when a card target is supplied', async t => {
  const h = await harness(t, { guide: true });
  h.publish();
  const key = () => randomBytes(32).toString('base64url');
  const before = h.store.read();
  await readJson(await h.post('/api/reports', {
    type: 'privacy', cardId: 'nonexistent-synthetic-answer',
  }, undefined, key()), 404);
  assert.deepEqual(h.store.read(), before);
  const entity = h.store.read().modules.content.entities.find(item => item.publicRevisionId);
  const receipt = await readJson(await h.post('/api/reports', {
    type: 'privacy', cardId: entity.id,
  }, undefined, key()), 201);
  assert.match(receipt.receipt, /^[A-Za-z0-9_-]{43}$/);
  h.store.transact(state => {
    state.modules.content = hideContent(state.modules.content, { entityId: entity.id, expectedVersion: entity.version });
  });
  const hidden = h.store.read();
  await readJson(await h.post('/api/reports', {
    type: 'privacy', cardId: entity.id, affectedArea: 'search',
  }, undefined, key()), 404);
  assert.deepEqual(h.store.read(), hidden);
  await readJson(await h.post('/api/reports', {
    type: 'privacy', affectedArea: 'search',
  }, undefined, key()), 201);
});

test('research events use fixed enums, owned active query references and observed public revisions', async t => {
  const h = await harness(t, { guide: true });
  h.publish();
  const operator = await h.operator();
  const session = await h.enroll(operator.token);
  const other = await h.enroll(operator.token);
  const consent = await consentFor(h, session, 'research_event');
  const otherConsent = await consentFor(h, other, 'research_event');
  const answers = h.store.read().modules.content.entities.filter(entity => entity.publicRevisionId);
  const revisionId = answers[0].publicRevisionId;
  const createEvent = (payload, active = session, epoch = consent.consentEpoch) => h.post('/api/private/command', {
    action: 'create', type: 'research_event', consentEpoch: epoch, payload,
  }, active.token);
  const query = await readJson(await createEvent({ kind: 'query', queryLengthBand: 'short' }));
  const foreignQuery = await readJson(await createEvent({ kind: 'query', queryLengthBand: 'medium' }, other, otherConsent.consentEpoch));
  const invalid = [
    ['unknown event kind', { kind: 'unconfigured' }, 400],
    ['free-text query length', { kind: 'query', queryLengthBand: 'A private search phrase' }, 400],
    ['missing query reference', { kind: 'open', revisionId }, 400],
    ['unknown feedback outcome', { kind: 'feedback', queryEventId: query.id, revisionId, outcome: 'unconfigured' }, 400],
    ['foreign query', { kind: 'open', queryEventId: foreignQuery.id, revisionId }, 403],
    ['missing query', { kind: 'open', queryEventId: 'nonexistent-query', revisionId }, 403],
    ['missing revision', { kind: 'open', queryEventId: query.id, revisionId: 'nonexistent-revision' }, 404],
    ['share before open', { kind: 'share', queryEventId: query.id, revisionId }, 403],
    ['feedback before open', { kind: 'feedback', queryEventId: query.id, revisionId, outcome: 'resolved' }, 403],
  ];
  for (const [name, payload, status] of invalid) await t.test(name, async () => {
    const before = h.store.read();
    await readJson(await createEvent(payload), status);
    assert.deepEqual(h.store.read(), before);
  });
  const opened = await readJson(await createEvent({ kind: 'open', queryEventId: query.id, revisionId }));
  const beforeUnopenedRevision = h.store.read();
  await readJson(await createEvent({ kind: 'share', queryEventId: query.id, revisionId: answers[1].publicRevisionId }), 403);
  assert.deepEqual(h.store.read(), beforeUnopenedRevision);
  const beforeNonQuery = h.store.read();
  await readJson(await createEvent({ kind: 'open', queryEventId: opened.id, revisionId }), 403);
  assert.deepEqual(h.store.read(), beforeNonQuery);
  const shared = await readJson(await createEvent({ kind: 'share', queryEventId: query.id, revisionId }));
  assert.equal(shared.type, 'research_event');
  const feedback = await readJson(await createEvent({ kind: 'feedback', queryEventId: query.id, revisionId, outcome: 'resolved' }));
  assert.equal(feedback.type, 'research_event');
  h.store.transact(state => {
    state.modules.content = hideContent(state.modules.content, {
      entityId: answers[0].id, expectedVersion: answers[0].version,
    });
  });
  const beforeHidden = h.store.read();
  await readJson(await createEvent({ kind: 'open', queryEventId: query.id, revisionId }), 404);
  assert.deepEqual(h.store.read(), beforeHidden);
  h.setTime(query.expiresAt);
  const invitation = h.store.transact(state => issueParticipantInvitation(state, {
    subjectId: session.principal.id, eligibility: session.principal.eligibility,
  }, { config: h.business.participants, now: h.time() }));
  const renewed = await readJson(await h.post('/api/participants/redeem', { token: invitation.token }, undefined, null));
  const beforeExpired = h.store.read();
  await readJson(await createEvent({ kind: 'open', queryEventId: query.id, revisionId: answers[1].publicRevisionId }, renewed), 403);
  assert.deepEqual(h.store.read(), beforeExpired);
  const freshQuery = await readJson(await createEvent({ kind: 'query', queryLengthBand: 'long' }, renewed));
  assert.equal(freshQuery.type, 'research_event');
});
