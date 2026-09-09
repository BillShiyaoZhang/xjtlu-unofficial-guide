import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

if (!process.env.PLATFORM_ROOT) {
  throw new Error('Set PLATFORM_ROOT to the decentralized-information-community checkout.');
}

const sdk = await import(pathToFileURL(resolve(
  process.env.PLATFORM_ROOT, 'packages/runtime/index.mjs',
)).href);
const {
  RuntimeStore, contentModule, importContent, publishContent,
  projectPublic, readPublicRevision, publicContentExport,
} = sdk;

const before = '2098-12-31T23:59:59Z';
const expiresAt = '2099-01-01T00:00:00Z';
const originalRecord = {
  id: 'source-v1', rights_mode: 'link_only', visibility: 'public',
  rights_expires_at: Date.parse(expiresAt) / 1000,
  archived_text: null, content_hash: null,
};
const bundle = {
  schemaVersion: 1,
  entities: [{ id: 'source', type: 'source' }, { id: 'answer', type: 'document' }],
  revisions: [
    {
      id: 'source-v1', entityId: 'source', number: 1,
      parentRevisionId: null, createdAt: '2026-09-09T00:00:00Z',
      data: { title: 'Synthetic source', url: 'https://example.org/source', mode: 'link-only' },
    },
    {
      id: 'answer-v1', entityId: 'answer', number: 1,
      parentRevisionId: null, createdAt: '2026-09-09T00:00:00Z',
      data: {
        title: 'Synthetic answer',
        sentences: [{ id: 'fact', kind: 'fact', text: 'A synthetic fact.' }],
      },
    },
  ],
  citations: [{
    id: 'citation', revisionId: 'answer-v1', sentenceId: 'fact',
    sourceEntityId: 'source', sourceRevisionId: 'source-v1',
    position: { kind: 'link' }, order: 0,
  }],
};

function observe(metadata) {
  const store = new RuntimeStore(':memory:', {
    communityId: 'link-expiry-probe', modules: [contentModule],
  });
  try {
    const mapped = structuredClone(bundle);
    Object.assign(mapped.revisions[0].data, metadata);
    try {
      store.transact(state => {
        state.modules.content = importContent(state.modules.content, mapped);
      });
    } catch (error) {
      assert.equal(store.read().revision, 0);
      return { imported: false, code: error.code, message: error.message, rolledBack: true };
    }
    store.transact(state => {
      state.modules.content = publishContent(state.modules.content, {
        entityId: 'answer', revisionId: 'answer-v1', expectedVersion: 0, now: before,
      });
    });
    const data = store.read().modules.content;
    const visibilityAt = now => ({
      listCount: projectPublic(data, { now }).nodes.length,
      revisionVisible: readPublicRevision(data, 'answer-v1', { now }) !== null,
      exportedRevisionCount: publicContentExport(data, { now }).revisions.length,
    });
    return { imported: true, before: visibilityAt(before), atExpiry: visibilityAt(expiresAt) };
  } finally {
    store.close();
  }
}

console.log(JSON.stringify({
  probe: 'link-only-rights-expiry',
  originalRecord,
  // The guide applies rights_expires_at to link-only references in repository.ts.
  expected: { beforeVisible: true, atExpiryVisible: false },
  mappedRightsExpiresAt: observe({ rightsExpiresAt: expiresAt }),
  mappedRightsObject: observe({ rights: { expiresAt } }),
  expiryOmitted: observe({}),
}, null, 2));
