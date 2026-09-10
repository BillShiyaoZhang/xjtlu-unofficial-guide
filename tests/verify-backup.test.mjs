import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { bootstrapAccount, lifecycleCommand } from '@information-community/runtime';
import { recordReview } from '../server/content-review.mjs';
import { verifyBackup } from '../scripts/verify-backup.mjs';
import { communityRoot, createStore, loadCommunity, publishDemo } from './helpers.mjs';

const now = Date.parse('2098-01-01T12:00:00Z'), operatorId = 'synthetic-verification-operator';
const keyring = { activeVersion: 'synthetic-backup-key', keys: { 'synthetic-backup-key': Buffer.alloc(32, 31) } };
const account = { id: 'synthetic-backup-reviewer', displayName: 'Synthetic reviewer', roles: ['content_reviewer'], password: 'synthetic-backup-password', totpSecret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' };
const privateText = 'Synthetic confidential report body.';
const privateReason = 'Synthetic confidential review reason.';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'guide-backup-verification-'));
  t.after(async () => {
    const absolute = resolve(directory), base = resolve(tmpdir()) + sep;
    assert.ok(absolute.startsWith(base) && absolute.includes('guide-backup-verification-'));
    await rm(absolute, { recursive: true, force: true });
  });
  const root = join(directory, 'configuration');
  await mkdir(root);
  for (const name of ['runtime.config.json', 'business.json', 'content-profile.json', 'lifecycle.json', 'review-records.mjs']) await copyFile(join(communityRoot, name), join(root, name));
  const config = JSON.parse(await readFile(join(root, 'runtime.config.json'), 'utf8'));
  config.dataDirectory = 'do-not-open-live';
  await writeFile(join(root, 'runtime.config.json'), JSON.stringify(config));
  await mkdir(join(root, config.dataDirectory));
  const liveFile = join(root, config.dataDirectory, 'community.sqlite');
  await writeFile(liveFile, 'Synthetic sentinel: this is not a SQLite database.');
  const loaded = await loadCommunity({ includeDemo: true }), store = createStore(loaded);
  let backup;
  try {
    publishDemo(store, loaded.bundle, now);
    bootstrapAccount(store, account, { mfaKey: '32'.repeat(32), now });
    store.transact(state => {
      lifecycleCommand(state, { id: 'synthetic-private-subject', roles: ['participant'], mfa: true }, {
        action: 'create', id: 'synthetic-private-record', type: 'privacy_report', payload: { body: privateText },
      }, { config: loaded.business.lifecycle, keyring, now });
      recordReview(state, { id: account.id }, {
        action: 'content.publish', entity: state.modules.content.entities.find(value => value.publicRevisionId),
        reason: privateReason, now, keyring,
      });
    });
    backup = store.backup();
  } finally { store.close(); }
  const backupFile = join(directory, 'backup.private.json'), reviewFile = join(directory, 'review.private.json');
  await writeFile(backupFile, JSON.stringify(backup));
  await writeFile(reviewFile, JSON.stringify({ withdrawnSubjectIds: [], revokedSubjectIds: [] }));
  const args = { backupFile, reviewFile, root, evidenceFile: join(directory, 'evidence.private.json'), operatorId, keyring, now };
  return { ...args, args, backup, directory, liveFile, config };
}

function assertRedacted(value) {
  const text = JSON.stringify(value);
  for (const secret of [privateText, privateReason, account.id, account.password, account.totpSecret, 'synthetic-private-subject', 'synthetic-private-record', keyring.keys[keyring.activeVersion].toString('hex')]) assert.equal(text.includes(secret), false);
}

test('backup verification restores in memory, decrypts retained private data and emits only counted evidence', async t => {
  const f = await fixture(t), original = await readFile(f.backupFile), live = await readFile(f.liveFile);
  const evidence = await verifyBackup(f.args);
  assert.equal(evidence.status, 'succeeded');
  assert.equal(evidence.operatorId, operatorId);
  assert.equal(evidence.checkedAt, new Date(now).toISOString());
  assert.equal(evidence.backupSHA256, createHash('sha256').update(original).digest('hex'));
  assert.equal(evidence.accountsRequiringCredentials, 1);
  assert.equal(evidence.sessionsInvalidated, true);
  assert.equal(evidence.counts.lifecyclePayloadsDecrypted, 1);
  assert.equal(evidence.counts.guideReviewPayloadsDecrypted, 1);
  assert.deepEqual(evidence.migrationWarnings, []);
  assertRedacted(evidence);
  assert.deepEqual(JSON.parse(await readFile(f.evidenceFile, 'utf8')), evidence);
  assert.deepEqual(await readFile(f.backupFile), original);
  assert.deepEqual(await readFile(f.liveFile), live);
  if (process.platform !== 'win32') assert.equal((await stat(f.evidenceFile)).mode & 0o777, 0o600);
});

test('missing keys, wrong keys and damaged review ciphertext create failed evidence without secret error text', async t => {
  const f = await fixture(t);
  for (const [index, selectedKeyring, expectedCode] of [
    [0, undefined, 'KEY_UNAVAILABLE'],
    [1, { keys: { [keyring.activeVersion]: Buffer.alloc(32, 99) } }, 'DECRYPTION_FAILED'],
    [2, 'not-json containing synthetic-sensitive-key', 'INVALID_KEYRING_JSON'],
  ]) {
    const evidence = await verifyBackup({ ...f.args, keyring: selectedKeyring, evidenceFile: join(f.directory, `failed-${index}.json`) });
    assert.equal(evidence.status, 'failed');
    assert.equal(evidence.code, expectedCode);
    assert.equal(evidence.counts, undefined);
    assertRedacted(evidence);
    assert.equal(JSON.stringify(evidence).includes('synthetic-sensitive-key'), false);
  }
  const record = f.backup.state.modules['guide-reviews'].records[0];
  record.payload.tag = Buffer.alloc(16, 0).toString('base64url');
  await writeFile(f.backupFile, JSON.stringify(f.backup));
  const evidence = await verifyBackup(f.args);
  assert.equal(evidence.status, 'failed');
  assert.equal(evidence.code, 'DECRYPTION_FAILED');
  assertRedacted(evidence);
});

test('expired lifecycle payloads are purged by the SDK restore and are not misreported as decrypted', async t => {
  const f = await fixture(t);
  const record = f.backup.state.modules.lifecycle.records['synthetic-private-record'];
  record.payload.tag = Buffer.alloc(16, 0).toString('base64url');
  await writeFile(f.backupFile, JSON.stringify(f.backup));
  const evidence = await verifyBackup({ ...f.args, now: record.expiresAt });
  assert.equal(evidence.status, 'succeeded');
  assert.equal(evidence.counts.lifecycleRecords, 1);
  assert.equal(evidence.counts.lifecyclePayloadsDecrypted, 0);
  assert.equal(evidence.counts.guideReviewPayloadsDecrypted, 1);
});

test('legacy five-module backups initialize only the known empty review module and preserve the original backup', async t => {
  const f = await fixture(t);
  delete f.backup.state.modules['guide-reviews'];
  delete f.backup.state.moduleVersions['guide-reviews'];
  const before = JSON.stringify(f.backup);
  await writeFile(f.backupFile, before);
  const evidence = await verifyBackup(f.args);
  assert.equal(evidence.status, 'succeeded');
  assert.equal(evidence.migrationWarnings.length, 1);
  assert.equal(evidence.counts.guideReviewRecords, 0);
  assert.equal(evidence.counts.lifecyclePayloadsDecrypted, 1);
  assert.equal(await readFile(f.backupFile, 'utf8'), before);
});

test('missing review, profile mismatch, unknown extensions and missing platform modules cannot produce success', async t => {
  const f = await fixture(t);
  const cases = [
    async () => { await writeFile(f.reviewFile, '{}'); },
    async () => { f.backup.state.modules.content.profile.entityTypes[0].id = 'unexpected-profile'; await writeFile(f.backupFile, JSON.stringify(f.backup)); },
    async () => { await writeFile(join(f.root, 'runtime.config.json'), JSON.stringify({ ...f.config, extensions: ['unreviewed.mjs'] })); },
    async () => { await writeFile(join(f.root, 'runtime.config.json'), JSON.stringify({ ...f.config, identityProvider: 'unreviewed.mjs' })); },
    async () => { delete f.backup.state.modules.auth; delete f.backup.state.moduleVersions.auth; await writeFile(f.backupFile, JSON.stringify(f.backup)); },
  ];
  const original = structuredClone(f.backup);
  for (const [index, change] of cases.entries()) {
    f.backup = structuredClone(original);
    await writeFile(f.backupFile, JSON.stringify(original));
    await writeFile(f.reviewFile, JSON.stringify({ withdrawnSubjectIds: [], revokedSubjectIds: [] }));
    await writeFile(join(f.root, 'runtime.config.json'), JSON.stringify(f.config));
    await change();
    const result = await verifyBackup({ ...f.args, evidenceFile: join(f.directory, `rejected-${index}.json`) });
    assert.equal(result.status, 'failed');
    assert.match(result.code, /^[A-Z][A-Z0-9_]+$/);
    assertRedacted(result);
  }
});

test('explicit paths and a named operator are mandatory; existing evidence and backup files are never overwritten', async t => {
  const f = await fixture(t);
  for (const name of ['backupFile', 'reviewFile', 'root', 'evidenceFile']) {
    await assert.rejects(verifyBackup({ ...f.args, [name]: undefined }), { code: 'EXPLICIT_PATHS_REQUIRED' });
  }
  await assert.rejects(verifyBackup({ ...f.args, operatorId: '' }), { code: 'OFFLINE_OPERATOR_REQUIRED' });
  await assert.rejects(verifyBackup({ ...f.args, now: Number.MAX_SAFE_INTEGER }), { code: 'INVALID_CHECK_TIME' });
  await assert.rejects(stat(f.evidenceFile), { code: 'ENOENT' });
  const original = await readFile(f.backupFile);
  await assert.rejects(verifyBackup({ ...f.args, evidenceFile: f.backupFile }), { code: 'EEXIST' });
  assert.deepEqual(await readFile(f.backupFile), original);
  await verifyBackup(f.args);
  const evidence = await readFile(f.evidenceFile);
  await assert.rejects(verifyBackup(f.args), { code: 'EEXIST' });
  assert.deepEqual(await readFile(f.evidenceFile), evidence);
});

test('missing backup failure evidence records only a fixed code, not an exception path or message', async t => {
  const f = await fixture(t), missing = join(f.directory, 'private-name-never-print.json');
  const result = await verifyBackup({ ...f.args, backupFile: missing });
  assert.equal(result.status, 'failed');
  assert.equal(result.code, 'ENOENT');
  assert.equal(result.backupSHA256, null);
  assert.equal(JSON.stringify(result).includes(missing), false);
  assert.equal(JSON.stringify(result).includes('private-name-never-print'), false);
});

test('CLI requires all four explicit paths, uses environment credentials and returns nonzero for failed verification', async t => {
  const f = await fixture(t), script = fileURLToPath(new URL('../scripts/verify-backup.mjs', import.meta.url));
  const env = { ...process.env, RUNTIME_OPERATOR_ID: operatorId, RUNTIME_KEYRING: JSON.stringify({ keys: { [keyring.activeVersion]: keyring.keys[keyring.activeVersion].toString('hex') } }) };
  const args = ['--backup', f.backupFile, '--review', f.reviewFile, '--root', f.root, '--evidence', f.evidenceFile];
  const passed = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 10000, env });
  assert.equal(passed.status, 0, passed.stderr);
  assert.equal(JSON.parse(passed.stdout).status, 'succeeded');
  assertRedacted(JSON.parse(passed.stdout));
  const missingPath = spawnSync(process.execPath, [script, ...args.slice(0, -2)], { encoding: 'utf8', timeout: 10000, env });
  assert.equal(missingPath.status, 1);
  assert.match(missingPath.stderr, /EXPLICIT_PATHS_REQUIRED/);
  const failed = spawnSync(process.execPath, [script, ...args.slice(0, -1), join(f.directory, 'cli-failed.json')], { encoding: 'utf8', timeout: 10000, env: { ...env, RUNTIME_KEYRING: '{}' } });
  assert.equal(failed.status, 1);
  assert.equal(JSON.parse(failed.stdout).status, 'failed');
  assert.equal(JSON.parse(failed.stdout).code, 'KEY_UNAVAILABLE');
});
