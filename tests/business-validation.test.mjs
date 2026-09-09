import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { hideContent } from '@information-community/runtime';
import {
  containsLikelyPersonalData, isSafePublicUrl, validateGuideCreate, validateGuideAnonymousReport,
} from '../server/business-validation.mjs';
import { startGuide } from '../server/guide.mjs';
import { createStore, initialTime, loadCommunity, publishDemo, syntheticResearch } from './helpers.mjs';

const rejected = code => error => error.code === code;
const create = (type, payload, extra = {}) => ({ action: 'create', type, payload, ...extra });
const validMaterial = { contextScope: 'Synthetic campus context', sourceUrl: 'https://example.org/guide', provenanceRole: 'lead_only' };

test('material URL policy rejects private hosts, normalized address variants and credentials without fetching', () => {
  for (const value of [
    'http://localhost/', 'http://LOCALHOST./', 'http://service.local/', 'http://service.internal./',
    'http://intranet/', 'http://127.0.0.1/', 'http://2130706433/', 'http://0x7f000001/',
    'http://10.2.3.4/', 'http://172.16.0.1/', 'http://192.168.1.2/', 'http://169.254.1.2/',
    'http://100.64.0.1/', 'http://198.18.0.1/', 'http://224.0.0.1/',
    'http://[::1]/', 'http://[fc00::1]/', 'http://[fe80::1]/', 'http://[::ffff:127.0.0.1]/',
    'https://name:secret@example.org/', 'file:///private', 'javascript:alert(1)',
  ]) assert.equal(isSafePublicUrl(value), false, value);
  for (const value of ['https://example.org/path', 'https://www.xjtlu.edu.cn/', 'https://8.8.8.8/', 'https://[2001:4860:4860::8888]/']) assert.equal(isSafePublicUrl(value), true, value);
});

test('legacy personal-data policy covers contacts, student numbers and identity numbers', () => {
  for (const value of ['synthetic.person@example.test', '+86 13800138000', 'student 12345678', '11010119900101123X']) assert.equal(containsLikelyPersonalData(value), true);
  assert.equal(containsLikelyPersonalData('A campus question recorded on 2026-09-09.'), false);
});

test('material provenance is mandatory while a public link can replace the optional body', () => {
  for (const provenanceRole of ['original_author', 'reteller', 'lead_only']) {
    assert.doesNotThrow(() => validateGuideCreate(create('material', { ...validMaterial, provenanceRole }), {}));
    assert.doesNotThrow(() => validateGuideCreate(create('material', { contextScope: 'Campus', body: 'A material description', provenanceRole }), {}));
  }
  for (const payload of [
    { ...validMaterial, provenanceRole: undefined }, { ...validMaterial, provenanceRole: 'unconfigured' },
    { contextScope: 'Campus', provenanceRole: 'lead_only' },
    { ...validMaterial, contextScope: '' }, { ...validMaterial, sourceUrl: 'http://127.0.0.1/' },
    { ...validMaterial, sourceUrl: 'https://example.org/%zz' },
  ]) assert.throws(() => validateGuideCreate(create('material', payload), {}), rejected('GUIDE_FIELD'));
});

test('intake screening covers all text fields and decoded source URLs and keeps legacy length bounds', () => {
  for (const patch of [
    { contextScope: 'synthetic.person@example.test' }, { body: 'Contact 13800138000 for details' },
    { sourceUrl: 'https://example.org/?email=synthetic.person%40example.test' },
    { sourceUrl: 'https://example.org/?email=synthetic.person%2540example.test' },
    { sourceUrl: 'https://example.org/?email=synthetic.person%252540example.test' },
    { sourceUrl: 'https://example.org/?student=12345678' },
  ]) assert.throws(() => validateGuideCreate(create('material', { ...validMaterial, ...patch }), {}), rejected('PERSONAL_DATA'));
  const question = { body: 'A meaningful synthetic question', contextScope: 'Campus' };
  assert.doesNotThrow(() => validateGuideCreate(create('question', question), {}));
  for (const patch of [{ body: 'too short' }, { body: 'x'.repeat(1501) }, { contextScope: 'x'.repeat(161) }]) assert.throws(() => validateGuideCreate(create('question', { ...question, ...patch }), {}), rejected('GUIDE_FIELD'));
  assert.throws(() => validateGuideCreate(create('question', question, { entityId: 'arbitrary-target' }), {}), rejected('GUIDE_FIELD'));
});

test('query events contain a fixed length category rather than caller-provided text or identity', () => {
  const options = { business: { research: syntheticResearch }, now: initialTime };
  for (const queryLengthBand of ['short', 'medium', 'long']) assert.doesNotThrow(() => validateGuideCreate(create('research_event', { kind: 'query', queryLengthBand }), options));
  for (const payload of [
    { kind: 'arbitrary', queryLengthBand: 'short' }, { kind: 'query', queryLengthBand: 'A raw question' },
    { kind: 'query' }, { kind: 'query', queryLengthBand: 'short', text: 'A raw question' },
    { kind: 'query', queryLengthBand: 'short', queryEventId: 'caller-chosen-context' },
  ]) assert.throws(() => validateGuideCreate(create('research_event', payload), options), rejected('GUIDE_FIELD'));
  assert.throws(() => validateGuideCreate(create('research_event', { kind: 'query', queryLengthBand: 'short' }, { id: 'caller-chosen-id' }), options), rejected('GUIDE_FIELD'));
});

test('anonymous targets use platform visibility and a supplied invalid card cannot be rescued by a valid area', async () => {
  const community = await loadCommunity(), store = createStore(community);
  try {
    const [card] = publishDemo(store, community.bundle);
    const context = { state: store.read(), now: initialTime };
    assert.doesNotThrow(() => validateGuideAnonymousReport({ type: 'privacy', cardId: card.id }, context));
    assert.doesNotThrow(() => validateGuideAnonymousReport({ type: 'privacy', affectedArea: 'search' }, context));
    assert.throws(() => validateGuideAnonymousReport({ type: 'privacy', cardId: 'missing', affectedArea: 'search' }, context), rejected('NOT_FOUND'));
    const current = context.state.modules.content.entities.find(item => item.id === card.id);
    context.state.modules.content = hideContent(context.state.modules.content, { entityId: card.id, expectedVersion: current.version });
    assert.throws(() => validateGuideAnonymousReport({ type: 'privacy', cardId: card.id }, context), rejected('NOT_FOUND'));
    assert.throws(() => validateGuideAnonymousReport({ type: 'privacy', affectedArea: 'search', message: 'Not accepted' }, context), rejected('GUIDE_FIELD'));
  } finally { store.close(); }
});

test('incomplete migration marker prevents opening a community before config or keys are read', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'guide-incomplete-migration-'));
  try {
    await writeFile(join(directory, '.migration-incomplete'), 'synthetic incomplete restore');
    await assert.rejects(startGuide({ root: directory, env: {} }), /Migration is incomplete/);
    assert.equal(await readFile(join(directory, '.migration-incomplete'), 'utf8'), 'synthetic incomplete restore');
  } finally {
    const target = resolve(directory), rel = relative(resolve(tmpdir()), target);
    assert.ok(basename(target).startsWith('guide-incomplete-migration-') && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel));
    await rm(target, { recursive: true, force: true });
  }
});
