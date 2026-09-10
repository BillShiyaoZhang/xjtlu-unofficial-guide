import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { importContent, projectPublic, publishContent } from '@information-community/runtime';
import { buildHandbook } from '../scripts/build-handbook.mjs';
import { initializeDemo } from '../scripts/demo.mjs';
import { createStore, loadCommunity } from './helpers.mjs';

const readJson = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));

test('the readable handbook and platform bundle stay synchronized with the research inputs', async () => {
  const report = await buildHandbook({ check: true });
  const bundle = await readJson('../community/handbook/runtime-import.json');
  assert.equal(bundle.entities.filter(entity => entity.type === 'answer').length, report.cardCount);
  assert.equal(bundle.citations.length, report.citationCount);
  const sourceUrls = bundle.revisions.filter(revision => revision.data.mode).map(revision => revision.data.url);
  assert.equal(new Set(sourceUrls).size, report.citedSourceCount);
  const text = await readFile(new URL('../docs/handbook.md', import.meta.url), 'utf8');
  for (const card of report.cards) assert.ok(text.includes(`id="${card.id}"`), `missing readable card ${card.id}`);
  for (const [, anchor] of text.matchAll(/\]\(#([a-z0-9-]+)\)/gu)) assert.ok(text.includes(`id="${anchor}"`), `broken chapter link ${anchor}`);
});

test('first local initialization imports only the 76 handbook drafts without publishing demonstration content', async t => {
  const loaded = await loadCommunity(), store = createStore(loaded);
  t.after(() => store.close());
  const handbook = await readJson('../community/handbook/runtime-import.json');
  const drafts = handbook.revisions.filter(revision => revision.data.origin === 'ai_draft');
  assert.equal(drafts.length, 76);
  assert.deepEqual(loaded.bundle, handbook, 'the production seed contains only the unchanged handbook bundle');
  assert.equal(loaded.bundle.revisions.some(revision => revision.data.demo === true), false);
  assert.equal(initializeDemo(store, loaded.bundle), true);
  const before = store.read();
  const content = before.modules.content;
  assert.equal(projectPublic(content).nodes.length, 0);
  assert.equal(before.audit.some(entry => entry.action === 'demo.publish'), false);
  for (const draft of drafts) {
    assert.equal(draft.data.demo, false);
    assert.equal(draft.data.verifiedAt, '');
    assert.equal(draft.data.reviewStatus, 'pending-human-review');
    assert.equal(content.entities.find(entity => entity.id === draft.entityId).publicRevisionId, null);
  }
  assert.throws(() => publishContent(content, {
    entityId: drafts[0].entityId, revisionId: drafts[0].id, expectedVersion: 0,
    now: '2026-09-10T00:00:00Z',
  }), { code: 'POLICY_REJECTED' });
  assert.deepEqual(importContent(content, handbook), content, 'the identical first-import snapshot is idempotent');
  assert.equal(initializeDemo(store, loaded.bundle), false);
  assert.deepEqual(store.read(), before);
  const config = await readJson('../community/pages.config.json');
  assert.deepEqual(config.publishedRevisionIds, []);
  assert.deepEqual(config.sourceRevisionIds, []);
});
