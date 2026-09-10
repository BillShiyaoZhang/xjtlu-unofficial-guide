import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, stat, rm, mkdir, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { openRuntime, projectPublic, importContent, bootstrapAccount, inspectAccountsOffline, login, totpCode } from '@information-community/runtime';
import { initializeDemo } from '../scripts/demo.mjs';
import { restoreMigration } from '../scripts/restore-migration.mjs';
import { recordReview } from '../server/content-review.mjs';
import { loadCommunity, createStore, communityRoot, publishDemo } from './helpers.mjs';

async function migrationFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'guide-restore-'));
  t.after(async () => {
    const absolute = resolve(directory), base = resolve(tmpdir()) + sep;
    assert.ok(absolute.startsWith(base) && absolute.includes('guide-restore-'));
    await rm(absolute, { recursive: true, force: true });
  });
  const loaded = await loadCommunity({ includeDemo: true }), store = createStore(loaded);
  let backup;
  try { publishDemo(store, loaded.bundle); backup = store.backup(); }
  finally { store.close(); }
  const artifact = { backup, catalog: JSON.parse(await readFile(join(communityRoot, 'catalog.json'), 'utf8')), report: { kind: 'private-legacy-migration', schemaVersion: 1 } };
  const artifactFile = join(directory, 'artifact.private.json'), reviewFile = join(directory, 'review.private.json');
  await writeFile(reviewFile, JSON.stringify({ withdrawnSubjectIds: [], revokedSubjectIds: [] }));
  return { directory, artifact, artifactFile, reviewFile };
}

test('offline wrapper refuses the generic HTTP start command before opening configuration or secrets', () => {
  const script = fileURLToPath(new URL('../scripts/runtime.mjs', import.meta.url));
  for (const args of [['start'], ['--demo', 'start']]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 10000, env: { ...process.env, GUIDE_ROOT: join(tmpdir(), 'guide-nonexistent-config') } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Use npm start/);
  }
});

test('local initialization never publishes content and does not reimport on restart', async t => {
  const loaded = await loadCommunity(), store = createStore(loaded);
  t.after(() => store.close());
  assert.equal(initializeDemo(store, loaded.bundle), true);
  const draft = structuredClone(loaded.bundle);
  draft.entities = [{ id: 'new-draft', type: 'answer' }];
  draft.revisions = [{ ...draft.revisions.find(item => item.data.origin === 'ai_draft'), id: 'new-draft-revision', entityId: 'new-draft' }];
  draft.revisions[0].data.sentences = [{ id: 'advice', text: 'Synthetic draft', kind: 'advice' }];
  draft.citations = [];
  store.transact(state => { state.modules.content = importContent(state.modules.content, draft); });
  assert.equal(initializeDemo(store, loaded.bundle), false);
  assert.equal(store.read().modules.content.entities.find(item => item.id === 'new-draft').publicRevisionId, null);
  assert.equal(projectPublic(store.read().modules.content).nodes.length, 0);
});

test('local initialization also leaves explicitly marked test demonstrations unpublished', async t => {
  const loaded = await loadCommunity({ includeDemo: true }), store = createStore(loaded);
  t.after(() => store.close());
  assert.equal(initializeDemo(store, loaded.bundle), true);
  assert.equal(projectPublic(store.read().modules.content).nodes.length, 0);
  assert.equal(store.read().audit.some(entry => entry.action === 'demo.publish'), false);
});

test('reviewed migration restores into a new consumer directory without exposing the private artifact', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'guide-restore-'));
  t.after(async () => {
    const absolute = resolve(directory), base = resolve(tmpdir()) + sep;
    assert.ok(absolute.startsWith(base) && absolute.includes('guide-restore-'));
    await rm(absolute, { recursive: true, force: true });
  });
  const loaded = await loadCommunity({ includeDemo: true }), store = createStore(loaded);
  publishDemo(store, loaded.bundle);
  const now = Date.parse('2098-09-09T12:00:00Z'), mfaKey = '42'.repeat(32);
  const account = { id: 'synthetic-restored-reviewer', displayName: 'Synthetic reviewer', roles: ['content_reviewer'], password: 'synthetic-restore-password', totpSecret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' };
  bootstrapAccount(store, account, { mfaKey, now });
  const artifact = { backup: store.backup(), catalog: JSON.parse(await readFile(join(communityRoot, 'catalog.json'), 'utf8')), report: { kind: 'private-legacy-migration', schemaVersion: 1, legacyTables: { privateEditorialMarker: 'must-not-ship' } } };
  store.close();
  const artifactFile = join(directory, 'source.private.json'), reviewFile = join(directory, 'review.private.json'), target = join(directory, 'deployment');
  await writeFile(artifactFile, JSON.stringify(artifact));
  await writeFile(reviewFile, JSON.stringify({ withdrawnSubjectIds: [], revokedSubjectIds: [] }));
  const before = await readFile(artifactFile, 'utf8');
  const result = await restoreMigration({ artifactFile, target, reviewFile, templateRoot: communityRoot });
  assert.equal(result.restored, true);
  assert.equal(result.accountsRequiringCredentials, 1);
  assert.equal(result.credentialsImported, false);
  assert.deepEqual(result.migrationWarnings, []);
  assert.equal(await readFile(artifactFile, 'utf8'), before);
  await assert.rejects(stat(join(target, '.migration-incomplete')), { code: 'ENOENT' });
  await assert.rejects(stat(join(target, 'source.private.json')), { code: 'ENOENT' });
  const runtime = await openRuntime({ root: target });
  try {
    assert.equal(projectPublic(runtime.store.read().modules.content).nodes.length, 4);
    const [restoredAccount] = inspectAccountsOffline(runtime.store, { operatorId: 'synthetic-restore-operator' });
    assert.equal(restoredAccount.id, account.id);
    assert.equal(restoredAccount.credentialsRequired, true);
    assert.throws(() => login(runtime.store, { accountId: account.id, password: account.password, code: totpCode(account.totpSecret, now) }, { mfaKey, now }), { code: 'INVALID_CREDENTIALS' });
  }
  finally { runtime.store.close(); }
  await assert.rejects(restoreMigration({ artifactFile, target, reviewFile, templateRoot: communityRoot }), { code: 'EEXIST' });
  await writeFile(reviewFile, '{}');
  await assert.rejects(restoreMigration({ artifactFile, target: join(directory, 'unreviewed'), reviewFile, templateRoot: communityRoot }), /explicitly contain/);
  await assert.rejects(stat(join(directory, 'unreviewed')), { code: 'ENOENT' });
});

test('legacy five-module artifacts explicitly initialize only empty guide review records without changing the artifact', async t => {
  const fixture = await migrationFixture(t), { artifact, artifactFile, reviewFile, directory } = fixture;
  delete artifact.backup.state.modules['guide-reviews'];
  delete artifact.backup.state.moduleVersions['guide-reviews'];
  const before = JSON.stringify(artifact);
  await writeFile(artifactFile, before);
  const target = join(directory, 'deployment');
  const result = await restoreMigration({ artifactFile, target, reviewFile, templateRoot: communityRoot });
  assert.equal(result.accountsRequiringCredentials, 0);
  assert.equal(result.migrationWarnings.length, 1);
  assert.match(result.migrationWarnings[0], /guide-reviews.*initialized empty/);
  assert.equal(await readFile(artifactFile, 'utf8'), before);
  for (const name of ['review-records.mjs', 'ui/editor.html', 'ui/editor.js', 'ui/editor.css', 'ui/batch-review.js']) {
    assert.deepEqual(await readFile(join(target, name)), await readFile(join(communityRoot, name)));
  }
  const runtime = await openRuntime({ root: target, seed: false });
  try {
    assert.deepEqual(runtime.store.read().modules['guide-reviews'], { records: [] });
    assert.equal(runtime.store.read().moduleVersions['guide-reviews'], 1);
    assert.equal(projectPublic(runtime.store.read().modules.content).nodes.length, 4);
  } finally { runtime.store.close(); }
});

test('new artifacts preserve encrypted business review records and reject malformed records', async t => {
  const { artifact, artifactFile, reviewFile, directory } = await migrationFixture(t);
  const entity = artifact.backup.state.modules.content.entities.find(value => value.publicRevisionId);
  const keyring = { activeVersion: 'synthetic-review-key', keys: { 'synthetic-review-key': Buffer.alloc(32, 5) } };
  recordReview(artifact.backup.state, { id: 'synthetic-reviewer' }, {
    action: 'content.publish', entity, reason: 'Synthetic reviewed source evidence.',
    now: Date.parse('2098-09-09T12:00:00Z'), keyring,
  });
  const [record] = artifact.backup.state.modules['guide-reviews'].records;
  const before = JSON.stringify(artifact);
  await writeFile(artifactFile, before);
  const target = join(directory, 'deployment');
  const result = await restoreMigration({ artifactFile, target, reviewFile, templateRoot: communityRoot });
  assert.deepEqual(result.migrationWarnings, []);
  assert.equal(await readFile(artifactFile, 'utf8'), before);
  const runtime = await openRuntime({ root: target, seed: false });
  try { assert.deepEqual(runtime.store.read().modules['guide-reviews'].records, [record]); }
  finally { runtime.store.close(); }
  record.revisionId = 'missing-revision';
  await writeFile(artifactFile, JSON.stringify(artifact));
  const invalidTarget = join(directory, 'invalid-records');
  await assert.rejects(restoreMigration({ artifactFile, target: invalidTarget, reviewFile, templateRoot: communityRoot }), { code: 'GUIDE_REVIEW_STATE' });
  await assert.rejects(stat(invalidTarget), { code: 'ENOENT' });
});

test('review-record initialization does not repair other missing modules or discard unknown modules', async t => {
  const { artifact, artifactFile, reviewFile, directory } = await migrationFixture(t);
  const mutations = [
    ...['content', 'auth', 'lifecycle', 'participants', 'reports'].map(name => value => {
      delete value.backup.state.modules[name];
      delete value.backup.state.moduleVersions[name];
      delete value.backup.state.modules['guide-reviews'];
      delete value.backup.state.moduleVersions['guide-reviews'];
    }),
    value => { value.backup.state.modules.unknown = {}; value.backup.state.moduleVersions.unknown = 1; },
    value => { delete value.backup.state.modules['guide-reviews']; },
    value => { delete value.backup.state.moduleVersions['guide-reviews']; },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const broken = structuredClone(artifact);
    mutate(broken);
    const before = JSON.stringify(broken);
    await writeFile(artifactFile, before);
    const target = join(directory, `invalid-${index}`);
    await assert.rejects(restoreMigration({ artifactFile, target, reviewFile, templateRoot: communityRoot }));
    assert.equal(await readFile(artifactFile, 'utf8'), before);
    await assert.rejects(stat(target), { code: 'ENOENT' });
  }
});

test('restore still rejects arbitrary extensions and identity providers before creating a target', async t => {
  const { artifact, artifactFile, reviewFile, directory } = await migrationFixture(t);
  await writeFile(artifactFile, JSON.stringify(artifact));
  const templateRoot = join(directory, 'template');
  await mkdir(templateRoot);
  for (const name of ['business.json', 'content-profile.json', 'lifecycle.json']) await copyFile(join(communityRoot, name), join(templateRoot, name));
  await writeFile(join(templateRoot, 'review-records.mjs'), 'export default { name: "guide-reviews" };\n');
  const originalConfig = JSON.parse(await readFile(join(communityRoot, 'runtime.config.json'), 'utf8'));
  for (const [index, change] of [
    { extensions: ['unreviewed.mjs'] },
    { extensions: ['review-records.mjs', 'unreviewed.mjs'] },
    { extensions: ['review-records.mjs', 'review-records.mjs'] },
    { identityProvider: 'unreviewed-provider.mjs' },
    { extensions: ['review-records.mjs'] },
  ].entries()) {
    await writeFile(join(templateRoot, 'runtime.config.json'), JSON.stringify({ ...originalConfig, ...change }));
    const target = join(directory, `unreviewed-${index}`);
    await assert.rejects(restoreMigration({ artifactFile, target, reviewFile, templateRoot }), /Custom platform extensions/);
    await assert.rejects(stat(target), { code: 'ENOENT' });
  }
});
